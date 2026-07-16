# Claude Execution Handoff — Forg3 Sign Remediation

_Companion to [AUDIT_REPORT.md](AUDIT_REPORT.md). This document tells a fresh Claude
session exactly what to build, in what order, and how to prove each step works._

> Status update, 2026-07-15: this is a historical remediation plan. Its core
> implementation items are superseded by the current codebase and
> `docs/DEPLOYMENT_READINESS_AUDIT_2026-07-15.md`. Do not treat line-numbered
> references in this file as current blockers without re-verifying against source.

## How to use this document

- Work **phase by phase, top to bottom.** Phases are ordered by dependency — do not
  start Phase 2 before Phase 1's acceptance checks pass.
- Each task lists: the finding id from the audit, the files to change, what to do, and
  an **acceptance check** you must run and pass before marking it done.
- Use a task list (TaskCreate/TaskUpdate) to track the tasks below.
- After each phase: run `npm run build` and `npm audit`, and drive the affected flow
  with the `/verify` skill (or the browser tools) — do not rely on typecheck alone.
- Commit at the end of each phase on a feature branch (`git checkout -b <phase>`);
  do not push unless the owner asks.
- If a task requires a product decision (billing model, retention policy, legal), do
  **not** guess — stop and record the open question in the "Decisions Needed" section
  at the bottom, then continue with other tasks.

## Ground rules

- Never re-introduce the demo auth/billing shortcuts into a production code path. Keep
  them behind an explicit `NODE_ENV !== 'production'` guard or delete them.
- Server is the source of truth for identity, entitlement, and the signed artifact.
  Never trust client-supplied `ownerEmail` or client-generated signed PDFs again.
- Return `404` (not `403`) on ownership mismatch so document ids aren't enumerable.
- Keep the existing generic 500 handler; never leak internals in errors.
- Preserve the parts that are already good: the token lifecycle (hash-only, single-use,
  nulled after signing, expiry) and shape-only input validation.

---

## Phase 1 — Server authentication & authorization (blocks S1-1 … S1-4)

Goal: no route trusts client-supplied identity. Every owner route derives the owner
from a verified token.

### 1.1 Add a token-verification middleware
- Finding: S1-1.
- Files: new `server/auth.ts`; wire into `server/index.ts`.
- Do: add middleware that reads `Authorization: Bearer <idToken>`, verifies it with
  Firebase Admin SDK (`firebase-admin`, `verifyIdToken`), and attaches
  `req.owner = { uid, email }`. Reject missing/invalid tokens with `401`. Add a
  dev-only fallback (guarded by `NODE_ENV !== 'production'`) that accepts a signed
  local dev token so local testing still works without Firebase.
- Add `firebase-admin` to dependencies; document required service-account env vars in
  `.env.example` (server-side only, **not** `VITE_`).
- Acceptance: `curl` to `/api/documents` with no token → `401`; with a valid token →
  `200`.

### 1.2 Scope document reads/writes to the owner
- Findings: S1-2, S1-3.
- File: `server/index.ts` (`GET /api/documents` `:77`; `GET /api/documents/:id` `:179`;
  `/signed` `:190`; `/rotate-link` `:257`; `/void` `:286`; `POST /api/documents` `:206`).
- Do: apply the middleware to all of the above. Filter `GET /api/documents` to
  `req.owner.email`. On every `:id` route, load the document then return `404` if
  `document.ownerEmail !== req.owner.email`. On create, set `ownerEmail`/`ownerName`
  from `req.owner`, not from the body.
- Acceptance: with owner A's token, A sees only A's documents; requesting B's document
  id returns `404`; A cannot void/rotate/download B's document.

### 1.3 Scope subscription routes to the owner
- Finding: S1-4.
- File: `server/index.ts` (`/api/subscription` `:81`; `/checkout` `:95`; `/cancel`
  `:159`; `/verify` `:142`).
- Do: apply middleware; derive `ownerEmail` from `req.owner`; ignore body/query email.
  Cancel only the caller's own subscription.
- Acceptance: `GET /api/subscription` with no token → `401`; a caller cannot read or
  cancel another email's subscription.

### 1.4 Remove the demo entitlement grant from production
- Finding: S1-4.
- Files: `server/index.ts:116` (`billingProvider === 'demo'` grant); `src/App.tsx:939`
  (`getBillingProviderForRuntime`), `:943` (`getBillingButtonLabel`).
- Do: guard the demo grant behind `NODE_ENV !== 'production'`. In production the only
  entitlement path is verified receipts (Phase 4). Update the UI so the "Start demo"
  button and "Store billing ready" pill reflect real state, not a hardcoded string.
