# Forg3 Store Submission Packet

Last updated: 2026-07-16

## App Identity

| Field | Value |
| --- | --- |
| App name | Forg3 |
| Version | 1.0 |
| iOS bundle ID | `com.forg3.sign` |
| Android package | `com.forg3.sign` |
| Production API base | `https://forg3.nak3deye.com` |
| Support email | `st@nak3deye.com` |
| Support URL | `https://forg3.nak3deye.com/#/privacy` |
| Privacy URL | `https://forg3.nak3deye.com/#/privacy` |
| Terms URL | `https://forg3.nak3deye.com/#/terms` |

## App Store Connect Status

- App Store Connect app exists: `Forg3`, app id `6790994628`, bundle `com.forg3.sign`, SKU `com.forg3.sign`.
- iOS version `1.0` exists and is `WAITING_FOR_REVIEW` as of 2026-07-16.
- Build `3` is uploaded, `VALID`, and attached to iOS version `1.0`.
- Paid Apps Agreement, bank account, W-9, and Digital Services Act compliance are active.
- App metadata is configured through API/UI: name, subtitle, privacy URL, description, keywords, support URL, screenshots, content-rights declaration, primary category `BUSINESS`, free app download pricing, and copyright `2026 NAK3D EYE ENTERPRISES`.
- App Store screenshots are uploaded and asset-processed: 8 for `APP_IPHONE_67`, 8 for `APP_IPAD_PRO_3GEN_129`.
- App Store age-rating answers are configured through the App Store Connect API: user-generated content is disclosed, and objectionable-content/web-access/gambling/chat/advertising answers are set to none/false.
- App Review detail/contact, reviewer notes, and demo account are configured. Build `3` declares `usesNonExemptEncryption=false`; the iOS shell also includes `ITSAppUsesNonExemptEncryption=false` for future uploads. API status on 2026-07-16: iOS version `1.0` is `WAITING_FOR_REVIEW`, build `3` is attached/valid, review detail is present, age rating is configured, app privacy is published, and review submission `08bf5fb1-1e5b-4647-a651-b6a9bbcc7e32` has been sent to Apple.
- Apple subscription group `Forg3 Plans` exists with group localization. `Forg3 Pro` and `Forg3 Business` are `WAITING_FOR_REVIEW` with Apple-equalized pricing across 175 territories and subscription review screenshots. Apple requires the first subscriptions to be submitted with the app version, and both launch subscriptions are included in the app review package.
- `Forg3 Pay Per Signature` is also configured in App Store Connect, but it remains hidden from the first native mobile launch until the per-signature usage model is packaged as store-managed credits or another approved model.

## Store Description

Forg3 is a secure e-signature app for sending PDF documents to assigned recipients by email. Senders upload a PDF, choose the recipient, and Forg3 delivers an email link that only the addressed recipient can open after email/device verification. Completed documents are sealed into a downloadable PDF with signature metadata, document hashes, timestamps, and an audit certificate page.

## Short Description

Secure PDF e-signatures with email-verified recipient access.

## Keywords

e-signature, electronic signature, PDF signing, document signing, secure documents, audit trail, business forms, contracts

## Review Notes

Use the review account supplied in App Review / Google Play sign-in details. Review builds should set `FORG3_REVIEW_ACCESS_EMAIL` and `FORG3_REVIEW_ACCESS_CODE`, and include that same email in `FORG3_CREATOR_EMAILS`, so reviewers can sign in with a reusable six-digit code and test paid sender flows without inbox access or a store purchase. The app requires device verification on a new device before documents or recipient rooms open. A subscription is required before a non-creator account can send signature requests. The account deletion control is available in Account settings and permanently removes documents, files, devices, sessions, and account history.

Forg3 currently creates electronic signature stamps and audit certificate pages. It does not claim to provide notarization or certificate-authority-backed PAdES signatures unless a production certificate provider is configured.

## First Mobile Launch Products

Pay Per Signature remains hidden in native iOS/Android builds until usage billing is packaged as store-managed credits or another approved model.

