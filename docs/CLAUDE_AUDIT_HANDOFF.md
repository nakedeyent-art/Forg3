# Claude Audit Handoff

## Objective

Perform a full product, frontend, backend, mobile readiness, and security audit of Forg3 Sign. The goal is to identify release blockers, security gaps, subscription/billing risks, UX issues, and high-value features that would improve functionality, experience, and intelligence.

## Repo

- Path: `/Users/rizzolini/Documents/Forg3`
- App: React/Vite frontend, Express API, Capacitor iOS/Android shells
- Local web URL: `http://127.0.0.1:5173`
- Local API URL: `http://127.0.0.1:4127`

## What Exists

- PDF upload and signing-link creation.
- Subscription entitlement gate for creating signing links.
- Demo subscription activation for local testing.
- Pay-per-signature annual base plan with local usage charge records per completed signature.
- Expiring single-use signing links.
- Token hashes stored instead of raw link tokens.
- Token hash removed after signing.
- Touch-ready signature canvas and signed-PDF stamping.
- Google/Apple auth buttons with Firebase-ready configuration.
- First-party email-code login fallback with signed app tokens when Firebase is not configured.
- iOS and Android Capacitor projects generated and synced.
- Automatic signing-link email provider delivery with fallback local delivery records.
- Email-code device 2FA for account, recipient inbox, and signing-room access.
- Assigned-recipient signing URLs that require the signed-in email to match the signer before the PDF opens.
- Multi-signer routing with per-signer single-use tokens.
- Drag/touch signature-field placement stored on each packet.
- Business-tier ID attestation gate for signers.
- Local object-store abstraction for original and signed PDFs.
- Pro/Business packet templates.
- Business company admin member invitations.
- Provider-status surface for email, identity verification, receipt verification, object storage, and CA-backed PDF signing.

## Current Verification Status

