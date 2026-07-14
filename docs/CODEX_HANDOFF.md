# Codex Handoff — Forg3 Sign

_Last updated: 2026-07-14 UTC (Codex session: native billing bridge, iOS build unblock, signed Android AAB, production-doc refresh)_

## Current live state

| Thing | Value |
| --- | --- |
| Staging URL | **https://forg3.nak3deye.com** live. Cloudflare DNS has an A record `forg3.nak3deye.com -> 193.122.161.167` with proxy disabled so Caddy can manage Let's Encrypt directly. |
| Compute | OCI container instance `forg3-staging-v4` (us-ashburn, `CI.Standard.A1.Flex` 1 OCPU / 2 GB), containers: `forg3-app` + `caddy`, public IP `193.122.161.167` |
| Database | **Supabase managed Postgres**, project `forg3-staging` (ref `qmipdkaoptxsevlfkrfm`, us-east-1, free tier, daily backups). App connects as role `forg3_app` via session pooler `aws-0-us-east-1.pooler.supabase.com:5432`, schema `forg3` (NOT exposed via Supabase REST API) |
| Image | `ghcr.io/nakedeyent-art/forg3:main` (multi-arch, published by CI on every push to main) |
| Repo | github.com/nakedeyent-art/Forg3, default branch `main`, CI green on merge commit `b30e035256f70018e7cdc114f6f64edfc7197f5f`; `publish-ghcr` completed in CI run `29300693453` |
| Old staging | Prior v1/v2/v3 container instances are deleted. Current live DNS target is v4 only. |
| Local secrets/state | `~/Documents/Forg3/.deploy/` (git-ignored): OCIDs, device id, Supabase `forg3_app` password, encryption key, test artifacts |

## How staging v4 works

- Both containers share the pod network. `caddy` runs `caddy reverse-proxy --from https://forg3.nak3deye.com --to localhost:4127` with automatic Let's Encrypt. The app env sets `PUBLIC_SIGNING_BASE_URL=https://forg3.nak3deye.com`.
- The v4 app container booted successfully: `storage: postgres, encrypted at rest: yes`.
- Public health is live: `https://forg3.nak3deye.com/api/health` returns `{"ok":true,"service":"forg3-sign",...}`.
- If the instance is recreated, the IP changes. Update DNS to the new public IP and wait for Caddy to issue a fresh certificate.
- OCI tenancy limits are 0 for managed PostgreSQL **and** reserved public IPs, so `forg3.nak3deye.com` currently points at the instance's ordinary public IP. A limit-increase ticket would unlock reserved-IP stability.
- NSG allows 80 (ACME) / 443 / 4127 ingress.

## Verified end-to-end on v4 (2026-07-14 UTC)

Email-code login (real Microsoft Graph delivery) → device 2FA → document create (creator account `st@nak3deye.com`) → signing-link email from `st@nak3deye.com` with `https://forg3.nak3deye.com/#/inbox/sign/...` URL → unauthenticated assigned-room open returned `401` → verified recipient opened room → signed → owner downloaded sealed PDF → audit chain `auth.login → auth.mfa_verified → document.created → document.viewed → document.signer_signed → document.signed` links intact. Sealed test PDF: `.deploy/forg3-v4-signed.pdf`.

Feature status on v4: email delivery configured via Microsoft Graph; object storage configured as Postgres-backed encrypted blobs with `encryptedAtRest=true`.

The signing-room PDF surface now uses a PDF.js canvas renderer (`src/components/PdfPreview.tsx`) instead of the old iframe embed. This removes the mobile-fragile browser PDF viewer dependency and gives users paging, zoom, and download fallback controls.

Operational checks completed from this repo:

- `npm run typecheck`, `VITE_API_BASE_URL=https://forg3.nak3deye.com npm run cap:sync`, `npm run smoke`, and `npm audit --audit-level=moderate --omit=dev` passed; audit reports 0 vulnerabilities after the `uuid` override in `package.json`.
- Production monitor: DNS `forg3.nak3deye.com -> 193.122.161.167` and public `/api/health` both passed.
- Backup: `.deploy/backups/forg3-staging-forg3-schema-20260714T095908Z.dump` created with `pg_dump --schema=forg3`.
- Restore drill: dump restored into a disposable local Postgres cluster with `--no-owner --no-privileges`; restored counts were `forg3_store_rows=1` and `forg3_objects_rows=4`.

Mobile shells were rebuilt with `VITE_API_BASE_URL=https://forg3.nak3deye.com` and verified to contain no stale `sign.nak3deye.com`, `150-136-152-51`, or `sslip.io` references. Artifacts:

