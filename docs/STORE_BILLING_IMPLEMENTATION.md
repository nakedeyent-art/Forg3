# Store Billing Implementation Runbook

Phase 4 is code-implemented and store-product configured, but not sandbox-purchase proven. The server has fail-closed Apple App Store Server API and Google Play Developer API verification paths, plus idempotent Apple/Google webhook event logging. Apple client-supplied StoreKit payloads are not trusted as the entitlement source; the server uses them only to identify the transaction and preferred App Store environment, then verifies through Apple's server API before granting access. The iOS and Android Capacitor shells include native purchase, restore, and manage-subscription bridges. Apple rejected iOS version `1.0` build `5` on `2026-07-31`; build `6` is the corrective package for the provider-auth and sandbox-purchase errors. Google Play launch products are active. Live entitlement still needs sandbox purchase/restore/webhook tests plus Apple review monitoring.

## Official References Checked

- Apple App Store Server API: https://developer.apple.com/documentation/appstoreserverapi
- Apple App Store Server Notifications: https://developer.apple.com/documentation/appstoreservernotifications
- Google Play Developer API: https://developer.android.com/google/play/developer-api
- Google Play Billing lifecycle and RTDN: https://developer.android.com/google/play/billing/lifecycle
- Google Play RTDN reference: https://developer.android.com/google/play/billing/rtdn-reference
- Google Play Billing integration: https://developer.android.com/google/play/billing/integrate

## Required Product Setup

- Apple subscription products:
  - `com.forg3.sign.pro.monthly`
  - `com.forg3.sign.business.monthly`
- Google Play products:
  - `forg3_pro_monthly`
  - `forg3_business_monthly`
- Per-signature billing model decision:
  - prepaid consumable signature credits, or
  - approved external billing where allowed, or
  - remove per-signature metering from mobile store builds.

## Required Server Secrets

- `APPLE_APP_STORE_ISSUER_ID`
- `APPLE_APP_STORE_KEY_ID`
- `APPLE_APP_STORE_PRIVATE_KEY`, `APPLE_APP_STORE_PRIVATE_KEY_BASE64`, `APPLE_APP_STORE_PRIVATE_KEY_FILE`, or `APPLE_APP_STORE_PRIVATE_KEY_PATH`
- `APPLE_APP_STORE_BUNDLE_ID` (defaults to `com.forg3.sign`)
- `APPLE_APP_STORE_ENVIRONMENT` (`sandbox` or `production`; transaction JWS environment is preferred when present, with fallback to the alternate endpoint)
- `GOOGLE_PLAY_PACKAGE_NAME` (defaults to `com.forg3.sign`)
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, or `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_RTDN_VERIFICATION_TOKEN` or `BILLING_WEBHOOK_TOKEN` if Pub/Sub push uses a shared endpoint token.

## `/api/subscription/verify` Target Behavior

1. Require authenticated owner bearer token.
2. Accept provider, plan ID, product ID, purchase token or signed transaction payload.
3. Verify Apple transactions through App Store Server API and signed transaction payload parsing.
4. Verify Google purchases through Play Developer API.
5. Reject invalid, mismatched, refunded, canceled, or expired purchases.
6. Persist entitlement only after server verification passes.
7. Store provider transaction id and original transaction id / purchase token.
8. Never trust client-reported plan, price, status, or renewal date without provider verification.

## Lifecycle Webhook Targets

- `POST /api/billing/apple/notifications`
  - Decode App Store Server Notification v2 `signedPayload`.
  - Reconcile renewals, expirations, refunds, grace periods, and billing retry for an existing verified subscription.
  - Store provider notification id idempotently.
- `POST /api/billing/google/rtdn`
  - Require `GOOGLE_RTDN_VERIFICATION_TOKEN` / `BILLING_WEBHOOK_TOKEN` when configured.
  - Store RTDN provider event id idempotently.
  - Reconcile the existing subscription tied to the stored purchase-token hash.

