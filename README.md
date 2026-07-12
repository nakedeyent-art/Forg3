# Forg3 Sign

Forg3 Sign is a lightweight DocuSign-style e-signature app. It lets an owner upload a PDF, create an expiring signing link, collect a drawn electronic signature, stamp the signature onto the PDF, and download the signed copy.

## What is built

- React/Vite dashboard for creating and tracking signature packets.
- Express API for real expiring signing links.
- Subscription entitlement gate before signing links can be created.
- Hash-only token storage: raw signing links are returned once and are not stored.
- Single-use sealing: after a customer signs, the token hash is removed and the link no longer resolves.
- Touch-ready signature pad for finger, stylus, mouse, and touchpad signing.
- PDF stamping with signer name, signer email, timestamp, and original document hash.
- Google/Apple sign-in buttons with Firebase Auth support when Firebase env values are configured.
- Flat subscriptions plus a low-cost annual pay-per-signature plan.
- Capacitor configuration for iOS and Android shells.

## Run locally

```bash
npm install
npm run dev
```

Open the web app at `http://127.0.0.1:5173`.

The API runs at `http://127.0.0.1:4127` and stores local data in `data/forg3-store.json`.

## Subscription model

The app is subscription-gated. A signed-in owner must have an active entitlement before the API will create a signing link.

Local development includes demo subscription activation from the billing panel. Production mobile builds should replace demo checkout with StoreKit / Google Play Billing purchase flows and server-side receipt verification.

The occasional-use plan charges a $12 annual base subscription plus a metered charge for each completed signature. The local default is `$0.99/signature`; change `PAY_PER_SIGNATURE_FEE_CENTS` to adjust that amount.

Current product IDs:

| Plan | Price model | Apple product ID | Google product ID |
| --- | --- | --- | --- |
| Forg3 Pay Per Signature | `$12/year + usage` | `com.forg3.sign.payper.yearly` | `forg3_pay_per_signature_yearly` |
| Forg3 Pro | `$19/month` | `com.forg3.sign.pro.monthly` | `forg3_pro_monthly` |
| Forg3 Business | `$49/month` | `com.forg3.sign.business.monthly` | `forg3_business_monthly` |

Important endpoints:

- `GET /api/subscription?ownerEmail=...`
- `POST /api/subscription/checkout` for local demo activation.
- `POST /api/subscription/verify` reserved for StoreKit / Play Billing receipt verification.
- `POST /api/subscription/cancel`

## Google and Apple login

Without Firebase values, the Google and Apple buttons run in local demo mode. To use real accounts:

1. Create a Firebase project.
2. Enable Google and Apple providers in Firebase Authentication.
3. Copy `.env.example` to `.env.local`.
4. Fill in:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

The app will automatically use Firebase popup auth when all values are present.

## Mobile builds

Install dependencies and build once:

```bash
npm install
npm run build
```

Add native projects:

```bash
npx cap add ios
npx cap add android
```

Sync future changes:

```bash
npm run cap:sync
```

Open native projects:

```bash
npm run ios:open
npm run android:open
```

For mobile production builds, deploy the Express API to an HTTPS host and set `VITE_API_BASE_URL` to that host before `npm run cap:sync`.

For subscription compliance, configure auto-renewable subscription products in App Store Connect and subscription products in Google Play Console, then connect native purchase receipt verification to the backend. See [docs/BILLING_AND_MOBILE.md](docs/BILLING_AND_MOBILE.md).

## Production notes

This is an electronic-signature workflow, not a certificate-authority-backed cryptographic PDF signature. For production legal enforceability, keep counsel involved and decide the exact audit-retention policy. The current app intentionally avoids IP and user-agent capture and keeps only the minimum document/signature metadata.

The Claude audit handoff lives at [docs/CLAUDE_AUDIT_HANDOFF.md](docs/CLAUDE_AUDIT_HANDOFF.md).
