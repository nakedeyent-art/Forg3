# Deployment Readiness Audit — 2026-07-15

## Fixed In This Pass

- Corrected user-facing pricing copy to `$11.99/year`, `$18.99/month`, and `$39.99/month`.
- Rebuilt and synced native assets with `https://forg3.nak3deye.com`; mobile asset verification now passes.
- Disabled Android OS/cloud backup for the app package with `android:allowBackup="false"` and `android:fullBackupContent="false"`.
- Generated store screenshots and uploaded App Store screenshot sets for iPhone 6.9 and iPad 13.
- Configured Apple subscription localizations, group localization, review screenshots, availability, and Apple-equalized pricing across 175 territories.
- Created Firebase project support on existing Google project `bergen-project`, created the Forg3 Firebase web app, installed local Firebase Admin credentials under `.deploy/firebase/`, initialized Firebase Authentication, authorized `forg3.nak3deye.com`, and enabled the Google/Apple providers.
- Created Google Play RTDN Pub/Sub topic `projects/bergen-project/topics/forg3-play-rtdn`, granted Google Play publisher access, and created the push subscription to `https://forg3.nak3deye.com/api/billing/google/rtdn`.
- Registered `com.forg3.sign` in Android developer verification, granted the Forg3 app-scoped Play Console service-account permissions, and created/activated Google Play subscriptions `forg3_pro_monthly/monthly` and `forg3_business_monthly/monthly`.
- Removed accidental duplicate native config files with spaces in their filenames, which were blocking Android resource merging.
- Bumped Android internal `versionCode` to `2` while keeping customer-facing `versionName` at `1.0`, built a fresh signed AAB, and uploaded it to the Google Play internal testing track as a completed release.
- Added ignored `.env.production.local` launch-check support and verified `npm run verify:release-readiness` passes against the current live `https://forg3.nak3deye.com` stack without committing secrets.
- Updated billing/submission docs to match the live Apple/Google console state and the implemented receipt-verification code.

## Verified

- `npm run typecheck` passes.
- `npm run smoke` passes: 29 checks, including subscription gating, recipient-only access, signer inbox, sealed PDF download, and audit hash chain.
- `npm audit --omit=dev` reports 0 vulnerabilities.
- `npm run verify:mobile-release` passes for `https://forg3.nak3deye.com`.
- `npm run build:mobile:release` passes and syncs iOS/Android assets with `https://forg3.nak3deye.com`.
- `npm run monitor:production` passes against public `https://forg3.nak3deye.com/api/health`.
- `npm run verify:release-readiness` passes with ignored local launch-check env (`.env.production.local`) and verifies active Google Play subscription products.
- Android signed release bundle passes with Android Studio JDK 21: `.deploy/mobile/forg3-1.0-build3-play-release-20260718T145315Z.aab` (SHA-256 `a0ba27a83ac9356851ea0335325609a2da803bb946b7dd83f4d894797c52f4c4`).
- `npm run play:internal -- .deploy/mobile/forg3-1.0-build3-play-release-20260718T145315Z.aab` uploaded versionCode `3` to Play track `internal` with release status `completed` through the Google Play Developer API.
- Android debug build passes after backup hardening.
- iOS device app bundle validates with `codesign --verify --deep --strict`; bundle is `com.forg3.sign`, version `1.0`, build `3`.

## App Store Connect Reality

- Paid Apps Agreement, bank, W-9, and Digital Services Act compliance are active.
- App `Forg3` exists for bundle `com.forg3.sign`.
- iOS version `1.0` is still `PREPARE_FOR_SUBMISSION`.
- Build `3` is uploaded, `VALID`, and attached to the App Store version.
- Store screenshots are uploaded and processed: 8 `APP_IPHONE_67` and 8 `APP_IPAD_PRO_3GEN_129`.
- App metadata is mostly configured. App Store age-rating answers are configured with user-generated content disclosed and objectionable-content/web-access/gambling/chat/advertising answers set to none/false. Remaining app-level fields still need owner/legal answers: App Review contact first name, last name, phone, export compliance, and final submission confirmation.
- Subscription group `Forg3 Plans` exists with localization. `com.forg3.sign.pro.monthly` and `com.forg3.sign.business.monthly` are `READY_TO_SUBMIT`; Apple rejected independent submission because first subscriptions must be submitted with the app version. `com.forg3.sign.payper.yearly` is configured but hidden from native launch until per-signature billing is store-compliant.

## Google Play Reality

- App `Forg3` exists as package `com.forg3.sign` in draft/internal testing.
- Payments profile is connected to checking ending `187`, but bank verification is still pending.
- Android developer verification now lists `com.forg3.sign` as registered.
- Android Publisher API is enabled. Local service account `forg3-firebase-admin@bergen-project.iam.gserviceaccount.com` exists, has a key under `.deploy/firebase/`, and now has Forg3 app-scoped Play Console permissions sufficient for subscription/product writes.
- Google RTDN Pub/Sub topic, Google Play publisher IAM binding, push subscription, package env, and local webhook token are configured.
- Store products exist and are active: `forg3_pro_monthly/monthly` and `forg3_business_monthly/monthly`.
- Internal testing release versionCode `3` is uploaded/completed through the Play Developer API.
- The selected internal tester list is `Forg3 Internal Testers` with 1 user. Tester opt-in link: `https://play.google.com/apps/internaltest/4701195408144317865`.
- Opened the opt-in link on connected Android device `57221FDCG001AA`; Google Play returned "App not available" because that device's current Google account is not invited to the internal test. Screenshot: `.deploy/mobile/forg3-android-internaltest.png`.
- Payment-profile bank verification, Play app-content/store-listing submission fields, tester account correction/opt-in/install confirmation, and purchase/restore tests are still pending.

## Still Blocking Deployment

- Firebase Authentication is initialized for `bergen-project`; `forg3.nak3deye.com` is an authorized domain; Google and Apple providers are enabled. Google reports client credentials present. Apple reports enabled with Apple-specific config present, but still needs real-device redirect testing before it can be treated as launch-proven.
- Apple subscriptions are ready to submit with the app version, and Google Play Pro/Business products plus the internal testing release are active, but sandbox purchase/restore/webhook tests are not complete.
- App Store App Review contact/export compliance/final submit are not complete. Age-rating answers are now configured through the App Store Connect API.
- Google payment-profile bank verification is pending.
- Production runtime checks now pass for the current live stack. A dedicated long-term production database/instance split is still recommended before broad paid launch; current `https://forg3.nak3deye.com` remains the promoted OCI/Supabase live stack unless a separate production stack is provisioned.
