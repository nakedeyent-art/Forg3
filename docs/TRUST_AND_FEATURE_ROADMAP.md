# Trust And Feature Roadmap

## Implemented Now

- Server-side PDF sealing.
- Single-use, hash-only signing tokens.
- Signed PDF audit certificate page with signer, timestamp, original document hash, audit event hash, signature method, and token consumption status.
- Typed-signature fallback for keyboard users.
- Email provider send path for signing links and reminders.
- Email-code 2FA for new devices after primary Google/Apple login.
- Assigned-recipient signing rooms that require the signed-in email to match the signer before PDF preview or signing.

## Next Features In Impact Order

1. Signed-copy delivery after completion.
   - Requires approved email provider, sender domain authentication, bounce handling, and transactional policy.
2. Multi-signer routing.
   - Requires per-signer token rows, signing order, reminders, and certificate events per signer.
3. Reusable contacts and templates.
   - Requires owner-scoped contact and template tables.
4. Signer-placed fields.
   - Requires PDF coordinate capture, page thumbnails, field schemas, and signer validation.
5. Stronger audit certificate.
   - Requires legal decision on IP/user-agent capture, retention windows, and fraud controls.
6. PAdES / CA-backed cryptographic signatures.
   - Requires certificate authority vendor selection and jurisdiction-specific legal review.

## Blocked By Decisions Or Infrastructure

- Email delivery provider, public app URL, and sending domain.
- Audit-trail privacy scope.
- Production database and encrypted blob storage.
- Store-compliant per-signature billing model.
- Native StoreKit / Google Play Billing credentials and device sandbox testing.
