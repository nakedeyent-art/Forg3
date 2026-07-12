# Security Model

## Link lifecycle

- The API creates a 32-byte random signing token.
- Only `SHA-256(token)` is stored.
- The raw token appears only in the signing URL returned to the owner.
- A token can sign one packet only.
- After signing, `tokenHash` is set to `null`.
- Expired and voided packets cannot be signed.

## Data retained

The local store keeps:

- Original PDF data.
- Signed PDF data.
- Owner name and email.
- Signer name and email.
- Original and signed SHA-256 hashes.
- Created, expiration, and signed timestamps.
- Signature image data.
- Consent text.
- Metered signature charge records for pay-per-signature subscriptions.

The local store does not intentionally capture:

- IP addresses.
- User-agent strings.
- Raw signing tokens.

## Important production upgrades

- Replace demo subscription activation with verified Apple App Store / Google Play / web billing receipts.
- Enforce owner authentication and authorization on every owner-facing API route.
- Put the API behind HTTPS only.
- Replace the JSON file store with a database and encrypted object storage.
- Add rate limiting for `/api/signing/:token`.
- Use short token expiration windows by default.
- Add signed webhooks or email delivery for customer copies.
- Decide whether legal enforceability requires a broader audit trail.
- Use a managed key service for encryption at rest.
- Add backups and retention controls.

## Subscription controls

- The backend owns subscription state and rejects signing-link creation when entitlement is inactive.
- The pay-per-signature plan records a usage charge only after a signing link is completed and sealed.
- The local app supports `demo` billing so the product can be tested without store credentials.
- `/api/subscription/verify` is intentionally stubbed until native receipt verification is implemented.
- Production must verify StoreKit and Google Play Billing receipts server-side before granting entitlement.
- Production must make usage charge recording idempotent in the database and reconcile it with store billing events.
