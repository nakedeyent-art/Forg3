# Codex Handoff — Forg3 Sign

_Last updated: 2026-07-16 UTC (Codex session: v9 redeploy, Cloudflare DNS cutover, account-deletion release verification)_

## Current live state

| Thing | Value |
| --- | --- |
| Staging URL | **https://forg3.nak3deye.com** live. Cloudflare DNS has a proxied A record `forg3.nak3deye.com -> 132.226.52.71`; Cloudflare SSL/TLS mode is `Full`. |
| Compute | OCI container instance `forg3-staging-v9` (us-ashburn, `CI.Standard.A1.Flex` 1 OCPU / 2 GB), containers: `forg3-app` + `caddy`, public IP `132.226.52.71` |
| Database | **Supabase managed Postgres**, project `forg3-staging` (ref `qmipdkaoptxsevlfkrfm`, us-east-1, free tier, daily backups). App connects as role `forg3_app` via session pooler `aws-0-us-east-1.pooler.supabase.com:5432`, schema `forg3` (NOT exposed via Supabase REST API) |
| Image | `ghcr.io/nakedeyent-art/forg3:main` (multi-arch, published by CI on every push to main) |
| Repo | github.com/nakedeyent-art/Forg3, default branch `main`, CI green on commit `c990c1d Add public account deletion page`; `publish-ghcr` completed in CI run `29488283590` |
| Old staging | v7 is deleted after quota cleanup. v8 remains active as rollback but is no longer the Cloudflare DNS target. Current live DNS target is v9 only. |
| Local secrets/state | `~/Documents/Forg3/.deploy/` (git-ignored): OCIDs, device id, Supabase `forg3_app` password, encryption key, test artifacts |

## How current live staging works

- Both containers share the pod network. `caddy` runs a generated Caddyfile for `forg3.nak3deye.com` with `tls internal` and proxies to `127.0.0.1:4127`. Cloudflare terminates the public certificate and connects to origin in `Full` mode. This avoids ephemeral-container Let's Encrypt duplicate-certificate rate limits.
- The v6 app container booted successfully: `storage: postgres, encrypted at rest: yes`.
- Public health is live: `https://forg3.nak3deye.com/api/health` returns `{"ok":true,"service":"forg3",...}`.
- If the instance is recreated, the IP changes. Update the proxied Cloudflare A record to the new public IP.
- OCI tenancy limits are 0 for managed PostgreSQL **and** reserved public IPs, so `forg3.nak3deye.com` currently points at the instance's ordinary public IP. A limit-increase ticket would unlock reserved-IP stability.
- NSG allows 80 (ACME) / 443 / 4127 ingress.

## Pone production-domain resend (2026-07-15 UTC)

Pone's combined signing packet was sent through the live production-domain stack:

- Recipient: Harold Ponder aka Pone `<euponder@gmail.com>`.
- Sender account: Nak3d Eye Enterprises `<st@nak3deye.com>`.
- Document ID: `665d1384-bd64-48ba-a831-a8398223c45a`.
- Signer ID: `b7d38548-cd22-453f-af0b-c026aebe140d`.
- Document hash: `4a4138a30b4e69c748d7dbd0aa21eea113ee5e510a1660a036207f04e5d18cb6`.
- Delivery: Microsoft Graph `sent`, provider sender `st@nak3deye.com`, reply-to `st@nak3deye.com`, Sent Items confirmed at `2026-07-15T04:43:09Z`.
- Recipient-only checks: unauthenticated assigned signer API returned `401`; sender account probing Pone's assigned signer API returned `404`.
- Local rights-packet log: `/Users/rizzolini/Documents/Nak3d Eye Music/rights_packets/09_outgoing_email_packets/Pone_Forg3_2026-07-15/SENT_LOG_2026-07-15.md`.

## End-to-end verification history

Live v9 status (2026-07-16 UTC): `forg3.nak3deye.com` is proxied through Cloudflare to OCI v9 (`132.226.52.71`), public `/api/health` passes over HTTPS, and the live frontend bundle contains the public account-deletion route (`#/account-deletion`). The v9 app boot log shows `storage: postgres, encrypted at rest: yes`. Pone's production-domain packet was sent earlier through Microsoft Graph; completion of that specific signed/sealed loop still depends on Pone opening and signing the packet.

Prior full signing loop on v4 (2026-07-14 UTC):

Email-code login (real Microsoft Graph delivery) → device 2FA → document create (creator account `st@nak3deye.com`) → signing-link email from `st@nak3deye.com` with `https://forg3.nak3deye.com/#/inbox/sign/...` URL → unauthenticated assigned-room open returned `401` → verified recipient opened room → signed → owner downloaded sealed PDF → audit chain `auth.login → auth.mfa_verified → document.created → document.viewed → document.signer_signed → document.signed` links intact. Sealed test PDF: `.deploy/forg3-v4-signed.pdf`.

Feature status on the live stack: email delivery configured via Microsoft Graph; object storage configured as Postgres-backed encrypted blobs with `encryptedAtRest=true`.

