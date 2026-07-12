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
- iOS and Android Capacitor projects generated and synced.

## Current Verification Status

- `npm run build` passes.
- `npx cap sync` passes and copies web assets into the native shells.
- `npm audit --audit-level=high` reports 0 vulnerabilities.
- Browser verification confirmed the pay-per-signature plan card, active metered billing row, signer touch/touchpad cue, and pointer-stroke signing behavior.
- API verification confirmed a completed signature under the pay-per-signature plan records `$0.99` usage and the used signing link becomes unavailable.
- iOS simulator build passes with `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO build`.
- Android debug build is blocked on this Mac by OpenJDK 25: Gradle fails with `Unsupported class file major version 69`. Re-test after selecting JDK 17 or 21.

## Product Decisions To Audit

- Pay-per-signature defaults to a `$12/year` base plan plus `$0.99` per completed signature.
- The per-signature price is controlled by `PAY_PER_SIGNATURE_FEE_CENTS`.
- The app intentionally avoids IP and user-agent collection for privacy, so Claude should assess whether this conflicts with enforceability, fraud controls, or audit-certificate expectations.
- Signed PDFs are electronically stamped, not cryptographically signed with certificate-authority-backed PDF signatures.
- Firebase Auth is supported when configured, but local demo sessions are still available for development.

## Known Production Gaps

- Demo billing must be replaced with real StoreKit / Google Play Billing receipt verification.
- Pay-per-signature usage fees must be mapped to store-compliant in-app billing or an approved external billing path before release.
- Owner authentication is currently client-session/demo oriented and not enforced as a secure server session.
- JSON file storage must be replaced with a production database and encrypted object storage.
- Email delivery for signing links is not implemented.
- Audit trail policy must be decided with legal counsel because the app intentionally avoids IP/user-agent capture.
- The signed PDF is stamped electronically but is not a certificate-authority-backed cryptographic PDF signature.
- Android Gradle may require JDK 17 or 21 instead of the currently installed JDK 25.

## Commands To Run

```bash
npm install
npm run build
npm run dev
npx cap sync
npm audit
```

For browser verification, run the owner flow:

1. Sign in with demo Google or Apple.
2. Start demo subscription.
3. Upload a PDF.
4. Create a signing link.
5. Open the signing link.
6. Draw signature by mouse, touchpad, or touch simulation and consent.
7. Sign document.
8. Reload the old signing URL and confirm it is unavailable.
9. Refresh dashboard and confirm Signed count, metered usage count for the pay-per-signature plan, and download action.

## Security Audit Scope

Report findings with severity, file/line evidence, impact, and concrete remediation.

Priority areas:

- Owner auth and authorization are the most important launch blocker.
- Store billing receipt verification and usage-charge reconciliation are the second most important launch blocker.
- JSON file storage and base64 PDF retention are development-only and must be replaced before production.

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
