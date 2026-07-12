# Store Billing Implementation Runbook

Phase 4 is blocked until App Store Connect, Google Play Console, sandbox products, server credentials, and the per-signature billing model are approved. The current API fails closed: `/api/subscription/verify` returns `501` and does not grant entitlement.

## Official References Checked

- Apple App Store Server API: https://developer.apple.com/documentation/appstoreserverapi
- Apple App Store Server Notifications: https://developer.apple.com/documentation/appstoreservernotifications
- Google Play Developer API: https://developer.android.com/google/play/developer-api
- Google Play Billing lifecycle and RTDN: https://developer.android.com/google/play/billing/lifecycle
- Google Play RTDN reference: https://developer.android.com/google/play/billing/rtdn-reference
- Google Play Billing integration: https://developer.android.com/google/play/billing/integrate

## Required Product Setup

- Apple subscription products:
  - `com.forg3.sign.payper.yearly`
  - `com.forg3.sign.pro.monthly`
  - `com.forg3.sign.business.monthly`
- Google Play products:
  - `forg3_pay_per_signature_yearly`
  - `forg3_pro_monthly`
  - `forg3_business_monthly`
- Per-signature billing model decision:
  - prepaid consumable signature credits, or
  - approved external billing where allowed, or
  - remove per-signature metering from mobile store builds.

## Required Server Secrets

- Apple issuer ID.
- Apple key ID.
- Apple private key.
- Apple bundle ID.
- Apple environment selector: sandbox or production.
- Google service account credentials with Play Developer API access.
- Google package name.
- Pub/Sub verification configuration for Google RTDN.

## `/api/subscription/verify` Target Behavior

1. Require authenticated owner bearer token.
2. Accept provider, plan ID, product ID, purchase token or signed transaction payload.
3. Verify Apple transactions through App Store Server API / signed JWS verification.
4. Verify Google purchases through Play Developer API.
5. Reject invalid, mismatched, refunded, canceled, or expired purchases.
6. Persist entitlement only after server verification passes.
7. Store provider transaction id and original transaction id / purchase token.
8. Never trust client-reported plan, price, status, or renewal date without provider verification.

## Lifecycle Webhook Targets

- `POST /api/billing/apple/notifications`
  - Verify App Store Server Notification v2 `signedPayload`.
  - Reconcile renewals, expirations, refunds, grace periods, and billing retry.
  - Store provider notification id idempotently.
- `POST /api/billing/google/rtdn`
  - Verify Google Pub/Sub push message.
  - Use the purchase token from RTDN to query Play Developer API.
  - Reconcile entitlement from provider source of truth.

## Native UI Requirements

- StoreKit purchase and restore purchases on iOS.
- Google Play Billing purchase and restore/query purchases on Android.
- Manage Subscription link/action.
- Price disclosure before purchase, including annual base plus usage/credit model.
- No demo checkout path in production builds.

## Blockers

- No Apple App Store Connect credentials are available in this repo/session.
- No Google Play service account or package/product configuration is available.
- No approved per-signature mobile billing model has been selected.
- No public webhook endpoint is provisioned for Apple or Google notifications.