The signing-room PDF surface now uses a PDF.js canvas renderer (`src/components/PdfPreview.tsx`) instead of the old iframe embed. This removes the mobile-fragile browser PDF viewer dependency and gives users paging, zoom, and download fallback controls.

Operational checks completed from this repo:

- `npm run build:mobile:release`, `npm run typecheck`, `npm run build`, `npm run smoke`, `npm run verify:release-readiness`, and `npm audit --omit=dev` passed on 2026-07-16; audit reports 0 vulnerabilities. Release mobile assets verify against `https://forg3.nak3deye.com`.
- Production monitor: Cloudflare proxied DNS for `forg3.nak3deye.com` points at v9 (`132.226.52.71` origin), public `/api/health` passes over HTTPS, and the live index `Last-Modified` matches the v9 deployment timestamp (`Thu, 16 Jul 2026 09:49:27 GMT`).
- `npm run store:screenshots` generated App Store/Play screenshots. `npm run appstore:screenshots` uploaded 8 iPhone 6.9 and 8 iPad 13 screenshots; all are asset-delivery `COMPLETE`.
- `npm run appstore:products` configured Apple subscription group/product localizations, review screenshots, availability, and Apple-equalized pricing. `Forg3 Pro` and `Forg3 Business` are `READY_TO_SUBMIT`; Apple requires first subscriptions to be submitted with the app version.
- Firebase web app exists on Google project `bergen-project`; public config and local Admin credential are installed in `.env.local` / `.deploy/firebase/`. Firebase Auth is initialized, `forg3.nak3deye.com` is authorized, and Google/Apple providers are enabled. Google has client credentials present; Apple is enabled with Apple-specific config present but still needs real-device redirect testing before launch.
- Google Play RTDN topic `projects/bergen-project/topics/forg3-play-rtdn`, publisher IAM grant, local token, and push subscription are configured. Play Console grants the Firebase service account app-scoped Forg3 permissions. `forg3_pro_monthly/monthly` and `forg3_business_monthly/monthly` exist and are active in Google Play.
- `npm run play:internal -- .deploy/mobile/forg3-1.0-build2-play-release-20260715T112303Z.aab` uploaded Android versionCode `2` to Play track `internal` with release status `completed`. Play Console shows `Forg3 1.0 (2)` active and available to internal testers, released July 15, 2026 at 7:24 AM, not reviewed yet.
- Play internal testing has selected list `Forg3 Internal Testers` with 1 user. Tester opt-in link: `https://play.google.com/apps/internaltest/4701195408144317865`.
- Android device `57221FDCG001AA` opened that opt-in link, but Google Play reported the current account is not invited. Screenshot: `.deploy/mobile/forg3-android-internaltest.png`.
- `npm run verify:release-readiness` passes using ignored local launch-check env `.env.production.local`; the check verifies public health, mobile release assets, email/Firebase/store billing credentials, active Google Play products, and RTDN protection.
- Backup: `.deploy/backups/forg3-staging-forg3-schema-20260714T095908Z.dump` created with `pg_dump --schema=forg3`.
- Restore drill: dump restored into a disposable local Postgres cluster with `--no-owner --no-privileges`; restored counts were `forg3_store_rows=1` and `forg3_objects_rows=4`.

Mobile shells were rebuilt with `VITE_API_BASE_URL=https://forg3.nak3deye.com` and verified to contain no stale `sign.nak3deye.com`, `150-136-152-51`, or `sslip.io` references. Artifacts:

- Android debug APK: `.deploy/mobile/forg3-forg3-domain-debug.apk` (SHA-256 `b83a82b6d5c356461cfec06c4d09df42998ee1e99f472e05c853dc43d7877dca`)
- Android signed release AAB for Play internal testing: `.deploy/mobile/forg3-play-internal-release.aab` (SHA-256 `3a919cc03275c1d27b04e65480f1776fe80270453e981fc0837445eed5e129ed`)
- Current signed Android release AAB: `.deploy/mobile/forg3-1.0-build2-play-release-20260715T112303Z.aab` (SHA-256 `680c29e254fb28c1da3296787b4960480dcad8ed8ba0f3c754d3b29c5f33f50b`)
- iOS simulator app zip: `.deploy/mobile/forg3-forg3-domain-ios-simulator-app.zip` (SHA-256 `f3b8275e24d506ea962fe096a3161a686c2407b1aedf96a7115862cba23a43e1`)
- iOS unsigned device app zip: `.deploy/mobile/forg3-forg3-domain-ios-unsigned-device-app.zip` (SHA-256 `357251236bf3fb9083808c7d1fa396b193cbe83533796c3f771dc4495021b1df`)
- Android hardware launch screenshot after refreshed branding: `.deploy/mobile/forg3-android-branded-launch-20260714T194736Z.png`.

## Architecture crib sheet