- Acceptance: with `NODE_ENV=production`, `POST /api/subscription/checkout` with
  `demo` returns `501`/`403`, not an active subscription.

### 1.5 Real client auth token plumbing
- Finding: S1-1 (client side).
- Files: `src/lib/auth.ts`, `src/lib/api.ts`.
- Do: after Firebase sign-in, store the ID token and attach it as
  `Authorization: Bearer` on every request in `api.ts request()`. Refresh on expiry.
  Fix the shared-demo-email tenant collapse (S2-4) by keying dev sessions on `uid`.
- Acceptance: signed-in dashboard loads documents; signing out drops the token and
  subsequent owner calls `401`.

**Phase 1 done when:** an anonymous caller can reach nothing owner-scoped; two
distinct owners are fully isolated; `npm run build` passes; the owner flow (sign in →
subscribe (dev) → upload → create link) works end to end in the browser.

---

## Phase 2 — Signed-document integrity (blocks S2-1, S2-2)

Goal: the server, not the signer's browser, produces and vouches for the signed PDF.

### 2.1 Move PDF sealing server-side
- Finding: S2-1.
- Files: `server/index.ts` (`POST /api/signing/:token/sign` `:331`); port the sealing
  logic from `src/lib/pdf.ts:10` (`sealPdfWithSignature`) into a server module using
  `pdf-lib` (already a dependency).
- Do: the sign endpoint should accept only the **signature image** (PNG data URL) +
  the typed-name confirmation + consent — **not** a finished PDF. The server loads the
  stored original (`document.fileDataUrl`), stamps the signature, computes
  `signedDocumentHash` from the bytes it produced, and stores that. Delete the
  client-provided `signedFileDataUrl` trust path.
- Update `src/App.tsx` `handleSign` (`:718`) and `src/lib/api.ts signDocument` (`:65`)
  to stop sending a client-sealed PDF.
- Acceptance: a signer cannot influence the signed PDF bytes beyond the signature
  image; a request that omits/forges `signedFileDataUrl` no longer changes what the
  owner downloads; the downloaded signed PDF still shows the stamp and correct hash.

### 2.2 Entitlement policy at signing
- Finding: S2-2.
- File: `server/index.ts` (`:331` sign route, `:530` `recordSignatureUsage`).
- Do: decide and enforce one policy (record it in Decisions Needed if unsure). Default
  recommendation: still allow the signer to complete, but always record the metered
  charge for a metered plan regardless of the owner's current active flag, OR block
  signing with a clear message when the owner is inactive. Make charge writes
  idempotent per `documentId` (already the intent at `store.ts:65` — keep it and back
  it with a DB unique constraint in Phase 3).
- Acceptance: a signature completed after the owner lapses is either blocked or billed
  per the chosen policy — never silently free.

**Phase 2 done when:** the signed artifact is server-generated, hashes verify, and the
sign→download flow works in the browser.

---

## Phase 3 — Persistence: database + encrypted blob storage (blocks S2-3)

Goal: no more single-JSON-file store; no data-loss races; PDFs out of the row.

### 3.1 Introduce a database
- Finding: S2-3.
- Files: replace `server/store.ts` internals; keep the `DocumentStore` method surface
  if practical to limit churn.
- Do: stand up Postgres. Tables: `owners`, `subscriptions` (unique on owner),
  `documents` (metadata + blob storage keys + hashes, **no** base64), `signature_charges`
  (unique on `document_id`), `signing_tokens` (hash, expiry, one-time), `audit_events`.
  Use row-level updates (no read-modify-write of the whole dataset).
- Acceptance: two concurrent signature completions both persist; no lost writes under a
  small concurrency test.

### 3.2 Move PDFs to encrypted object storage
- Finding: S2-3, S4.
- Do: store original and signed PDFs in an object store (e.g. S3 with SSE-KMS); DB
  keeps only keys + SHA-256 hashes. Encrypt at rest.
- Acceptance: DB rows contain no base64 PDF; documents still load/download via signed
  URLs or a proxied authorized endpoint.

**Phase 3 done when:** the app runs on the DB/blob store with the same behavior and no
`data/forg3-store.json` dependency in production.

---

## Phase 4 — Store billing & receipt verification (blocks S1-4 fully; §5 checklist)

Goal: entitlement comes only from server-verified store receipts; per-signature fee is
store-compliant.

### 4.1 Implement `/api/subscription/verify`
- Historical target: `server/index.ts:142` formerly returned `501`.
- Do: verify Apple App Store Server API receipts and Google Play Developer API purchase
  tokens server-side; upsert an active subscription only after verification passes.
  Store the provider transaction/event id.
