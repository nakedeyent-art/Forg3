# Forg3 Sign

Forg3 Sign is a lightweight DocuSign-style e-signature app. It lets an owner upload a PDF, create an expiring signing link, collect a drawn electronic signature, stamp the signature onto the PDF, and download the signed copy.

## What is built

- React/Vite dashboard for creating and tracking signature packets.
- Express API for real expiring signing links.
- Subscription entitlement gate before signing links can be created.
- Hash-only token storage: raw signing tokens are not stored, and sender-facing links use assigned recipient routes.
- Single-use sealing: after a customer signs, the token hash is removed and the link no longer resolves.
- External signer delivery through the configured email provider.
- Device-based email 2FA before accounts or recipient documents open on a new device.
- Addressed-recipient document access: signer PDFs require the signed-in email to match the assigned signer.
- Touch-ready signature pad for finger, stylus, mouse, and touchpad signing.
- PDF stamping with signer name, signer email, timestamp, and original document hash.
- Google/Apple sign-in buttons with Firebase Auth support when Firebase env values are configured.
- Flat subscriptions plus a low-cost annual pay-per-signature plan.
- Creator-unlimited access through `FORG3_CREATOR_EMAILS`; outside creator accounts, only the highest tier has unlimited access.
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

Creator accounts are configured with `FORG3_CREATOR_EMAILS` on the server. Those accounts can create and manage packets without a paid subscription. For paying customers, unlimited access is reserved for the highest tier, Forg3 Business. Pro is a capped flat tier, and Pay Per Signature remains metered per completed signature.

The occasional-use plan charges a $12 annual base subscription plus a metered charge for each completed signature. The local default is `$0.99/signature`; change `PAY_PER_SIGNATURE_FEE_CENTS` to adjust that amount.

Current product IDs:

| Plan | Price model | Apple product ID | Google product ID |
| --- | --- | --- | --- |
| Forg3 Pay Per Signature | `$12/year + usage` | `com.forg3.sign.payper.yearly` | `forg3_pay_per_signature_yearly` |
| Forg3 Pro | `$19/month`, capped below unlimited | `com.forg3.sign.pro.monthly` | `forg3_pro_monthly` |
| Forg3 Business | `$49/month`, highest-tier unlimited | `com.forg3.sign.business.monthly` | `forg3_business_monthly` |

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

## External signer delivery

Forg3 emails signers an assigned signing URL when an email provider is configured. The server builds signer links from `PUBLIC_SIGNING_BASE_URL`, so set it to the deployed HTTPS web app before sending real packets.

```bash
PUBLIC_SIGNING_BASE_URL=https://sign.example.com
EMAIL_PROVIDER=microsoft_graph
MICROSOFT_GRAPH_TENANT_ID=
MICROSOFT_GRAPH_CLIENT_ID=
MICROSOFT_GRAPH_CLIENT_SECRET=
MICROSOFT_GRAPH_SENDER=st@nak3deye.com
MICROSOFT_GRAPH_USE_FROM_ALIAS=false
FORG3_EMAIL_FROM=st@nak3deye.com
FORG3_EMAIL_REPLY_TO=st@nak3deye.com
EMAIL_SEND_AS_OWNER=false
```

When `EMAIL_PROVIDER=microsoft_graph` is configured, new packets and reminder sends call Microsoft Graph for signer emails. `EMAIL_PROVIDER=resend` is also supported. Without provider credentials, delivery attempts stay in the local outbox for development.

The recipient-visible From mailbox is the authenticated sender mailbox. For Sean's Forg3 account that is `st@nak3deye.com`. To show another owner address, such as `wincey@winceyco.com`, the email provider must be authorized to send as that mailbox or domain. Set `EMAIL_SEND_AS_OWNER=true` only after that provider authorization is in place. Otherwise Forg3 uses the configured sender mailbox and places the document owner email in Reply-To plus the email body.

Delivery records keep provider status and message IDs, but stored message bodies redact the reusable signing URL. The raw signing URL is returned only in the create-link response and is delivered directly to the configured provider.

