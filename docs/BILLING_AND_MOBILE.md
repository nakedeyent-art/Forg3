# Billing And Mobile Readiness

Forg3 Sign is structured as a subscription app. The current local build includes demo activation so the product can be tested end to end; production iOS and Android builds must use native store billing.

Native builds now include StoreKit 2 / Google Play Billing bridges. Production entitlement is still server-verified: a native purchase must return a real Apple signed transaction payload or Google purchase token, and `/api/subscription/verify` must accept it before the account becomes active.

## Subscription Products

| Plan | Price label | Apple product ID | Google product ID |
| --- | --- | --- | --- |
| Forg3 Pay Per Signature | `$12/year + metered signature fee` | `com.forg3.sign.payper.yearly` | `forg3_pay_per_signature_yearly` |
| Forg3 Pro | `$19/month` | `com.forg3.sign.pro.monthly` | `forg3_pro_monthly` |
| Forg3 Business | `$49/month` | `com.forg3.sign.business.monthly` | `forg3_business_monthly` |

The local default metered fee is `$0.99` per completed signature. Set `PAY_PER_SIGNATURE_FEE_CENTS` to change the usage fee without changing code.

Mobile launch note: native iOS/Android builds currently show Pro and Business only. Pay Per Signature remains available to the web/server model, but it is intentionally hidden in native store runtime until the per-signature fee is packaged as store-managed consumable credits, prepaid entitlement, or another policy-approved billing path.

## Current Implementation

- The API stores account subscription records in `data/forg3-store.json`.
- `POST /api/subscription/checkout` activates a local demo subscription.
- `POST /api/documents` rejects link creation with `402` when entitlement is inactive.
- Completed signatures under the pay-per-signature plan create local usage charge records.
- `POST /api/subscription/verify` is reserved for production receipt verification.
- iOS and Android Capacitor shells already exist under `ios/` and `android/`.
- `src/lib/nativeBilling.ts` calls the native `Forg3Billing` plugin for purchase, restore, and manage-subscription actions.
- iOS implements the bridge in `ios/App/App/Forg3BillingPlugin.swift` with StoreKit 2.
- Android implements the bridge in `android/app/src/main/java/com/forg3/sign/Forg3BillingPlugin.java` with Play Billing `9.1.0`.
- Restore purchase and manage subscription controls are exposed in native builds.
- `npx cap sync` copies the latest web build into both native shells.

## iOS Production Path

1. In App Store Connect, create an auto-renewable subscription group.
2. Add `com.forg3.sign.pro.monthly` and `com.forg3.sign.business.monthly` as subscription products for the first mobile launch.
3. Enable in-app purchases for bundle id `com.forg3.sign` and make sure the signing profile covers the capability.
4. Configure `APPLE_APP_STORE_ISSUER_ID`, `APPLE_APP_STORE_KEY_ID`, and `APPLE_APP_STORE_PRIVATE_KEY` on the server.
5. Send signed transaction data from the native StoreKit bridge to `POST /api/subscription/verify`.
6. Verify the transaction server-side with Apple App Store Server APIs.
7. Store the active entitlement only after server verification passes.
8. Test purchase, restore, cancellation, renewal, and refund paths with App Store sandbox testers.
9. Add Pay Per Signature only after the per-signature usage charge is store-compliant.

Apple reference: https://developer.apple.com/app-store/subscriptions/

## Android Production Path

1. In Google Play Console, create subscription products matching `forg3_pro_monthly` and `forg3_business_monthly` for the first mobile launch.
2. Configure `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` or `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` on the server.
3. Start purchases from the native Android Play Billing flow.
4. Send the purchase token to `POST /api/subscription/verify`.
5. Verify the purchase server-side through the Google Play Developer API.
6. Handle lifecycle changes through Real-time Developer Notifications.
7. Reconcile renewals, cancellations, grace periods, account holds, and refunds into entitlement state.
8. Test purchase, restore/query purchases, cancellation, renewal, and refund paths with Play Billing license testers.
9. Add Pay Per Signature only after the usage charge is Play-compliant.

Google references:

- https://developer.android.com/google/play/billing
- https://developer.android.com/google/play/billing/subscriptions
- https://developer.android.com/google/play/billing/lifecycle

## Store Review Notes

- Do not sell access to digital signing features through an external web payment link inside iOS/Android builds unless store policy for the target region explicitly allows that path.
- Keep demo billing disabled in production.
- Make subscription terms visible before purchase.
- Do not show Pay Per Signature in native builds until the annual base charge and usage model are store-managed or otherwise approved.
- Provide restore purchase and manage subscription affordances in native builds.
- The backend must remain the source of truth for entitlement.

## Build Commands

```bash
npm run build
npx cap sync
npm run ios:open
npm run android:open
```

Android local note: this Mac currently reports JDK 25 by default. Gradle builds are verified with JDK 21 by setting `JAVA_HOME=/usr/local/opt/openjdk@21`.