## Entitlement Enforcement

- `POST /api/documents` requires an active entitlement before creating signer links.
- `POST /api/documents/:id/rotate-link` requires an active entitlement before reissuing signer links.
- `POST /api/documents/:id/remind` requires an active entitlement before emailing reminder signer links.
- Pay Per Signature is not a free-send mode: the `$11.99/year` base entitlement must be active before link issuance, and completed signatures are recorded as `$0.99/signature` metered usage by default.
- Monthly Pro / Business plans allow link issuance while active; canceled, expired, or past-due plans do not retain capabilities.

## Native UI Requirements

- StoreKit purchase and restore purchases on iOS. Implemented in `ios/App/App/Forg3BillingPlugin.swift`.
- Google Play Billing purchase and restore/query purchases on Android. Implemented in `android/app/src/main/java/com/forg3/sign/Forg3BillingPlugin.java`.
- Manage Subscription link/action. Implemented through the native bridge.
- Price disclosure before purchase, including annual base plus usage/credit model.
- No demo checkout path in production builds.
- Native mobile runtime currently shows Pro and Business only; Pay Per Signature is hidden until the usage model is store-compliant.
- Paid production launches should set `FORG3_REQUIRE_STORE_BILLING=true`; production boot then refuses to start unless Apple and Google billing verification credentials are present.

## Blockers

- Apple App Store Connect exists, paid agreements/bank/tax/compliance are active, app `Forg3` exists for bundle `com.forg3.sign`, build `5` was rejected for provider-auth and subscription-purchase errors, the App Store Server API key is installed locally, and the App Review detail, age-rating answers, App Privacy labels, pricing/category/content-rights metadata, and export-compliance answer are configured. The corrective build hides native Google/Apple provider buttons unless native provider auth is explicitly enabled and real-device tested, keeps StoreKit plan cards visible for creator/review accounts, and verifies Apple sandbox/review transactions against the correct App Store Server API environment. Remaining Apple work is upload/attach/resubmit build `6`, review monitoring, sandbox testers, production env injection, and sandbox purchase/restore/webhook tests.
- Google Play Console exists and app `Forg3` is registered as package `com.forg3.sign`. RTDN Pub/Sub topic/push route/token are configured locally. The Firebase service account has Forg3 app-scoped permissions, `forg3_pro_monthly/monthly` plus `forg3_business_monthly/monthly` are active, and closed testing Alpha release `3 (1.0)` was submitted on 2026-07-28 at 23:13 EDT with 177 countries/regions and tester lists `Forg3 Internal Testers` with 2 users plus `The Daily Edge Android List` with 7 users. The 2026-07-29 Google Play target API issue was fixed by raising Android compile/target SDK to API 36, building signed `versionCode 4`, and uploading `.deploy/mobile/forg3-1.0-build4-api36-play-release-20260729T174006Z.aab` to Internal and Alpha; Android Publisher API readback at `2026-07-29T17:47:32Z` shows `internal=Forg3 1.0 (4):completed` and `alpha=Forg3 1.0 (4):completed`. Play dashboard showed `0 testers currently opted-in` and `Apply for production` disabled at 23:16 EDT. Play App content has no pending declarations, and the default store listing has icon, feature graphic, 8 phone screenshots, 8 7-inch tablet screenshots, and 8 10-inch tablet screenshots. Remaining Google blockers are adding at least 3 more eligible testers, tester opt-in/install confirmation, sandbox purchase/restore/webhook tests, production env injection, and Google's production-access gate requiring at least 12 opted-in closed-test testers for at least 14 continuous days before applying for production.
- No approved per-signature mobile billing model has been selected; Pay Per Signature must stay hidden on native builds until this is resolved.
- Apple notification JWS signatures and certificate chains are validated before reconciliation, but sandbox/live notification delivery still needs to be tested from App Store Connect.
