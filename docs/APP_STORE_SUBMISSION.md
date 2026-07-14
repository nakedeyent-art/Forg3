# Forg3 Store Submission Packet

Last updated: 2026-07-14

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

## Store Description

Forg3 is a secure e-signature app for sending PDF documents to assigned recipients by email. Senders upload a PDF, choose the recipient, and Forg3 delivers an email link that only the addressed recipient can open after email/device verification. Completed documents are sealed into a downloadable PDF with signature metadata, document hashes, timestamps, and an audit certificate page.

## Short Description

Secure PDF e-signatures with email-verified recipient access.

## Keywords

e-signature, electronic signature, PDF signing, document signing, secure documents, audit trail, business forms, contracts

## Review Notes

Use the test account supplied in App Review notes to sign in with email code authentication. The app requires device verification on a new device before documents or recipient rooms open. A subscription is required before a non-creator account can send signature requests. The account deletion control is available in Account settings and permanently removes documents, files, devices, sessions, and account history.

Forg3 currently creates electronic signature stamps and audit certificate pages. It does not claim to provide notarization or certificate-authority-backed PAdES signatures unless a production certificate provider is configured.

## First Mobile Launch Products

Pay Per Signature remains hidden in native iOS/Android builds until usage billing is packaged as store-managed credits or another approved model.

| Tier | Apple product ID | Google product ID | Launch status |
| --- | --- | --- | --- |
| Forg3 Pro monthly | `com.forg3.sign.pro.monthly` | `forg3_pro_monthly` | Required |
| Forg3 Business monthly | `com.forg3.sign.business.monthly` | `forg3_business_monthly` | Required |
| Forg3 Pay Per Signature yearly | `com.forg3.sign.payper.yearly` | `forg3_pay_per_signature_yearly` | Web/staged only; hidden in native |

## Required Sandbox Tests

- Purchase Pro from a new account, confirm `/api/subscription/verify` activates entitlement, then create and email a signing request.
- Restore Pro on the same account after reinstall.
- Manage subscription opens App Store / Play subscription management.
- Cancel renewal and verify lifecycle webhook reconciliation.
- Refund/revoke or test expired subscription and confirm the API blocks creating, rotating, or reminding signing links.
- Purchase Business and confirm unlimited/highest-tier capabilities.
- Confirm Pay Per Signature does not display in native builds.

## Privacy Labels / Data Safety

Declare collection of:

- Contact info: account email, signer email.
- User content: uploaded PDFs, signature image, signed PDFs.
- Identifiers: hashed device identifiers, subscription transaction identifiers.
- Diagnostics/security: audit events, delivery status, authentication/session events.

Do not declare advertising tracking. Forg3 does not sell document contents and does not intentionally capture signer IP or user-agent data in signing records.

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
npm run build:mobile:release
npm run verify:mobile-release
```

For a different production origin:

```bash
VITE_API_BASE_URL=https://forg3.nak3deye.com npm run build:mobile:release
```
