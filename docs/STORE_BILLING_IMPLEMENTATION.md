# Store Billing Implementation Runbook

Phase 4 is code-implemented but not store-live. The server has fail-closed Apple App Store Server API and Google Play Developer API verification paths, plus idempotent Apple/Google webhook event logging. The iOS and Android Capacitor shells now include native purchase, restore, and manage-subscription bridges. Live store entitlement still cannot be granted until store products, store credentials, and sandbox/live purchase tests are configured.

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
- `APPLE_APP_STORE_PRIVATE_KEY` or `APPLE_APP_STORE_PRIVATE_KEY_BASE64`
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

## Native UI Requirements

- StoreKit purchase and restore purchases on iOS. Implemented in `ios/App/App/Forg3BillingPlugin.swift`.
- Google Play Billing purchase and restore/query purchases on Android. Implemented in `android/app/src/main/java/com/forg3/sign/Forg3BillingPlugin.java`.
- Manage Subscription link/action. Implemented through the native bridge.
- Price disclosure before purchase, including annual base plus usage/credit model.
- No demo checkout path in production builds.
- Native mobile runtime currently shows Pro and Business only; Pay Per Signature is hidden until the usage model is store-compliant.

## Blockers

- No Apple App Store Connect credentials, sandbox tester setup, or valid local provisioning profile are available in this repo/session.
- No Google Play service account, package/product setup, license tester setup, or RTDN Pub/Sub route is available in this repo/session.
- No approved per-signature mobile billing model has been selected; Pay Per Signature must stay hidden on native builds until this is resolved.
- Apple notification JWS certificate-chain validation is not implemented; the endpoint only reconciles existing subscriptions and must not be treated as a standalone entitlement grant.
