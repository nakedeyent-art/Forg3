# Forg3 Production Launch Runbook

Last updated: 2026-07-14

## Target

Production should be separate from staging, even if both currently use Oracle Cloud infrastructure.

| Layer | Production requirement |
| --- | --- |
| Domain | `forg3.nak3deye.com` or a final production subdomain pointed at production only |
| Compute | Dedicated OCI container instance or VM, not the staging instance |
| Database | Dedicated production Postgres, separate from `forg3-staging` |
| Object storage | Encrypted private storage or Postgres object table with production encryption key |
| Email | Microsoft Graph or Resend production sender with SPF/DKIM/DMARC aligned |
| Billing | App Store Server API + Google Play Developer API credentials configured |
| Backups | Automated daily backups plus tested restore drill |
| Monitoring | `/api/health`, DNS, email delivery, billing webhook, and backup status checks |

## Required Production Environment

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=4127
PUBLIC_SIGNING_BASE_URL=https://forg3.nak3deye.com
CORS_ORIGINS=

APP_AUTH_SECRET=
DEVICE_TRUST_SECRET=
FORG3_OBJECT_ENCRYPTION_KEY=
DATABASE_URL=
DATABASE_SSL=no-verify
TRUST_PROXY_HOPS=1

EMAIL_PROVIDER=microsoft_graph
MICROSOFT_GRAPH_TENANT_ID=
MICROSOFT_GRAPH_CLIENT_ID=
MICROSOFT_GRAPH_CLIENT_SECRET=
MICROSOFT_GRAPH_SENDER=st@nak3deye.com
FORG3_EMAIL_FROM=st@nak3deye.com
FORG3_EMAIL_REPLY_TO=st@nak3deye.com
EMAIL_SEND_AS_OWNER=false

FORG3_REQUIRE_STORE_BILLING=true
APPLE_APP_STORE_ISSUER_ID=
APPLE_APP_STORE_KEY_ID=
APPLE_APP_STORE_PRIVATE_KEY_BASE64=
APPLE_APP_STORE_BUNDLE_ID=com.forg3.sign
APPLE_APP_STORE_ENVIRONMENT=production

GOOGLE_PLAY_PACKAGE_NAME=com.forg3.sign
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64=
GOOGLE_RTDN_VERIFICATION_TOKEN=
```

## OCI Production Path

The staging handoff recorded that the current OCI tenancy had zero limit for managed PostgreSQL and reserved public IPs. For production, do one of these before launch:

1. Request OCI limit increases for managed PostgreSQL and reserved public IPs.
2. Run production Postgres on a dedicated OCI VM/container volume with daily encrypted `pg_dump` backups and a restore drill.
3. Keep Supabase only as a temporary managed Postgres provider if the owner approves it as non-Oracle infrastructure.

Do not reuse staging secrets for production. Generate new values for `APP_AUTH_SECRET`, `DEVICE_TRUST_SECRET`, and `FORG3_OBJECT_ENCRYPTION_KEY`.

## Release Verification Commands

```bash
npm run build:mobile:release
npm run typecheck
npm run smoke
npm audit --audit-level=moderate --omit=dev
npm run monitor:production
npm run verify:release-readiness
```

`verify:release-readiness` intentionally fails until production store billing, database, encryption, email, and webhook secrets are present in `.env.production`, `.env.local`, or the process environment.

## Backup And Restore

Daily:

```bash
pg_dump "$DATABASE_URL" --schema=forg3 --format=custom --file "forg3-production-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Monthly:

1. Restore the latest dump into a disposable Postgres instance.
2. Confirm `forg3_store` and `forg3_objects` row counts.
3. Confirm encrypted object blobs still start with `FORG3ENC1`.
4. Record restore timestamp and operator.

## Go / No-Go

Launch only after:

- Store products are live or approved for sandbox/TestFlight/internal testing.
- iPhone and Android hardware complete the full paid signing flow.
- Production env passes `npm run verify:release-readiness`.
- Terms/privacy are approved for paid customers.
- Backup restore drill is complete.