| Tier | Apple product ID | Google product ID | Launch status |
| --- | --- | --- | --- |
| Forg3 Pro monthly | `com.forg3.sign.pro.monthly` | `forg3_pro_monthly` | Required |
| Forg3 Business monthly | `com.forg3.sign.business.monthly` | `forg3_business_monthly` | Required |
| Forg3 Pay Per Signature yearly | `com.forg3.sign.payper.yearly` | `forg3_pay_per_signature_yearly` | Web/staged only; hidden in native |

## Google Play Internal Testing

- Android `versionName` is `1.0`; internal Play upload number is `versionCode 2`.
- Latest signed AAB: `.deploy/mobile/forg3-1.0-build2-play-release-20260715T112303Z.aab`.
- Uploaded through `npm run play:internal` to track `internal` with release status `completed`; Play Console shows `Forg3 1.0 (2)` active and available to internal testers.
- Selected tester lists: `Forg3 Internal Testers` with 2 users (`st@nak3deye.com`, `SeanETerry@gmail.com`) plus `The Daily Edge Android List` with 7 users. Play Console shows both lists checked and saved on 2026-07-16.
- Tester opt-in link: `https://play.google.com/apps/internaltest/4701195408144317865`.
- Android Publisher API status on 2026-07-16: internal track contains `Forg3 1.0 (2)` with `status=completed`; `edits.testers` returns no Google Groups for the internal track. Play App content shows no pending declarations and 10 actioned declarations dated July 16, 2026. Default store listing is ready to send for review with the Forg3 app name, descriptions, icon, feature graphic, 8 phone screenshots, 8 7-inch tablet screenshots, and 8 10-inch tablet screenshots. Current local `adb devices` lists no Android hardware, so tester opt-in/install and sandbox purchase/restore testing are still pending on a connected invited device.
- Google Play production access is still gated by Google: the app dashboard requires a closed test with at least 12 opted-in testers for at least 14 days before `Apply for production` becomes available.

## Required Sandbox Tests

- Purchase Pro from a new account, confirm `/api/subscription/verify` activates entitlement, then create and email a signing request.
- Restore Pro on the same account after reinstall.
- Manage subscription opens App Store / Play subscription management.
- Cancel renewal and verify lifecycle webhook reconciliation.
- Refund/revoke or test expired subscription and confirm the API blocks creating, rotating, or reminding signing links.
- Purchase Business and confirm unlimited/highest-tier capabilities.
- Confirm Pay Per Signature does not display in native builds.

## Privacy Labels / Data Safety

Published App Store privacy labels on 2026-07-16. Declare collection of:

- Contact info: Email Address.
- User content: Other User Content for uploaded PDFs, signature image, signed PDFs, and document packets.
- Identifiers: User ID and Device ID for account/session/device verification.
- Purchases: Purchase History for App Store subscription entitlement/restore records.
- Usage data: Product Interaction for app-functionality audit/security events such as document create/view/sign and delivery state.

All published data types are marked as used for App Functionality, linked to the user's identity, and not used for tracking. Do not declare advertising tracking. Forg3 does not sell document contents and does not intentionally capture signer IP or user-agent data in signing records.

## Screenshot Checklist

- Dashboard with subscription state visible.
- Send PDF form with recipient email.
- Recipient verification screen.
- Signing room with PDF preview and signature pad.
- Signed completion/download screen.
- Account settings with 2FA, trusted devices, export, delete account, terms/privacy.
- Billing panel showing Pro and Business plans only on native.

## Build Commands

```bash
npm run store:screenshots
npm run appstore:screenshots
npm run appstore:products
npm run appstore:submission status
npm run appstore:submission configure
npm run build:mobile:release
npm run verify:mobile-release
npm run play:products
npm run play:internal -- .deploy/mobile/<new-versioncode-release>.aab
```

For a different production origin:

```bash
VITE_API_BASE_URL=https://forg3.nak3deye.com npm run build:mobile:release
```
