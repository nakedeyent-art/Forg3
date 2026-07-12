# Decisions Needed

These items require owner/legal or infrastructure sign-off before production release.

## Entitlement At Signing

Current safe default: `SIGNING_ENTITLEMENT_POLICY=block_when_inactive`.

This blocks a signer from completing when the document owner's subscription is inactive. The alternative supported policy is `bill_metered`, which lets metered-plan signers complete and records a usage charge even if the owner's subscription has lapsed.

Decision needed: confirm whether Forg3 should block signatures after owner lapse or allow completion and bill/reconcile the signature.

## Per-Signature Store Billing Model

The `$0.99/signature` usage fee is not directly expressible as an auto-renewable subscription in App Store / Play Store billing.

Decision needed: choose prepaid consumable signature credits, an approved external-billing model, or a different store-compliant pricing model.

## Audit Trail Scope

The current privacy posture avoids IP and user-agent capture.

Decision needed: legal must define the minimum audit trail for enforceability and fraud controls.

## Signature Legal Weight

The current product creates an electronic PDF stamp, not a CA-backed cryptographic PDF signature.

Decision needed: confirm whether electronic stamping is sufficient for target markets or whether PAdES / CA-backed signing is required.

## Production Persistence

Production needs a database, encrypted blob storage, retention windows, and key management.

Decision needed: select Postgres host, object storage provider, KMS, and retention policy.

## Mobile PDF Preview

The iframe is sandboxed, but Chromium blocked the sandboxed `data:` PDF preview during mobile-width verification. Mobile Safari still needs real-device testing.

Decision needed: approve a PDF.js rendering implementation with scripting disabled, or approve a different preview/download UX for signers.
