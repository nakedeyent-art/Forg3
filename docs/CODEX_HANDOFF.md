# Codex Handoff — Forg3 Sign

_Last updated: 2026-07-18 UTC (Codex session: v14 redeploy, multi-file document signing support)_

## Current live state

| Thing | Value |
| --- | --- |
| Staging URL | **https://forg3.nak3deye.com** live. Cloudflare DNS has a proxied A record `forg3.nak3deye.com -> 150.136.165.165`; Cloudflare SSL/TLS mode is `Full`. |
| Compute | OCI container instance `forg3-staging-v14` (us-ashburn, `CI.Standard.A1.Flex` 1 OCPU / 2 GB), containers: `forg3-app` + `caddy`, public IP `150.136.165.165` |
| Database | **Supabase managed Postgres**, project `forg3-staging` (ref `qmipdkaoptxsevlfkrfm`, us-east-1, free tier, daily backups). App connects as role `forg3_app` via session pooler `aws-0-us-east-1.pooler.supabase.com:5432`, schema `forg3` (NOT exposed via Supabase REST API) |
| Image | `ghcr.io/nakedeyent-art/forg3:dba7ff239415c5d31e77a6e7549a8d32f5d2d75d` (multi-arch, published by CI on every push to main) |
| Repo | github.com/nakedeyent-art/Forg3, default branch `main`, CI green on commit `dba7ff2 Support signing non-PDF document files`; `publish-ghcr` completed in CI run `29630716059` |
| Old staging | v7/v8/v9/v10/v11/v12 are deleted after quota cleanup. v13 remains active as temporary rollback but is no longer the Cloudflare DNS target. Current live DNS target is v14 only. |
| Local secrets/state | `~/Documents/Forg3/.deploy/` (git-ignored): OCIDs, device id, Supabase `forg3_app` password, encryption key, test artifacts |

## How current live staging works

- Both containers share the pod network. `caddy` runs a generated Caddyfile for `forg3.nak3deye.com` with `tls internal` and proxies to `127.0.0.1:4127`. Cloudflare terminates the public certificate and connects to origin in `Full` mode. This avoids ephemeral-container Let's Encrypt duplicate-certificate rate limits.
- The v14 app container boots with Postgres persistence and encrypted object storage; direct origin `/api/health` passes at `150.136.165.165`.
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

Live v14 status (2026-07-18 UTC): `forg3.nak3deye.com` is proxied through Cloudflare to OCI v14 (`150.136.165.165`), public `/api/health` passes over HTTPS, and the public bundle includes the new document upload UI for PDF, Word, Excel, PowerPoint, CSV/text, and RTF. PDFs are stamped directly; non-PDF originals are preserved unchanged and sealed into a signed certificate PDF that includes the original file name/type/hash, signer evidence, and audit certificate. The public `/api/auth/firebase-config` response still includes the CSP that allows Firebase/Google/Apple auth network and iframe routes. Creator unlimited access is configured through `FORG3_CREATOR_EMAILS`; API agents can use the secret override code only after normal auth/device trust and only when their email is listed in `FORG3_AGENT_OVERRIDE_EMAILS`. Pone's production-domain packet was sent earlier through Microsoft Graph; completion of that specific signed/sealed loop still depends on Pone opening and signing the packet.

Public multi-file verification (2026-07-18 UTC): through `https://forg3.nak3deye.com`, Codex completed email-code login → device 2FA → active creator entitlement check → Word-style `.docx` upload → email delivery record creation → assigned signer room open → PNG signature submit → owner signed certificate PDF download. Public smoke artifact: `.deploy/forg3-public-v14-word-smoke.json`; certificate PDF: `.deploy/forg3-public-v14-word-smoke.pdf`.

Signer mismatch incident/fix (2026-07-17 UTC): live data showed a newer packet `TERRY_97352` assigned to `sterry973@gmail.com` while the mobile browser session was logged in as `st@nak3deye.com`, which correctly produced the server-side recipient-only `404` but previously rendered as the vague "Link unavailable / Document not found for this signer." Commit `562df73` keeps the same privacy-preserving access denial but maps that case to "Use the recipient email", shows the current signed-in email, and offers "Switch account."

Prior full signing loop on v4 (2026-07-14 UTC):

Email-code login (real Microsoft Graph delivery) → device 2FA → document create (creator account `st@nak3deye.com`) → signing-link email from `st@nak3deye.com` with `https://forg3.nak3deye.com/#/inbox/sign/...` URL → unauthenticated assigned-room open returned `401` → verified recipient opened room → signed → owner downloaded sealed PDF → audit chain `auth.login → auth.mfa_verified → document.created → document.viewed → document.signer_signed → document.signed` links intact. Sealed test PDF: `.deploy/forg3-v4-signed.pdf`.

Feature status on the live stack: email delivery configured via Microsoft Graph; object storage configured as Postgres-backed encrypted blobs with `encryptedAtRest=true`.

The signing-room PDF surface now uses a PDF.js canvas renderer (`src/components/PdfPreview.tsx`) instead of the old iframe embed. This removes the mobile-fragile browser PDF viewer dependency and gives users paging, zoom, and download fallback controls.

