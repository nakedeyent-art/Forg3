# Store Billing Implementation Runbook

Phase 4 is code-implemented and store-product configured, but not sandbox-purchase proven. The server has fail-closed Apple App Store Server API and Google Play Developer API verification paths, plus idempotent Apple/Google webhook event logging. Apple client-supplied StoreKit payloads are not trusted as the entitlement source; the server uses them only to identify the transaction, then verifies through Apple's server API before granting access. The iOS and Android Capacitor shells include native purchase, restore, and manage-subscription bridges. Apple launch products are configured and ready to submit with the app version; Google Play launch products are active. Live entitlement still needs sandbox purchase/restore/webhook tests plus final store review submission.

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
- `APPLE_APP_STORE_ENVIRONMENT` (`sandbox` or `production`)
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

- Apple App Store Connect exists, paid agreements/bank/tax/compliance are active, app `Forg3` exists for bundle `com.forg3.sign`, build `3` is `VALID` and attached to version `1.0`, the App Store Server API key is installed locally, and the App Review detail, age-rating answers, and export-compliance answer are configured. `com.forg3.sign.pro.monthly` and `com.forg3.sign.business.monthly` are `READY_TO_SUBMIT` with 175 territory prices and review screenshots. Remaining Apple blockers are first-subscription submission with the app version, sandbox testers, production env injection, and sandbox purchase/restore/webhook tests.
- Google Play Console exists and app `Forg3` is registered as package `com.forg3.sign` in draft/internal testing. RTDN Pub/Sub topic/push route/token are configured locally. The Firebase service account has Forg3 app-scoped permissions, `forg3_pro_monthly/monthly` plus `forg3_business_monthly/monthly` are active, Android versionCode `2` is uploaded to the internal testing track, and selected tester list `Forg3 Internal Testers` contains 1 user. The connected Pixel's active Google account is not invited yet. Remaining Google blockers are payments profile bank verification, tester account correction/opt-in/install confirmation, app-content/store-listing final answers, production env injection, and sandbox purchase/restore/webhook tests.
- No approved per-signature mobile billing model has been selected; Pay Per Signature must stay hidden on native builds until this is resolved.
- Apple notification JWS signatures and certificate chains are validated before reconciliation, but sandbox/live notification delivery still needs to be tested from App Store Connect.