- Single Node/Express server serves API + built web client (`dist/`). Source: `server/` (TS, compiled to `dist-server/`), client `src/` (Vite + React, hash routing).
- Persistence: `server/store.ts` (whole-store jsonb row `forg3_store`, in-process cache + serialized write-through — **single app instance only**) and `server/objectStore.ts` (PDFs in `forg3_objects` bytea, AES-256-GCM sealed before write). File fallback when `DATABASE_URL` unset. Shared pool in `server/db.ts` (`DATABASE_SSL=no-verify` for Supabase pooler).
- Auth: email-code login → server-side session embedded in HMAC token (`server/auth.ts`), device trust 2FA, optional TOTP (`server/totp.ts`). Sessions/devices revocable at `#/settings`.
- Audit: owner-scoped hash-chained events (`store.appendAuditEvent`).
- Smoke suite: `npm run smoke` (20 checks) — CI runs it on file store AND a Postgres service container.
- Deployment runbook: `docs/DEPLOYMENT.md`. Env preflight in production lists missing vars and refuses to boot.

## Remaining work (priority order agreed with owner)

1. Managed DB + HTTPS staging: done and reverified on v9.
2. Real-device iOS/Android QA (priority 9): Android signed AAB builds with JDK 21 and versionCode `2` is uploaded to Play internal testing. `adb devices` currently lists no Android hardware, and `xcrun xctrace list devices` currently shows the physical iPhones/iPad as offline. Full runtime QA is still pending for paid purchase/restore/manage flows. Required final test path: email login, device 2FA, upload PDF, send email link, recipient-only access, signing, sealed PDF download, native purchase, restore purchase, and manage subscription. In-app account deletion exists at `#/settings`, and the public deletion page exists at `#/account-deletion`.
3. Native billing (priority 7): server receipt-verification and webhook plumbing exists for Apple App Store Server API and Google Play Developer API, and native StoreKit 2 / Play Billing bridges now exist in the Capacitor shells. Apple client StoreKit payloads are no longer trusted directly; the server verifies through App Store Server API before entitlement. Apple Pro/Business products are ready to submit with the app version. Google Play Pro/Business products are active and Android internal release versionCode `2` is uploaded. Remaining work is sandbox purchase tests, Google payment-profile bank verification, adding/switching to the Android device's Google tester account, tester opt-in/install confirmation, and the final per-signature billing model decision. Native mobile currently shows Pro/Business only; Pay Per Signature is hidden until the usage model is store-compliant. Product IDs are defined in `server/index.ts` (`com.forg3.sign.*` / `forg3_*`). See `docs/STORE_BILLING_IMPLEMENTATION.md`.
4. iOS TestFlight/App Store status: App Store Connect app/version exists for `com.forg3.sign`; build `3` is attached and valid. The iOS version remains `PREPARE_FOR_SUBMISSION`. App Review detail/contact, review notes, demo account, age rating, and export compliance are configured; build `3` reports `usesNonExemptEncryption=false`, and the iOS shell now sets `ITSAppUsesNonExemptEncryption=false` for future uploads. Final submission has not been created.
5. Legal review of `#/terms` / `#/privacy` before charging. Release-candidate copy and checklist live in `docs/LEGAL_COMPLIANCE_RELEASE.md`.
6. Production infrastructure split: the current live OCI/Supabase stack passes release readiness and can be treated as the promoted launch stack if the owner accepts it. A separate long-term production database/instance, reserved IP, backup automation, and monitoring policy are still recommended before broad paid launch. See `docs/PRODUCTION_LAUNCH_RUNBOOK.md`.
7. External console gates: App Store Connect app metadata, App Review detail, age rating, and export compliance are configured; final app-version submission still requires explicit owner approval. Google Play internal track is active with `Forg3 1.0 (2)`; the Android Publisher API shows no Google Groups configured for the internal tester track, and individual email-list membership is not exposed through that API. Tester opt-in/device install and sandbox purchase verification are still pending. Firebase provider setup is complete, but native Google/Apple signup still needs real-device verification.
8. Optional hardening: passkeys, CA-backed PAdES signing cert, relational schema for multi-instance scaling (`docs/PRODUCTION_PERSISTENCE.md`), OCI limit-increase ticket.

## Gotchas

- **Never** run staging without `FORG3_OBJECT_ENCRYPTION_KEY` — rotating it orphans existing sealed PDFs (key lives in `.deploy` and in the container env).
- Login codes rate-limit hard (10/15min per IP, 30s resend cooldown) — during automated testing, reuse a current trusted test device id recorded under `.deploy/`.
- Demo billing is disabled in production; the staging owner works because `FORG3_CREATOR_EMAILS=st@nak3deye.com` grants creator access.
- Use `npm run build:mobile:release` before every native upload; it rebuilds with `VITE_API_BASE_URL=https://forg3.nak3deye.com`, syncs Capacitor, and verifies the generated mobile bundles.
- Use Android Studio's bundled JDK 21 for signed Android bundles: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- Supabase MCP `execute_sql` runs as `postgres`, which cannot touch `forg3_app`-owned tables — connect as `forg3_app` (password in `.deploy/supabase-forg3app-password`) for data operations.
- Supabase/app-role dumps must use `pg_dump --schema=forg3`; whole-database dumps can fail on provider-owned schemas.
- PDF.js improved mobile signing reliability, but it also adds a large client asset (`pdf.worker` is about 2.2 MB and the main app chunk is above Vite's 500 KB warning threshold). Code-splitting the signing room is the next performance pass before broad launch.