- Acceptance: a valid sandbox receipt grants entitlement; an invalid one is rejected.

### 4.2 Store lifecycle webhooks
- Do: handle Apple App Store Server Notifications v2 and Google RTDN for
  renew/cancel/refund/grace/hold; reconcile into `subscriptions`. Reconcile metered
  `signature_charges` against store billing events; keep them idempotent.
- Acceptance: a simulated cancel/refund notification updates entitlement state.

### 4.3 Per-signature fee compliance (DECISION REQUIRED — see bottom)
- The metered `$0.99/signature` fee is **not** directly expressible as an
  auto-renewable subscription and will fail App/Play review as-is. Choose a compliant
  model (consumable/prepaid credits, or an approved external-billing entitlement) with
  the owner before implementing. Do not ship the raw metered charge through the stores.

### 4.4 Native store affordances
- Files: iOS/Android Capacitor layers.
- Do: implement StoreKit + Play Billing purchase/restore; add Restore Purchases and
  Manage Subscription UI; show base + per-signature price before purchase.
- Acceptance: purchase, restore, and manage flows work in sandbox on device.

---

## Phase 5 — Hardening (S3 findings)

- **S3-1 Rate limiting:** add per-IP and per-account limits on `/checkout`,
  `/api/documents`, and `/api/signing/:token`; add a global request cap. Lower the
  28 MB body limit (`server/index.ts:70`) to the real max PDF size.
- **S3-2 Security headers:** add `helmet` with a strict CSP, `X-Content-Type-Options`,
  `Referrer-Policy`, and HSTS; enforce HTTPS at the edge. (`server/index.ts:381`.)
- **S3-3 / F-1 iframe:** add `sandbox` to the signer preview iframe
  (`src/App.tsx:804`), or render via PDF.js with scripting disabled; test that the
  preview actually renders on mobile Safari (data: iframes often fail there).
- **S3-4 CORS:** once bearer-token auth is live, keep the allowlist tight; do not move
  to cookies without CSRF protection.

---

## Phase 6 — Frontend / mobile UX (F-2 … F-5)

- **F-2 accessibility:** add a typed-signature fallback to `SignaturePad.tsx` and
  proper labels/roles so keyboard/AT users can sign.
- **F-3/F-4:** ensure demo artifacts don't ship; drive the "Store billing ready" pill
  and buttons from real state.
- **F-5:** verify long titles/emails fit in document rows at the 620px breakpoint.
- Re-test the full owner + signer flow on a real iOS device and an Android device
  (Android needs JDK 17 or 21 — the host currently has JDK 25; select a compatible JDK
  before `./gradlew`).

---

## Phase 7 — Trust & audit features (from roadmap §6)

Implement in impact order once the blockers above are closed:
1. Email delivery of signing links + signed copies (the product cannot deliver a link
   today).
2. Tamper-evident audit certificate appended to the signed PDF (event log, hashes,
   timestamps).
3. Multi-signer routing with per-signer tokens.
4. Reusable contacts + templates.
5. Signer-placed fields (drag signature/initials/date).
6. (Longer term) PAdES certificate-authority-backed cryptographic signatures.

---

## Verification checklist (run before declaring any phase complete)

1. `npm run build` — passes.
2. `npm audit --audit-level=high` — 0 high/critical.
3. `npx cap sync` — passes (when native code changed).
4. Owner flow in browser: sign in → subscribe → upload PDF → create link.
5. Signer flow: open link → draw signature → confirm name → consent → sign → download.
6. Reopen the used signing URL → confirm it is unavailable.
7. Dashboard shows correct Signed count and (for metered plan) usage count.
8. Cross-tenant probe: owner B cannot see/act on owner A's documents or subscription.
9. Integrity probe: a tampered sign request cannot alter the owner's downloaded PDF.

---

## Decisions Needed (do not guess — get owner/legal sign-off)

1. **Per-signature fee store model** (Phase 4.3): consumable/prepaid credits vs.
   approved external billing. Blocks store submission.
2. **Entitlement-at-signing policy** (Phase 2.2): block signing when owner is inactive,
   vs. always bill the completed signature.
3. **Audit-trail scope vs. privacy** (S4): the app intentionally avoids IP/user-agent
   capture, which weakens enforceability. Legal must decide the minimum audit record.
4. **Signature legal weight** (roadmap §6.6): is electronic stamping sufficient, or is
   PAdES/CA-backed signing required for the target markets?
5. **Data retention & encryption keys** (Phase 3.2): retention windows and KMS choice.