- Android debug APK: `.deploy/mobile/forg3-forg3-domain-debug.apk` (SHA-256 `b83a82b6d5c356461cfec06c4d09df42998ee1e99f472e05c853dc43d7877dca`)
- Android signed release AAB for Play internal testing: `.deploy/mobile/forg3-play-internal-release.aab` (SHA-256 `3a919cc03275c1d27b04e65480f1776fe80270453e981fc0837445eed5e129ed`)
- iOS simulator app zip: `.deploy/mobile/forg3-forg3-domain-ios-simulator-app.zip` (SHA-256 `f3b8275e24d506ea962fe096a3161a686c2407b1aedf96a7115862cba23a43e1`)
- iOS unsigned device app zip: `.deploy/mobile/forg3-forg3-domain-ios-unsigned-device-app.zip` (SHA-256 `357251236bf3fb9083808c7d1fa396b193cbe83533796c3f771dc4495021b1df`)

## Architecture crib sheet

- Single Node/Express server serves API + built web client (`dist/`). Source: `server/` (TS, compiled to `dist-server/`), client `src/` (Vite + React, hash routing).
- Persistence: `server/store.ts` (whole-store jsonb row `forg3_store`, in-process cache + serialized write-through — **single app instance only**) and `server/objectStore.ts` (PDFs in `forg3_objects` bytea, AES-256-GCM sealed before write). File fallback when `DATABASE_URL` unset. Shared pool in `server/db.ts` (`DATABASE_SSL=no-verify` for Supabase pooler).
- Auth: email-code login → server-side session embedded in HMAC token (`server/auth.ts`), device trust 2FA, optional TOTP (`server/totp.ts`). Sessions/devices revocable at `#/settings`.
- Audit: owner-scoped hash-chained events (`store.appendAuditEvent`).
- Smoke suite: `npm run smoke` (20 checks) — CI runs it on file store AND a Postgres service container.
- Deployment runbook: `docs/DEPLOYMENT.md`. Env preflight in production lists missing vars and refuses to boot.

## Remaining work (priority order agreed with owner)

1. Managed DB + HTTPS staging: done and reverified on v4.
2. Real-device iOS/Android QA (priority 9): Android debug, Android signed AAB, iOS simulator, and iOS device-SDK builds compile against `https://forg3.nak3deye.com`. Runtime QA is still pending because no Android device/emulator was available, and iOS install/TestFlight is blocked by missing Apple account provisioning in Xcode. Required test path: email login, device 2FA, upload PDF, send email link, recipient-only access, signing, sealed PDF download, native purchase, restore purchase, and manage subscription. In-app account deletion (Apple requirement) already exists at `#/settings`.
3. Native billing (priority 7): server receipt-verification and webhook plumbing exists for Apple App Store Server API and Google Play Developer API, and native StoreKit 2 / Play Billing bridges now exist in the Capacitor shells. Remaining work is external store credentials/products, Apple notification certificate-chain validation, Google RTDN configuration, sandbox purchase tests, and the final per-signature billing model decision. Native mobile currently shows Pro/Business only; Pay Per Signature is hidden until the usage model is store-compliant. Product IDs are defined in `server/index.ts` (`com.forg3.sign.*` / `forg3_*`). See `docs/STORE_BILLING_IMPLEMENTATION.md`.
4. iOS TestFlight upload: blocked until Xcode has the Apple developer account/team and provisioning profile for `com.forg3.sign`. Local code compilation is no longer the blocker.
5. Legal review of `#/terms` / `#/privacy` before charging.
6. Optional hardening: passkeys, CA-backed PAdES signing cert, relational schema for multi-instance scaling (`docs/PRODUCTION_PERSISTENCE.md`), OCI limit-increase ticket.

## Gotchas

- **Never** run staging without `FORG3_OBJECT_ENCRYPTION_KEY` — rotating it orphans existing sealed PDFs (key lives in `.deploy` and in the container env).
- Login codes rate-limit hard (10/15min per IP, 30s resend cooldown) — during automated testing, reuse the trusted device id in `.deploy/forg3-v4-qa-device-id`.
- Demo billing is disabled in production; the staging owner works because `FORG3_CREATOR_EMAILS=st@nak3deye.com` grants creator access.
- Supabase MCP `execute_sql` runs as `postgres`, which cannot touch `forg3_app`-owned tables — connect as `forg3_app` (password in `.deploy/supabase-forg3app-password`) for data operations.
- Supabase/app-role dumps must use `pg_dump --schema=forg3`; whole-database dumps can fail on provider-owned schemas.
- PDF.js improved mobile signing reliability, but it also adds a large client asset (`pdf.worker` is about 2.2 MB and the main app chunk is above Vite's 500 KB warning threshold). Code-splitting the signing room is the next performance pass before broad launch.
