# Production Persistence Plan

Phase 3 cannot be fully executed without provisioned infrastructure. The app now refuses to use the JSON file store in `NODE_ENV=production` unless `ALLOW_FILE_STORE_IN_PRODUCTION=true` is explicitly set for emergency migration tooling.

## Required Infrastructure

- Postgres database reachable by `DATABASE_URL`.
- Encrypted object storage for original and signed PDFs.
- KMS key for object encryption.
- Backup, retention, and deletion policy approved by owner/legal.

## Target Tables

```sql
create table owners (
  id uuid primary key,
  firebase_uid text not null unique,
  email text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table subscriptions (
  owner_id uuid primary key references owners(id) on delete cascade,
  plan_id text not null,
  billing_provider text not null,
  status text not null,
  started_at timestamptz not null,
  renews_at timestamptz not null,
  updated_at timestamptz not null,
  provider_transaction_id text,
  canceled_at timestamptz
);

create table documents (
  id uuid primary key,
  owner_id uuid not null references owners(id) on delete cascade,
  title text not null,
  file_name text not null,
  file_type text not null,
  original_blob_key text not null,
  original_sha256 text not null,
  signed_blob_key text,
  signed_sha256 text,
  signer_name text not null,
  signer_email text not null,
  auth_provider text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  signed_at timestamptz,
  status text not null,
  signature_blob_key text,
  signer_name_confirmation text,
  consent_text text,
  voided_at timestamptz
);

create table signing_tokens (
  document_id uuid primary key references documents(id) on delete cascade,
  token_hash text unique,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table signature_charges (
  id uuid primary key,
  owner_id uuid not null references owners(id) on delete cascade,
  document_id uuid not null unique references documents(id) on delete cascade,
  signer_email text not null,
  plan_id text not null,
  amount_cents integer not null,
  status text not null,
  provider_event_id text unique,
  created_at timestamptz not null
);

create table audit_events (
  id uuid primary key,
  owner_id uuid references owners(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  event_type text not null,
  event_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

## Blob Storage Rules

- Store original PDF, signed PDF, and signature PNG as encrypted objects.
- Store only object keys and SHA-256 hashes in Postgres.
- Use object versioning if the provider supports it.
- Use signed URLs only for short-lived internal retrieval, or proxy downloads through authenticated API routes.
- Do not store raw signing tokens.

## Concurrency Requirements

- Complete signing in a database transaction.
- Select the signing token row `for update`.
- Verify token exists, is unconsumed, and is unexpired.
- Write signed object, update document, null/consume token, insert usage charge with unique `document_id`.
- Retry only idempotent conflicts; never double-charge.