## Account and recipient security

Forg3 supports Google/Apple login when Firebase is configured and a first-party email-code login when it is not. After primary login, Forg3 requires a trusted-device check. A new browser or device must enter a six-digit code emailed to the account address before account data, recipient inboxes, or signing-room PDFs are available.

```bash
APP_AUTH_SECRET=
DEVICE_TRUST_SECRET=
FORG3_DEVICE_2FA=true
FORG3_MFA_CODE_TTL_MINUTES=10
FORG3_TRUSTED_DEVICE_DAYS=30
```

Set `APP_AUTH_SECRET` and `DEVICE_TRUST_SECRET` to strong server-side secrets in every deployed environment. Recipient links use `#/inbox/sign/{documentId}/{signerId}` and the backend only returns the document when the signed-in email matches the assigned signer. Legacy raw token links are also guarded by the same signed-in recipient check.

### Hardened security layer (Phase 10-11)

- **Authenticator-app MFA (TOTP).** Any account can enroll a standard RFC 6238 authenticator app from `#/settings`. Once active, every email-code login also requires the 6-digit app code — email compromise alone is no longer enough.
- **Server-side sessions with revocation.** Email-code logins create a server session embedded in the token. Sessions can be revoked one at a time or all at once ("Sign out everywhere") and revoked tokens are rejected immediately.
- **Trusted-device management.** The settings screen lists trusted devices and lets the account remove any of them, forcing fresh two-factor verification.
- **Hash-chained audit log.** Logins, MFA events, session/device revocations, document creation, views, signatures, voids, and subscription changes append to an owner-scoped audit chain where each event commits to the previous one's hash.
- **Abuse protection.** Dedicated rate limits on the login/2FA code endpoints plus a per-account resend cooldown (`FORG3_AUTH_CODE_LIMIT`, `FORG3_AUTH_VERIFY_LIMIT`, `FORG3_CODE_RESEND_COOLDOWN_SECONDS`).
- **Encryption at rest.** With `FORG3_OBJECT_ENCRYPTION_KEY` set (required in production), uploaded and sealed PDFs are stored AES-256-GCM encrypted.
- **Data controls.** `#/settings` offers a full JSON account export and a confirmed, irreversible account deletion that removes documents, files, devices, sessions, and history.
- **Legal surfaces.** Pilot terms of service and privacy policy live at `#/terms` and `#/privacy`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: dependency install, app/server typechecks, full build, a 20-check backend smoke suite (`npm run smoke`) covering auth, sessions, TOTP-aware login, signing, sealing, audit chaining, and revocation, plus a high-severity dependency audit.

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

### Remaining gaps before a paid public launch

These still require external services, credentials, or human steps and are intentionally not faked in code:

1. **Managed database + cloud object storage.** The store is guarded (`ALLOW_FILE_STORE_IN_PRODUCTION`) and objects are encrypted at rest, but production should move to Postgres plus a private cloud bucket. See [docs/PRODUCTION_PERSISTENCE.md](docs/PRODUCTION_PERSISTENCE.md).
2. **Native billing.** App Store / Play Billing receipt verification endpoints exist (`/api/subscription/verify`) but need store credentials and StoreKit/Play Billing client work. See [docs/STORE_BILLING_IMPLEMENTATION.md](docs/STORE_BILLING_IMPLEMENTATION.md).
3. **CA-backed PDF signatures** (PAdES) need a signing certificate/provider (`PDF_SIGNING_CERT_P12_BASE64`).
4. **Real-device iOS/Android QA** and app-store compliance review.
5. **Legal review** of the pilot terms/privacy text before charging outside customers.

The Claude audit handoff lives at [docs/CLAUDE_AUDIT_HANDOFF.md](docs/CLAUDE_AUDIT_HANDOFF.md).

The Nak3d Eye Music replacement workflow for DocuSign lives at [docs/NAK3D_EYE_MUSIC_SIGNING_WORKFLOW.md](docs/NAK3D_EYE_MUSIC_SIGNING_WORKFLOW.md).
