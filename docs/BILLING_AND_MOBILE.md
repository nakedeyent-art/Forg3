# Billing And Mobile Readiness

Forg3 Sign is structured as a subscription app. The current local build includes demo activation so the product can be tested end to end; production iOS and Android builds must use native store billing.

## Subscription Products

| Plan | Price label | Apple product ID | Google product ID |
| --- | --- | --- | --- |
| Forg3 Pay Per Signature | `$12/year + metered signature fee` | `com.forg3.sign.payper.yearly` | `forg3_pay_per_signature_yearly` |
| Forg3 Pro | `$19/month` | `com.forg3.sign.pro.monthly` | `forg3_pro_monthly` |
| Forg3 Business | `$49/month` | `com.forg3.sign.business.monthly` | `forg3_business_monthly` |

The local default metered fee is `$0.99` per completed signature. Set `PAY_PER_SIGNATURE_FEE_CENTS` to change the usage fee without changing code.

## Current Implementation

- The API stores account subscription records in `data/forg3-store.json`.
- `POST /api/subscription/checkout` activates a local demo subscription.
- `POST /api/documents` rejects link creation with `402` when entitlement is inactive.
- Completed signatures under the pay-per-signature plan create local usage charge records.
- `POST /api/subscription/verify` is reserved for production receipt verification.
- iOS and Android Capacitor shells already exist under `ios/` and `android/`.
- `npx cap sync` copies the latest web build into both native shells.

## iOS Production Path

1. In App Store Connect, create an auto-renewable subscription group.
2. Add `com.forg3.sign.payper.yearly`, `com.forg3.sign.pro.monthly`, and `com.forg3.sign.business.monthly` as subscription products.
3. Add the In-App Purchase capability to the Xcode project.
4. Implement StoreKit purchase and restore flows in the Capacitor iOS layer or through a vetted billing plugin.
5. Send signed transaction data to `POST /api/subscription/verify`.
6. Verify the transaction server-side with Apple App Store Server APIs.
7. Store the active entitlement only after server verification passes.
8. Design the per-signature usage charge as a store-compliant in-app purchase, consumable credit, or policy-approved billing path before release.
9. Test with StoreKit configuration and App Store sandbox testers.

Apple reference: https://developer.apple.com/app-store/subscriptions/

## Android Production Path

1. In Google Play Console, create subscription products matching `forg3_pay_per_signature_yearly`, `forg3_pro_monthly`, and `forg3_business_monthly`.
2. Add Google Play Billing to the Android project or through a vetted Capacitor billing plugin.
3. Start purchases from the native Android billing flow.
4. Send the purchase token to `POST /api/subscription/verify`.
5. Verify the purchase server-side through the Google Play Developer API.
6. Handle lifecycle changes through Real-time Developer Notifications.
7. Reconcile renewals, cancellations, grace periods, account holds, and refunds into entitlement state.
8. Design the per-signature usage charge as a Play-compliant in-app product, prepaid credit, or policy-approved billing path before release.
9. Test with Play Billing license testers.

Google references:

- https://developer.android.com/google/play/billing
- https://developer.android.com/google/play/billing/subscriptions
- https://developer.android.com/google/play/billing/lifecycle

## Store Review Notes

- Do not sell access to digital signing features through an external web payment link inside iOS/Android builds unless store policy for the target region explicitly allows that path.
- Keep demo billing disabled in production.
- Make subscription terms visible before purchase.
- Show the annual base charge and per-signature usage charge before the pay-per-signature purchase.
- Provide restore purchase and manage subscription affordances in native builds.
- The backend must remain the source of truth for entitlement.

## Build Commands

```bash
npm run build
npx cap sync
npm run ios:open
npm run android:open
```

Android local note: this Mac currently reports JDK 25. If Gradle fails, select/install JDK 17 or 21 for Android Studio/Gradle.
