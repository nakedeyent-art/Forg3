# Forg3 Auth, Onboarding, and Signer Access

## Customer onboarding

Forg3 accounts are passwordless by default. A new user should be able to create a free account even if they only need to sign a packet.

Recipient/signee onboarding:

1. Open the email signing request or install Forg3 from the App Store or Google Play.
2. Sign in or create a free account with the exact email address assigned to the document.
3. Verify a new device with the Forg3 device 2FA flow.
4. Review and sign assigned packets without buying a sender plan.

Sender onboarding:

1. Install Forg3 from the App Store or Google Play.
2. Sign in with an email code, Apple, or Google.
3. Verify a new device with the Forg3 device 2FA flow.
4. Choose a paid sender plan.
5. Create and email signing packets after the store purchase is verified server-side.

Email-code login is the baseline production path. Apple and Google login require both:

- Public Firebase client config either bundled into the app with `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, or served at runtime by the API with `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_APP_ID`.
- Firebase Admin credentials on the API server so Forg3 can verify provider ID tokens before granting account access.

The web build uses Firebase popup auth only in normal browsers. Native/mobile runtimes use Firebase redirect auth and the login screen automatically finishes a pending redirect when the app returns.

Do not force Apple or Google buttons into native builds unless the provider path is configured and tested on real iOS and Android devices. If the runtime API config is used, the native bundle does not need a rebuild just to reveal the provider buttons.

## Sender and signer entitlement policy

Only the sender/document owner needs a paid Forg3 plan.

Recipients/signees may create and keep a free Forg3 account. They do not need a paid Forg3 account to open or complete an assigned packet. They must authenticate as the exact addressed recipient email and pass device verification, but they are not charged and should not see a sender-plan paywall unless they try to send their own signature requests.

Backend enforcement:

- Creating a document, rotating a link, and sending reminders require the sender owner's active entitlement.
- Signing checks the document owner's entitlement, not the recipient's subscription.
- Assigned recipient routes only return documents for the authenticated recipient email.

## Store billing launch requirements

Native store billing must be verified before public upload:

- App Store products must match the Apple product IDs in `server/index.ts`.
- Play Console products must match the Google product IDs in `server/index.ts`.
- Store purchase and restore must call `/api/subscription/verify`.
- The server must verify Apple/Google receipts before activating entitlement.
- Cancellation, refund, grace, hold, and renewal webhook paths must be tested.

Pay Per Signature remains a product-policy decision for native stores. The current mobile UI hides the metered plan in native runtime until the `$0.99/signature` usage model is packaged as store-compliant credits, prepaid usage, or another approved path.
