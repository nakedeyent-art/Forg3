# Legal And Compliance Release Checklist

Last updated: 2026-07-14

This is an operator checklist, not legal advice. Complete it before charging outside customers.

## Current Legal Posture

- Forg3 creates electronic signature stamps and an audit certificate page.
- Forg3 does not currently create a CA-backed PAdES digital signature unless `PDF_SIGNING_CERT_P12_BASE64` and `PDF_SIGNING_CERT_PASSWORD` are configured with a real signing-certificate provider.
- Recipient access is email-addressed and device-verified.
- Stored documents and signed packages are encrypted at rest when `FORG3_OBJECT_ENCRYPTION_KEY` is configured.
- Account deletion and JSON export are available in Account settings.

## Decisions To Lock Before Public Paid Launch

1. Whether electronic signature stamping is enough for the first target markets and document categories.
2. Whether audit logs should continue avoiding IP/user-agent capture, or whether legal wants those fields for fraud/enforceability.
3. Backup retention duration, deletion retention window, and whether signed audit records must be retained after account deletion.
4. Whether W-2, 1099, W-9, tax, payroll, notarized, healthcare, real-estate, or regulated documents are allowed, blocked, or shown with warnings.
5. Whether Pay Per Signature launches only on web, or becomes prepaid store-managed signature credits for iOS/Android.

## Terms/Privacy Release Requirements

- Terms and privacy surfaces are in-app at `#/terms` and `#/privacy`.
- Store listing must use the same privacy claims as the app policy.
- Support email: `st@nak3deye.com`.
- Privacy URL: `https://forg3.nak3deye.com/#/privacy`.
- Terms URL: `https://forg3.nak3deye.com/#/terms`.
- App Review notes must identify the in-app account deletion path.

## PAdES / Certificate Path

Launch without PAdES only if counsel confirms the first release is a standard electronic-signature workflow.

To launch with CA-backed PDF signatures:

1. Select a signing-certificate provider.
2. Provision a certificate/key usable for server-side PDF signing.
3. Configure `PDF_SIGNING_CERT_P12_BASE64` and `PDF_SIGNING_CERT_PASSWORD`.
4. Add provider identity and certificate details to the audit certificate page.
5. Add a verification test that confirms PDF signature validity in Adobe Acrobat or another trusted validator.

## No-Go Conditions

- Store billing products are not created or sandbox-tested.
- Legal has not approved the terms/privacy text for paid users.
- Production retention/deletion policy is undefined.
- The app claims notarization, identity verification, or CA-backed digital signature status before those providers are configured.
