# Codex Handoff — Forg3 Sign

_Last updated: 2026-07-13 (Claude session: staging v2 with HTTPS + managed Postgres)_

## Current live state

| Thing | Value |
| --- | --- |
| Staging URL | **https://150-136-152-51.sslip.io** (Let's Encrypt cert, valid to 2026-10-11) |
| Compute | OCI container instance `forg3-staging-v2` (us-ashburn, `CI.Standard.A1.Flex` 1 OCPU / 2 GB), containers: `forg3-app` + `caddy` |
| Database | **Supabase managed Postgres**, project `forg3-staging` (ref `qmipdkaoptxsevlfkrfm`, us-east-1, free tier, daily backups). App connects as role `forg3_app` via session pooler `aws-0-us-east-1.pooler.supabase.com:5432`, schema `forg3` (NOT exposed via Supabase REST API) |
| Image | `ghcr.io/nakedeyent-art/forg3:main` (multi-arch, published by CI on every push to main) |
| Repo | github.com/nakedeyent-art/Forg3, default branch `main`, CI green (build-and-test, smoke-postgres, docker-image, publish-ghcr) |
| Old staging | v1 instance (`129.80.37.229`, HTTP, containerized Postgres) is **STOPPED**, not deleted — delete once v2 is trusted |
| Local secrets/state | `~/Documents/Forg3/.deploy/` (git-ignored): OCIDs, device id, Supabase `forg3_app` password, encryption key, test artifacts |

## How staging v2 works

- Both containers share the pod network. `caddy` discovers the instance's public IP at startup (api.ipify.org), derives `<ip-dashes>.sslip.io`, and runs `caddy reverse-proxy --from https://<domain> --to localhost:4127` with automatic Let's Encrypt. The app wrapper does the same to set `PUBLIC_SIGNING_BASE_URL`. No DNS setup needed; swap to a real domain by pointing DNS at the IP and changing the two container commands.
- If the instance is recreated, the IP changes and the sslip domain follows automatically — links in old emails break, but data is safe in Supabase.
- OCI tenancy limits are 0 for managed PostgreSQL **and** reserved public IPs — that's why sslip + startup discovery is used. A limit-increase ticket would unlock both.
- NSG allows 80 (ACME) / 443 / 4127 ingress.

## Verified end-to-end on v2 (2026-07-13)

Email-code login (real Microsoft Graph delivery) → device 2FA → document create (creator account `st@nak3deye.com`) → signing-link email with HTTPS URL → signer opened room → signed → sealed PDF (`FORG3ENC1` AES-256-GCM blobs confirmed in Supabase `forg3.forg3_objects`) → audit chain `auth.login → auth.mfa_verified → document.created → document.viewed → document.signer_signed → document.signed` intact. Sealed test PDF: `.deploy/forg3-staging-v2-signed.pdf`.

## Architecture crib sheet

- Single Node/Express server serves API + built web client (`dist/`). Source: `server/` (TS, compiled to `dist-server/`), client `src/` (Vite + React, hash routing).
- Persistence: `server/store.ts` (whole-store jsonb row `forg3_store`, in-process cache + serialized write-through — **single app instance only**) and `server/objectStore.ts` (PDFs in `forg3_objects` bytea, AES-256-GCM sealed before write). File fallback when `DATABASE_URL` unset. Shared pool in `server/db.ts` (`DATABASE_SSL=no-verify` for Supabase pooler).
- Auth: email-code login → server-side session embedded in HMAC token (`server/auth.ts`), device trust 2FA, optional TOTP (`server/totp.ts`). Sessions/devices revocable at `#/settings`.
- Audit: owner-scoped hash-chained events (`store.appendAuditEvent`).
- Smoke suite: `npm run smoke` (20 checks) — CI runs it on file store AND a Postgres service container.
- Deployment runbook: `docs/DEPLOYMENT.md`. Env preflight in production lists missing vars and refuses to boot.

## Remaining work (priority order agreed with owner)

1. ~~Managed DB + HTTPS staging~~ ✅ done (this handoff).
2. **Real-device iOS/Android QA (priority 9)** — next. Set `VITE_API_BASE_URL=https://150-136-152-51.sslip.io` (or the real domain once DNS exists), `npm run build && npx cap sync`, build in Xcode/Android Studio on physical devices, TestFlight internal + Play internal track. In-app account deletion (Apple requirement) already exists at `#/settings`.
3. **Native billing (priority 7) — last.** Owner HAS App Store Connect + Play Console credentials. Wire App Store Server API + Play Developer API receipt verification into `/api/subscription/verify` (see `docs/STORE_BILLING_IMPLEMENTATION.md`), StoreKit 2 / Play Billing in the Capacitor shells. Product IDs already defined in `server/index.ts` (`com.forg3.sign.*` / `forg3_*`).
4. Real domain + DNS for staging/production (replaces sslip.io), then legal review of `#/terms` / `#/privacy` before charging.
5. Optional hardening: passkeys, CA-backed PAdES signing cert, relational schema for multi-instance scaling (`docs/PRODUCTION_PERSISTENCE.md`), OCI limit-increase ticket.

## Gotchas

- **Never** run staging without `FORG3_OBJECT_ENCRYPTION_KEY` — rotating it orphans existing sealed PDFs (key lives in `.deploy` and in the container env).
- Login codes rate-limit hard (10/15min per IP, 30s resend cooldown) — during automated testing, reuse the trusted device id in `.deploy/oci-staging-v2-device-id`.
- Demo billing is disabled in production; the staging owner works because `FORG3_CREATOR_EMAILS=st@nak3deye.com` grants creator access.
- Supabase MCP `execute_sql` runs as `postgres`, which cannot touch `forg3_app`-owned tables — connect as `forg3_app` (password in `.deploy/supabase-forg3app-password`) for data operations.