- `npm run build` passes.
- `npx cap sync` passes and copies web assets into the native shells.
- `npm audit --audit-level=high` exits 0 for high/critical findings, but current output still shows moderate transitive `firebase-admin`/Google dependency advisories.
- Browser verification confirmed the pay-per-signature plan card, active metered billing row, signer touch/touchpad cue, and pointer-stroke signing behavior.
- API verification confirmed a completed signature under the pay-per-signature plan records `$0.99` usage and the used signing link becomes unavailable.
- iOS simulator build passes with `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO build`.
- Android debug build now passes by using Android Studio bundled JDK 21:
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug`.
- Pixel 10 Pro Fold install/launch verified with `adb install -r` and foreground activity
  `com.forg3.sign/.MainActivity`.
- API smoke test verified Business-tier two-signer routing, local delivery records, templates, company member invite, and final signed PDF generation.

## Product Decisions To Audit

- Pay-per-signature defaults to a `$12/year` base plan plus `$0.99` per completed signature.
- The per-signature price is controlled by `PAY_PER_SIGNATURE_FEE_CENTS`.
- The app intentionally avoids IP and user-agent collection for privacy, so Claude should assess whether this conflicts with enforceability, fraud controls, or audit-certificate expectations.
- Signed PDFs are electronically stamped and include a multi-signer audit certificate page. Certificate-authority-backed PDF signing is provider-ready but not live until a signing certificate/provider is configured.
- Firebase Auth is supported when configured, but local demo sessions are still available for development.

## Known Production Gaps

- Demo billing must be replaced with real StoreKit / Google Play Billing receipt verification.
- Pay-per-signature usage fees must be mapped to store-compliant in-app billing or an approved external billing path before release.
- Owner authentication is currently client-session/demo oriented and not enforced as a secure server session.
- JSON file storage must still be replaced with a production database. PDF bytes now use a local object-store abstraction, but production must configure encrypted cloud/object storage.
- Live signer delivery requires `PUBLIC_SIGNING_BASE_URL` plus configured Microsoft Graph or Resend email credentials. Without those values, delivery attempts remain local development records.
- Audit trail policy must be decided with legal counsel because the app intentionally avoids IP/user-agent capture.
- The signed PDF is stamped electronically but is not a live certificate-authority-backed cryptographic PDF signature until provider credentials/certificates are configured.
- Live ID verification is not connected; the current Business-tier flow is self-attestation plus provider-ready status.

## Commands To Run

```bash
npm install
npm run build
npm run dev
npx cap sync
npm audit
```

For browser verification, run the owner flow:

1. Sign in with email code, demo Google, or Apple.
2. Start demo subscription.
3. Upload a PDF.
4. Create a signing link.
5. For Pro/Business, add multiple signers and drag the signature-field target.
6. Open each signing link.
7. Draw signature by mouse, touchpad, or touch simulation; complete ID attestation if enabled; consent.
8. Sign all required signers.
9. Reload old signing URLs and confirm they are unavailable.
10. Refresh dashboard and confirm Signed count, delivery outbox records, metered usage count for the pay-per-signature plan, and download action.

## Security Audit Scope

Report findings with severity, file/line evidence, impact, and concrete remediation.

Priority areas:

- Owner auth and authorization are the most important launch blocker.
- Store billing receipt verification and usage-charge reconciliation are the second most important launch blocker.
- JSON file storage is development-only. Verify the object-store abstraction is migrated to encrypted production blob storage before release.

- Token lifecycle and link invalidation.
- Subscription entitlement enforcement.
- Authn/authz boundary for all owner-facing API routes.
- PDF upload validation and file-type handling.
- Data retention and privacy risks.
- CORS policy.
- Security headers and CSP.
- Request body size limits and DoS risk.
- XSS/DOM sink review.
- Storage of auth or subscription-sensitive material.
- Dependency risk and npm audit triage.
- Native billing receipt verification design.
- Metered signature usage charge idempotency and reconciliation.
- Signed document integrity model.
- Multi-signer race conditions and partial-completion behavior.
- Reminder link rotation and delivery records.
- Template and company-admin authorization.
- Provider-status fail-closed behavior for email, ID, receipt verification, object storage, and CA-backed PDF signing.

## Backend Audit Scope

- Review `server/index.ts`, `server/store.ts`, and `server/types.ts`.
- Confirm all state-changing routes validate input shape and owner authority.
- Confirm production error handling does not leak internals.
- Identify database/storage schema needed for production.
- Propose receipt verification design for Apple, Google, and optional web Stripe billing.
- Propose billing architecture for the $12/year pay-per-signature base plus per-signature usage charges.
- Propose webhook handling for renewals, cancellations, refunds, grace periods, and account holds.

## Frontend Audit Scope

- Review `src/App.tsx`, `src/lib/api.ts`, `src/lib/auth.ts`, `src/lib/pdf.ts`, and `src/styles.css`.
- Check mobile responsive layout and text fit.
- Check subscription UX clarity.
- Check signing UX on touch devices, touchpads, stylus input, and mouse input.
- Verify no secrets are embedded in Vite variables.
- Assess accessibility, keyboard behavior, and error states.

## iOS And Android Audit Scope

- Confirm Capacitor configuration is correct.
- Confirm native shells contain latest synced web assets.
- Identify exact StoreKit and Google Play Billing integration tasks.
- Identify exact store product strategy for annual pay-per-signature base billing plus usage charges.
- Confirm restore/manage subscription requirements are covered.
- Build iOS simulator if the host Xcode environment supports it.
- Build Android debug after selecting a compatible JDK.

## Feature Discovery Prompt

After the audit, propose features that enhance:

- Functionality: templates, reusable signer fields, signer reminders, multi-signer routing, completed certificate packs, reusable contacts, branded sending.
- Experience: mobile signing ergonomics, signature placement, guided review, better PDF preview controls, signer email status.
- Intelligence: document summarization, missing-field detection, signer-risk cues, clause extraction, automatic signer role suggestions, renewal/churn insights.
- Trust: tamper-evident audit certificates, optional stronger audit trail, retention controls, organization policies.

## Required Deliverables

1. Executive summary with launch readiness.
2. Security findings sorted by severity.
3. Backend findings and proposed architecture.
4. Frontend/mobile UX findings.
5. Subscription and store-compliance checklist.
6. Feature enhancement roadmap ranked by impact and implementation effort.
7. Exact file/line references for every actionable issue.
8. A final go/no-go recommendation.
