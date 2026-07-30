# Forg3 Worktree Organization

Last updated: 2026-07-30

This file exists to keep local work from becoming one mixed pile. Every dirty file should belong to one named bucket before it is staged, committed, pushed, or handed off.

## Working Rule

- Keep one active bucket per task whenever possible.
- Run `git status --short` before editing and before final reporting.
- If a task must touch another bucket, name that bucket in the handoff before making the edit.
- Do not stage broad file sets blindly. Stage by bucket, then verify with `git diff --cached --name-status`.
- Do not push from a dirty worktree that contains files outside the bucket being shipped.

## Current Buckets

| Bucket | Purpose | Files |
| --- | --- | --- |
| `store-review-release` | App Store Connect, TestFlight, Google Play, API 36, review monitoring, and review-handoff state for Forg3 `1.0`. | `android/app/build.gradle`, `android/app/src/main/java/com/forg3/sign/Forg3BillingPlugin.java`, `android/variables.gradle`, `ios/App/App.xcodeproj/project.pbxproj`, `ios/App/App/Forg3BillingPlugin.swift`, `ios/App/ExportOptions-AppStore.plist`, `package.json`, `scripts/configure-app-store-products.mjs`, `scripts/configure-app-store-submission.mjs`, `scripts/configure-google-play-track.mjs`, `scripts/install-store-review-monitor-launchagent.mjs`, `scripts/monitor-store-review.mjs`, `docs/APPLE_REVIEW_REPLY.md`, `docs/APP_STORE_SUBMISSION.md`, `docs/CODEX_HANDOFF.md`, `docs/STORE_BILLING_IMPLEMENTATION.md` |
| `signing-hardening` | Runtime product hardening: signed-copy delivery, safer upload validation, signature target placement, PDF/non-PDF signer clarity, TOTP secret protection, and deployment drift checks. | `.github/workflows/ci.yml`, `Dockerfile`, `server/index.ts`, `server/pdf.ts`, `server/types.ts`, `src/App.tsx`, `src/components/PdfPreview.tsx`, `src/components/SignaturePad.tsx`, `src/lib/api.ts`, `src/lib/types.ts`, `src/styles.css`, `scripts/monitor-production.mjs`, `scripts/release-readiness.mjs`, `scripts/smoke.mjs` |
| `audit-notes` | Conservative product/security/launch audit notes from the 2026-07-24 pass. | `docs/FORG3_PESSIMISTIC_AUDIT_2026-07-24.md` |
| `worktree-organization` | This bucket map and the guardrail for future local changes. | `docs/WORKTREE_ORGANIZATION.md` |

## Commit Order

1. `signing-hardening`
2. `store-review-release`
3. `audit-notes`

The order matters because store-review-release references runtime behavior from signing-hardening, especially native-visible plan cards and signed-copy delivery checks.

## Cross-Bucket Files

Some files currently mix multiple concerns:

- `src/App.tsx` includes both runtime signing improvements and the Apple-review plan-card visibility fix.
- `server/index.ts` includes runtime signing hardening, public subscription plan metadata, billing status reporting, and production RTDN fail-closed behavior.
- `scripts/smoke.mjs` covers both runtime signing behavior and public subscription plan visibility.
- `docs/CODEX_HANDOFF.md` records both product state and store-review state.

If these need pristine commit separation, split them with `git add -p` and verify each staged hunk before committing.