Operational checks completed from this repo:

- `npm run build:mobile:release`, `npm run typecheck`, `npm run build`, `npm run smoke`, `npm run verify:release-readiness`, and `npm audit --omit=dev` passed on 2026-07-16; audit reports 0 vulnerabilities. Release mobile assets verify against `https://forg3.nak3deye.com`. The override release was rechecked on 2026-07-17 with `npm run verify:release-readiness`.
- Production monitor: Cloudflare proxied DNS for `forg3.nak3deye.com` points at v14 (`150.136.165.165` origin), public `/api/health` passes over HTTPS, public bundle contains the multi-file document upload UI, and `npm run monitor:production` passes.
- Firebase auth CSP fix (2026-07-17): v11 blocked Firebase Auth with `connect-src 'self'` / `frame-src 'self' data:`, which could surface as `auth/network-request-failed` for Google/Apple login. v12 allows `https://*.googleapis.com`, `https://*.firebaseapp.com`, `https://*.firebaseio.com`, `https://accounts.google.com`, and `https://appleid.apple.com` in the appropriate CSP directives. Verified direct-origin and public Cloudflare headers after cutover.
- Signer mismatch UX fix (2026-07-17): `npm run typecheck`, `npm run build`, `npm run smoke` (48 checks), `VITE_API_BASE_URL=https://forg3.nak3deye.com npm run cap:sync`, remote CI run `29614142920`, `npm run monitor:production`, `npm run verify:release-readiness`, and `npm run verify:mobile-release` all passed after the v13 cutover.
- Multi-file document signing fix (2026-07-18): `npm run typecheck`, `npm run build`, `npm run smoke` (52 checks), `VITE_API_BASE_URL=https://forg3.nak3deye.com npm run cap:sync`, `npm run verify:mobile-release`, and remote CI run `29630716059` all passed on commit `dba7ff2`. OCI v14 was deployed from the GHCR image, Cloudflare DNS was cut over to `150.136.165.165`, public bundle checks confirmed the document upload UI, and the public Word-file signing smoke completed through `https://forg3.nak3deye.com`.
- `npm run store:screenshots` generated App Store/Play screenshots. `npm run appstore:screenshots` uploaded 8 iPhone 6.9 and 8 iPad 13 screenshots; all are asset-delivery `COMPLETE`.
- `npm run appstore:products` configured Apple subscription group/product localizations, review screenshots, availability, and Apple-equalized pricing. `Forg3 Pro` and `Forg3 Business` are submitted with app version `1.0` and currently `WAITING_FOR_REVIEW`.
- Firebase web app exists on Google project `bergen-project`; public config and local Admin credential are installed in `.env.local` / `.deploy/firebase/`. Firebase Auth is initialized, `forg3.nak3deye.com` is authorized, and Google/Apple providers are enabled. Google has client credentials present; Apple is enabled with Apple-specific config present but still needs real-device redirect testing before launch.
- Google Play RTDN topic `projects/bergen-project/topics/forg3-play-rtdn`, publisher IAM grant, local token, and push subscription are configured. Play Console grants the Firebase service account app-scoped Forg3 permissions. `forg3_pro_monthly/monthly` and `forg3_business_monthly/monthly` exist and are active in Google Play.
- `npm run play:internal -- .deploy/mobile/forg3-1.0-build2-play-release-20260715T112303Z.aab` uploaded Android versionCode `2` to Play track `internal` with release status `completed`. Play Console shows `Forg3 1.0 (2)` active and available to internal testers, released July 15, 2026 at 7:24 AM, not reviewed yet.
- Play internal testing has selected tester lists `Forg3 Internal Testers` with 2 users (`st@nak3deye.com`, `SeanETerry@gmail.com`) and `The Daily Edge Android List` with 7 users. Tester opt-in link: `https://play.google.com/apps/internaltest/4701195408144317865`.
- Play App content shows no pending declarations; 10 declarations are actioned as of July 16, 2026. The default store listing is ready to send for review with the Forg3 name/descriptions, icon, feature graphic, 8 phone screenshots, 8 7-inch tablet screenshots, and 8 10-inch tablet screenshots. The 7-inch tablet screenshot bucket was filled through the Android Publisher API and verified with a fresh edit readback.
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
- Persistence: `server/store.ts` (whole-store jsonb row `forg3_store`, in-process cache + serialized write-through — **single app instance only**) and `server/objectStore.ts` (uploaded/signed document objects in `forg3_objects` bytea, AES-256-GCM sealed before write). File fallback when `DATABASE_URL` unset. Shared pool in `server/db.ts` (`DATABASE_SSL=no-verify` for Supabase pooler).
- Auth: email-code login → server-side session embedded in HMAC token (`server/auth.ts`), device trust 2FA, optional TOTP (`server/totp.ts`). Sessions/devices revocable at `#/settings`.
- Audit: owner-scoped hash-chained events (`store.appendAuditEvent`).
- Smoke suite: `npm run smoke` (52 checks) — CI runs it on file store AND a Postgres service container.
- Deployment runbook: `docs/DEPLOYMENT.md`. Env preflight in production lists missing vars and refuses to boot.

