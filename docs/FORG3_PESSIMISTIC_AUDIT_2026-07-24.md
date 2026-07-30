# Forg3 Pessimistic App Audit - 2026-07-24

This audit is intentionally conservative. It treats Forg3 as a paid legal-signing product where reliability, auditability, and customer trust matter more than a demo looking smooth.

## Executive status

Forg3 is close to a functional staging product, but it is not yet a clean store-launch product. The core signing flow exists: paid/creator sender gating, email-code auth, device verification, assigned-recipient access, upload, signing, sealing, sender delivery records, encrypted object storage, native shells, and Apple/Google billing bridges. The remaining risk is not that there is no app; the risk is drift between staging, native bundles, billing/provider setup, real-device behavior, and what customers will assume a "secure e-signature" product means.

## Fixed in this pass

1. Mobile signature reliability:
   The signature pad now commits the canvas image while the user draws, on pointer end, on pointer leave, and again from the canvas at submit time. This directly targets the reported failure where the signer drew a signature, tapped Sign Document, and the signature state disappeared.

2. Sender signed-copy recovery:
   The dashboard now exposes an authenticated action to email the signed package back to the sender for signed documents. This gives the sender a clear recovery path when a signer says they completed the packet but the sender cannot find the signed file.

3. Safer upload validation:
   The server now enforces an allowlist for PDF, Word, Excel, PowerPoint, TXT, RTF, and CSV. It validates extension/MIME consistency, checks PDF magic bytes, checks Office ZIP/OLE headers, rejects empty uploads, blocks unknown extensions, canonicalizes accepted data URLs, and rejects active-looking text uploads such as HTML/SVG.

4. Clearer non-PDF behavior:
   The signing room now states that non-PDF files are preserved as originals and Forg3 creates a signed PDF certificate for the exact file fingerprint. This avoids implying that Word/Excel/PowerPoint files are modified in place.

5. TOTP secret storage:
   New authenticator-app secrets are encrypted before storage and decrypted only for verification. Existing plaintext enrollments still verify so users are not locked out.

6. Production route/version drift checks:
   `/api/health` and `/api/version` now expose build version/commit. Docker images receive commit/build args in CI. Release-readiness and production monitoring now verify the signed-copy delivery route shape so a public domain serving an older backend is caught.

7. API understandability:
   Unknown `/api/*` routes now return JSON 404 responses instead of falling through to generic/default behavior.

8. Billing/webhook honesty:
   Receipt verification status now reports `provider` when Apple/Google billing is configured. Google RTDN webhook requests fail closed in production if the shared token is missing, and production startup now treats a configured Google billing setup without webhook protection as incomplete.

## Highest-risk remaining issues

1. Public production drift can still happen operationally.
   The code now detects this, but deployment still has to rebuild, push, and redeploy the image, then run release-readiness against `https://forg3.nak3deye.com`. If Cloudflare/DNS points at an older container, users will see missing-route behavior again.

2. Native store billing needs live sandbox proof.
   The app has native billing bridges and server receipt verification code, but store launch still needs confirmed App Store / Play products, sandbox purchase, restore, cancel, renewal, and webhook tests. Until those pass, paid unlock is not fully proven.

3. Session tokens live in browser/local WebView storage.
   `src/lib/auth.ts` stores bearer sessions in localStorage. CSP and device 2FA help, but localStorage tokens are stealable if XSS or a malicious WebView/plugin context occurs. A stronger launch architecture would move sessions to HttpOnly cookies/BFF or short-lived in-memory tokens with refresh.

4. Forg3 does not currently produce CA-backed PAdES PDF signatures.
   The system creates an electronic signature stamp and audit certificate. That may be acceptable for many electronic-signature workflows, but it is not the same as a cryptographic PDF signature from a certificate authority.

5. Data model is durable but not truly production-scalable.
   Postgres stores the workflow state as one JSONB row with write-through cache. That is acceptable for pilot/single-instance staging, but it is weak for multi-instance scaling, relational queries, row-level retention, and concurrency.

6. Sender email identity is constrained by provider rules.
   Forg3 can show the sender in the email body and use reply-to. Actually sending "from" arbitrary sender addresses depends on Microsoft Graph/Resend domain permissions; without delegated send-as rights, arbitrary sender-from behavior will fail.

7. Real-device QA remains mandatory.
   The exact store build must be tested on real iPhone and Android for email login, device verification, file upload, signing, signed-copy delivery, purchase, restore, and app restart behavior.

8. Legal/compliance copy needs owner/legal review.
   Terms/privacy exist, but paid launch still needs final privacy labels, data retention policy, refund/support policy, export compliance answers, and app-review notes.

## Design and navigation weaknesses

1. The dashboard has a lot of power packed into one screen. It is usable for an owner/operator, but new users may not understand the difference between creating a link, emailing a packet, downloading a signed package, and emailing a signed package back to themselves.

2. The icon-only row actions are efficient but easy to misread. Tooltips help on desktop, but mobile users need clear accessible labels and enough spacing.

3. Recipient signing is clearer than sender setup. The signer room explains assigned-email access and fingerprints, but the sender dashboard still relies heavily on panels and status chips.

4. The phrase "secure e-signatures" should be used carefully until CA-backed signing, identity verification provider, retention policy, and final legal review are complete.

## Operational weaknesses

1. Local Node on this machine is currently unreliable. `node -v`, `vite build`, `npm run build`, and the smoke server process can park at 8 KB RSS without opening ports. TypeScript compiler checks completed, but runtime smoke/build verification could not be trusted locally in this shell.

2. Health checks were too shallow before this pass. They now include commit/version, but deployment scripts still need to be run after image redeploy to prove the public domain serves the expected commit.

3. Full smoke should run in CI and staging after this change. Local smoke was blocked by the Node runtime issue, not by an assertion failure.

## Verification performed

- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.server.json --noEmit` passed.
- `./node_modules/.bin/tsc -p tsconfig.server.json` passed after the final server changes.
- `git diff --check` passed.

## Verification blocked locally

- `npm run smoke`, `node scripts/smoke.mjs`, `npm run build`, `vite build`, and direct compiled-server startup were blocked because local Node/npm processes parked silently and never opened the API port.
- The next trustworthy runtime verification should be GitHub Actions CI plus staging release-readiness after redeploy.
