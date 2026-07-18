# Security Model

## Link lifecycle

- The API creates a 32-byte random signing token.
- Only `SHA-256(token)` is stored.
- Sender-facing and emailed links use assigned-recipient routes instead of exposing raw token links.
- Legacy raw token routes require the signed-in email to match the assigned signer before the PDF opens or signing is allowed.
- A token can sign one packet only.
- After signing, `tokenHash` is set to `null`.
- Expired and voided packets cannot be signed.

## Account and recipient access

- Primary login uses Google or Apple through Firebase when configured, or first-party email-code login with signed app tokens.
- New devices must pass email-code 2FA before account data, recipient inboxes, or signing rooms are available.
- Trusted devices are stored by device-id hash with an expiration window.
- MFA challenge codes are stored as hashes, expire quickly, and lock after repeated failed attempts.
- Recipient document access requires `req.owner.email` to match the assigned signer email.
- Recipients may keep free Forg3 accounts. Their own subscription entitlement is not required to open or sign assigned packets; paid entitlement is required only when an account creates or resends signing requests.

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
- Trusted-device hashes and MFA challenge hashes.

The local store does not intentionally capture:

- IP addresses.
- User-agent strings.
- Raw signing tokens.
- Raw MFA codes.

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
- `/api/subscription/verify` verifies native StoreKit and Google Play Billing purchases server-side before granting entitlement.
- Production must keep store verification credentials configured and fail closed when they are missing.
- Production must make usage charge recording idempotent in the database and reconcile it with store billing events.

## Phase 10-11 hardening layer (implemented)

- **TOTP authenticator MFA**: accounts can enroll an RFC 6238 authenticator app; once active it is required at every email-code login (`server/totp.ts`, `/api/auth/totp/*`).
- **Server-side sessions**: email tokens carry a session id; sessions are revocable individually or all at once, and revoked tokens fail authentication immediately (`/api/auth/sessions*`).
- **Trusted-device management**: list and revoke trusted devices (`/api/auth/devices*`); revocation forces fresh device 2FA.
- **Append-only audit chain**: every auth and document lifecycle event appends an owner-scoped record whose hash commits to the previous record (`store.appendAuditEvent`); readable at `/api/audit` without exposing document contents.
- **Abuse protection**: strict rate limits and per-account+device resend cooldowns on all login/2FA code endpoints.
- **Encryption at rest**: uploaded documents and sealed signed packages are AES-256-GCM encrypted when `FORG3_OBJECT_ENCRYPTION_KEY` is set; production refuses to start without it unless explicitly overridden.
- **Data subject controls**: full JSON export (`/api/account/export`) and confirmed irreversible deletion (`/api/account/delete`) including stored document objects.
- **CI enforcement**: the smoke suite asserts recipient-email matching, free-recipient signing, revocation, and audit chain integrity on every push.