## Remaining work (priority order agreed with owner)

1. Managed DB + HTTPS staging: done and reverified on v9.
2. Real-device iOS/Android QA (priority 9): Android signed AAB builds with JDK 21 and versionCode `2` is uploaded to Play internal testing. `adb devices` currently lists no Android hardware. Full runtime QA is still pending for paid purchase/restore/manage flows. Required final test path: email login, device 2FA, upload PDF/Word/Excel/PowerPoint, send email link, recipient-only access, signing, signed package download, native purchase, restore purchase, and manage subscription. In-app account deletion exists at `#/settings`, and the public deletion page exists at `#/account-deletion`.
3. Native billing (priority 7): server receipt-verification and webhook plumbing exists for Apple App Store Server API and Google Play Developer API, and native StoreKit 2 / Play Billing bridges now exist in the Capacitor shells. Apple client StoreKit payloads are no longer trusted directly; the server verifies through App Store Server API before entitlement. Apple Pro/Business products are submitted with app version `1.0` and are `WAITING_FOR_REVIEW`. Google Play Pro/Business products are active and Android internal release versionCode `2` is uploaded. Remaining work is sandbox purchase tests, tester opt-in/install confirmation, Google's 12-tester/14-day closed-test production gate, and the final per-signature billing model decision. Native mobile currently shows Pro/Business only; Pay Per Signature is hidden until the usage model is store-compliant. Product IDs are defined in `server/index.ts` (`com.forg3.sign.*` / `forg3_*`). See `docs/STORE_BILLING_IMPLEMENTATION.md`.
4. iOS TestFlight/App Store status: App Store Connect app/version exists for `com.forg3.sign`; build `3` is attached and valid. The iOS version `1.0` is `WAITING_FOR_REVIEW` as of 2026-07-16. App Review detail/contact, review notes, demo account, age rating, app metadata, free download pricing, App Privacy labels, and export compliance are configured; build `3` reports `usesNonExemptEncryption=false`, and the iOS shell now sets `ITSAppUsesNonExemptEncryption=false` for future uploads. Review package `08bf5fb1-1e5b-4647-a651-b6a9bbcc7e32` includes the app version, `Forg3 Plans` subscription group, `com.forg3.sign.pro.monthly`, and `com.forg3.sign.business.monthly`.
5. Legal review of `#/terms` / `#/privacy` before charging. Release-candidate copy and checklist live in `docs/LEGAL_COMPLIANCE_RELEASE.md`.
6. Production infrastructure split: the current live OCI/Supabase stack passes release readiness and can be treated as the promoted launch stack if the owner accepts it. A separate long-term production database/instance, reserved IP, backup automation, and monitoring policy are still recommended before broad paid launch. See `docs/PRODUCTION_LAUNCH_RUNBOOK.md`.
7. External console gates: App Store Connect app metadata, App Review detail, age rating, App Privacy, pricing, content rights, copyright, primary category, and export compliance are configured; the app is submitted and waiting for Apple review. Google Play internal track is active with `Forg3 1.0 (2)`; App content is caught up, default store listing assets are complete, and the internal testing track has both `Forg3 Internal Testers` and `The Daily Edge Android List` selected. Tester opt-in/device install, sandbox purchase verification, and Google's required 12-tester/14-day closed test are still pending. Firebase provider setup is complete, but native Google/Apple signup still needs real-device verification.
8. Optional hardening: passkeys, CA-backed PAdES signing cert, relational schema for multi-instance scaling (`docs/PRODUCTION_PERSISTENCE.md`), OCI limit-increase ticket.

## Gotchas

- **Never** run staging without `FORG3_OBJECT_ENCRYPTION_KEY` — rotating it orphans existing sealed document objects (key lives in `.deploy` and in the container env).
- Login codes rate-limit hard (10/15min per IP, 30s resend cooldown) — during automated testing, reuse a current trusted test device id recorded under `.deploy/`.
- Demo billing is disabled in production; creator/review accounts work because `FORG3_CREATOR_EMAILS` grants creator access. Agent override code is stored only in ignored local state at `.deploy/forg3-agent-override-code`; do not print or commit it.
- Use `npm run build:mobile:release` before every native upload; it rebuilds with `VITE_API_BASE_URL=https://forg3.nak3deye.com`, syncs Capacitor, and verifies the generated mobile bundles.
- Use Android Studio's bundled JDK 21 for signed Android bundles: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`.
- Supabase MCP `execute_sql` runs as `postgres`, which cannot touch `forg3_app`-owned tables — connect as `forg3_app` (password in `.deploy/supabase-forg3app-password`) for data operations.
- Supabase/app-role dumps must use `pg_dump --schema=forg3`; whole-database dumps can fail on provider-owned schemas.
- PDF.js improved mobile signing reliability, but it also adds a large client asset (`pdf.worker` is about 2.2 MB and the main app chunk is above Vite's 500 KB warning threshold). Code-splitting the signing room is the next performance pass before broad launch.
