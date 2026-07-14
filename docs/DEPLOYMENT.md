# Forg3 Sign — Deployment Runbook

Forg3 Sign deploys as a single Node process that serves both the API and the
built web client, backed by Postgres. In production the server **refuses to
start** until every required variable below is set — the startup error lists
exactly what is missing.

## 1. Generate secrets

```bash
# Login-token signing secret
node -e "console.log('APP_AUTH_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
# Device two-factor hashing secret
node -e "console.log('DEVICE_TRUST_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
# AES-256-GCM key for PDFs at rest
node -e "console.log('FORG3_OBJECT_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'))"
```

Store these in your platform's secret manager. Rotating `APP_AUTH_SECRET`
signs everyone out; rotating `FORG3_OBJECT_ENCRYPTION_KEY` makes previously
encrypted PDFs unreadable — never rotate it without re-encrypting.

## 2. Required environment

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_AUTH_SECRET` | Signs email-login bearer tokens |
| `DEVICE_TRUST_SECRET` | Hashes device ids and 2FA codes |
| `FORG3_OBJECT_ENCRYPTION_KEY` | Encrypts stored PDFs (32 bytes hex/base64) |
| `DATABASE_URL` | Postgres connection string |
| `EMAIL_PROVIDER` + credentials | `microsoft_graph` (tenant/client/secret/sender) or `resend` (`RESEND_API_KEY`, `FORG3_EMAIL_FROM`) |
| `PUBLIC_SIGNING_BASE_URL` | Public HTTPS origin used in signing-link emails, e.g. `https://sign.example.com` |

Recommended:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` in production | Bind address |
| `PORT` | `4127` | Listen port |
| `TRUST_PROXY_HOPS` | `1` in production | Proxy hops in front of the app (correct client IPs for rate limits) |
| `DATABASE_SSL` | auto | `disable` for same-network Postgres, `no-verify` for managed Postgres with self-signed chains |
| `CORS_ORIGINS` | none | Extra allowed origins (only needed if the web client is hosted on a different origin) |
| `FORG3_CREATOR_EMAILS` | none | Comma-separated accounts with creator unlimited access |
| `FORG3_AUTH_CODE_LIMIT` / `FORG3_AUTH_VERIFY_LIMIT` / `FORG3_CODE_RESEND_COOLDOWN_SECONDS` | 10 / 40 / 30 | Login-code abuse protection |

Native billing:

| Variable | Purpose |
| --- | --- |
| `APPLE_APP_STORE_ISSUER_ID` / `APPLE_APP_STORE_KEY_ID` / `APPLE_APP_STORE_PRIVATE_KEY` | App Store Server API auth for receipt verification |
| `APPLE_APP_STORE_BUNDLE_ID` / `APPLE_APP_STORE_ENVIRONMENT` | iOS bundle and sandbox/production selector |
| `GOOGLE_PLAY_PACKAGE_NAME` | Android package name |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` or `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` or `GOOGLE_APPLICATION_CREDENTIALS` | Google Play Developer API service account |
| `GOOGLE_RTDN_VERIFICATION_TOKEN` or `BILLING_WEBHOOK_TOKEN` | Optional shared token for Google Pub/Sub push endpoint |

## 3. Storage model

With `DATABASE_URL` set, Forg3 stores workflow state in a `forg3_store` jsonb
row and PDFs (already AES-256-GCM encrypted) in a `forg3_objects` bytea table.
Both tables are created automatically at boot — no migration step.

**Run exactly one app instance.** The store uses an in-process cache with
serialized write-through; horizontal scaling requires the fuller relational
schema described in [PRODUCTION_PERSISTENCE.md](PRODUCTION_PERSISTENCE.md).

Backups: standard `pg_dump` covers everything (documents, PDFs, audit chain).

```bash
pg_dump "$DATABASE_URL" --schema=forg3 --format=custom --no-owner --no-privileges --file=forg3-backup.dump
pg_restore --no-owner --no-privileges --dbname "$RESTORE_DATABASE_URL" forg3-backup.dump
```

The app database role is intentionally scoped to the `forg3` schema. On managed
Supabase/Postgres, dumping the whole database may fail on provider-owned schemas;
dump `--schema=forg3`.

Monitoring:

```bash
FORG3_MONITOR_URL=https://forg3.nak3deye.com \
FORG3_EXPECTED_A_RECORD=193.122.161.167 \
FORG3_EXPECTED_SERVICE=forg3 \
npm run monitor:production
```

The monitor verifies DNS A records and the public `/api/health` response. Run it
from cron, GitHub Actions, or an external uptime monitor. If OCI recreates the
container instance, update DNS and `FORG3_EXPECTED_A_RECORD`; a reserved public
IP is still the better long-term fix once the OCI tenancy quota allows one.

## 4. Deploy options

### Docker Compose (self-hosted VPS)

```bash
cp .env.example .env      # fill in secrets + email provider + POSTGRES_PASSWORD
docker compose up --build -d
```

Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front of port
4127 and set `PUBLIC_SIGNING_BASE_URL` to the public origin.

### Render / Railway / Fly.io (managed)

1. Create a Postgres instance; copy its connection string into `DATABASE_URL`
   (add `DATABASE_SSL=no-verify` if the provider uses self-signed certs).
2. Create a web service from this repo using the Dockerfile.
3. Set the environment from section 2. The platform's HTTPS origin is your
   `PUBLIC_SIGNING_BASE_URL`.
4. Health check path: `/api/health`.

### Bare Node (systemd)

```bash
npm ci && npm run build
NODE_ENV=production node dist-server/server/index.js
```

The process handles SIGTERM gracefully: it drains connections and flushes
pending Postgres writes before exiting.

## 5. Post-deploy checklist

- [ ] `GET https://<host>/api/health` returns `{"ok":true}`.
- [ ] Boot log shows `storage: postgres, encrypted at rest: yes`.
- [ ] Email-code login works end to end (code arrives from your provider).
- [ ] Create → sign → download a test packet; verify the audit certificate page.
- [ ] `#/settings` loads; enroll TOTP on the owner account.
- [ ] `#/terms` and `#/privacy` render.
- [ ] Backups scheduled (`pg_dump` cron or managed snapshots).
- [ ] Restore drill completed against a disposable Postgres database.
- [ ] DNS/health monitor scheduled.
- [ ] For mobile shells: set `VITE_API_BASE_URL` to the public origin, rebuild, `npx cap sync`.

## 6. Still outside this runbook

- **Store-console launch work** — the native StoreKit / Play Billing bridge and
  server verification endpoints are present, but App Store Connect products,
  Google Play products, server credentials, sandbox testers, Google RTDN, and
  Apple provisioning are still required. See
  [STORE_BILLING_IMPLEMENTATION.md](STORE_BILLING_IMPLEMENTATION.md).
- **CA-backed PAdES signatures** — needs a signing certificate
  (`PDF_SIGNING_CERT_P12_BASE64`, `PDF_SIGNING_CERT_PASSWORD`).
- **Real-device iOS/Android QA** and store review.
- **Legal review** of the pilot terms/privacy before charging customers.
