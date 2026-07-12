# Forg3 Sign — Full Audit Report

_Date: 2026-07-11 · Scope: product, frontend, backend, mobile readiness, security · Verdict: **NO-GO for production**_

## 1. Executive Summary

Forg3 Sign is a well-structured prototype with a clean React/Vite frontend, a small
Express API, and generated iOS/Android Capacitor shells. Build, `cap sync`, and
`npm audit` are all green. The signing-link lifecycle (single-use, hashed token,
token nulled after signing, expiry) is genuinely well designed.

However, the app is **not launch-ready**, and the gap is larger than the handoff's
known list. The handoff correctly names owner auth, receipt verification, usage
reconciliation, and storage as blockers. The audit found that the **authentication/
authorization gap is not a hardening item — it is a total absence**: there is no
server-side auth of any kind, no session, and no owner-scoping on any route. Every
document, PDF, signer email, and subscription in the system is readable, modifiable,
and forgeable by any unauthenticated caller. Separately, the **signed-PDF integrity
model is broken**: the "signed" PDF is generated on the signer's own device and the
server stores whatever bytes the client uploads without verifying they derive from
the original document.

Launch readiness: **not ready.** At least the S1/S2 findings below must be resolved
before any external exposure, and the signed-document integrity model must be
redesigned before this can be represented as a legally meaningful e-signature product.

## 2. Security Findings (by severity)

### S1 — Critical

**S1-1. No authentication or authorization anywhere on the API.**
`server/index.ts` registers no auth middleware. Every owner route trusts a
client-supplied `ownerEmail` string as identity. The `AuthSession` is a plain
`localStorage` JSON blob (`src/lib/auth.ts:3`, `src/lib/types.ts:8`) that the server
never sees or validates. Even the Firebase path (`src/lib/auth.ts:33`) only produces
a client session — no ID token is ever sent to or verified by the server.
_Impact:_ the entire authorization model is decorative. _Remediation:_ require a
verified bearer token (Firebase Admin `verifyIdToken`, or a real server session) on
every `/api/documents*` and `/api/subscription*` route, and derive `ownerEmail` from
the verified token, never from the request body/query.

**S1-2. `GET /api/documents` returns every document for every tenant.**
`server/index.ts:77` maps `store.all()` with no owner filter. Response includes
owner email, signer name, signer email, titles, and hashes for all users.
_Impact:_ full cross-tenant PII disclosure to any anonymous caller. _Remediation:_
scope to the authenticated owner; add pagination.

**S1-3. IDOR on every per-document route.**
`GET /api/documents/:id` (`:179`) returns the full original PDF (`fileDataUrl`) to
anyone who knows/guesses the UUID. `GET /api/documents/:id/signed` (`:190`) returns
the signed PDF. `POST .../rotate-link` (`:257`) and `POST .../void` (`:286`) let any
caller rotate or void any owner's document. None check owner identity.
_Impact:_ document theft, denial (void), and link hijack across tenants.
_Remediation:_ load the document, then assert `document.ownerEmail === authedOwner`
before acting; return 404 (not 403) on mismatch.

**S1-4. Subscription entitlement is free to forge.**
`POST /api/subscription/checkout` with `billingProvider: 'demo'` (`:116`, `:124`)
writes a real `active` subscription for any email with no payment and no auth. The
frontend hardcodes `demo` for all runtimes (`src/App.tsx:939`). `POST
/api/subscription/cancel` (`:159`) will cancel any email's subscription with no auth
and without even validating the email. `GET /api/subscription?ownerEmail=` (`:81`)
discloses anyone's subscription and usage totals.
_Impact:_ paywall bypass, denial of another user's subscription, billing-data
disclosure. _Remediation:_ delete the demo grant path from production builds; gate
all subscription routes behind verified auth; only ever mutate the caller's own
subscription.

### S2 — High

**S2-1. Signed-document integrity is client-trusted (forgeable "signed" PDF).**
The PDF is stamped in the browser (`src/lib/pdf.ts:10 sealPdfWithSignature`), then
the signer POSTs `signedFileDataUrl` to `POST /api/signing/:token/sign`
(`server/index.ts:331`). The server stores those bytes verbatim and hashes *them*
(`:366`) — it never verifies the uploaded PDF is derived from the original
`document.fileDataUrl`. A signer (or MITM of the signer's request) can submit a
completely different PDF as the "signed" artifact, and the owner downloads it as
authentic. _Impact:_ the core trust claim of the product fails. _Remediation:_ do the
seal server-side from the stored original + received signature image, or at minimum
diff/validate the uploaded document against the original before sealing; treat the
client-provided signed bytes as untrusted.

**S2-2. Signing does not re-check entitlement, so late signatures escape billing.**
`recordSignatureUsage` (`:530`) only records a metered charge when the owner is
`active` at sign time. `POST /api/signing/:token/sign` itself has no entitlement
gate, so if the owner cancels/lapses after sending a link, the signer still completes
and the owner receives the signed document with no charge recorded.
_Impact:_ revenue leak on the pay-per-signature plan. _Remediation:_ decide the
policy explicitly (charge at send time, or block signing when owner is inactive) and
enforce it on the sign route.

**S2-3. JSON file store: data-loss race + unbounded growth.**
`server/store.ts` does full read-modify-write of one JSON file per mutation
(`read()` → mutate → `write()`), with no locking. Two concurrent writes (e.g. two
signatures, or upload + sign) will silently drop one update. Every write serializes
the entire store — which embeds every original and signed PDF as base64 — so cost is
O(total-data) per request. _Impact:_ lost signatures/charges under concurrency;
latency and memory blowup as data grows. _Remediation:_ move to a real database
(Postgres) with row-level updates; store PDFs in encrypted object storage keyed by
id, not inline.

**S2-4. Demo sessions collapse all users into one tenant.**
When Firebase is unconfigured, every demo Google user is issued the identical email
`google-user@example.local` and every demo Apple user `apple-user@example.local`
(`src/lib/auth.ts:65`). Since `ownerEmail` is the tenant key, all demo users of a
provider share one another's documents and subscription. _Impact:_ in any build
shipped without Firebase, there is effectively no tenant isolation. _Remediation:_
demo mode must not ship to production; if kept for dev, key sessions by the random
`uid`, not a shared email.

### S3 — Medium

**S3-1. No rate limiting on any route.** `/api/subscription/checkout`,
`/api/documents` (28 MB body, `:70`), and `/api/signing/:token` are all unthrottled.
The 32-byte token makes signing-link brute force infeasible, but upload/checkout
abuse and store-file amplification (S2-3) are open. _Remediation:_ add per-IP and
per-account rate limits and a global request cap.

**S3-2. Missing security headers / CSP.** `x-powered-by` is disabled (good) but the
app sets no `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, or HSTS. The SPA is served by the same Express process
(`:381`). _Remediation:_ add `helmet` with a strict CSP; enforce HTTPS/HSTS at the
edge.

**S3-3. Signer PDF rendered in an un-sandboxed iframe from a `data:` URL.**
`src/App.tsx:804` sets `<iframe src={fileDataUrl}>` with no `sandbox` attribute. A
malicious owner could embed active content in a PDF shown to the signer.
_Remediation:_ add `sandbox` to the iframe and/or render via a JS PDF viewer with
scripting disabled. (Note: `data:` iframes often fail to render in mobile Safari —
see M-2.)

**S3-4. CORS allows requests with no `Origin`.** `allowCorsOrigin` (`:408`) returns
`true` when `origin` is undefined. No cookies are used so CSRF risk is low today, but
once real sessions land this must be revisited (and must not be cookie/`credentials`
based without CSRF defense). _Remediation:_ once auth exists, use bearer tokens (not
cookies) or add CSRF protection; keep the allowlist tight.

### S4 — Low / informational

- Privacy stance (no IP/user-agent capture) is a deliberate product choice but
  directly weakens audit-certificate enforceability — flagged for legal (matches
  handoff). With S1/S2-1 unresolved there is currently **no** trustworthy evidence of
  who signed what.
- `data/forg3-store.json` contains real base64 PDFs on disk; it is git-ignored
  (`.gitignore:4`) — good — but is unencrypted at rest.
- No secrets are embedded in Vite env (`.env.example` values are blank). Note that
  `VITE_FIREBASE_*` values are inherently public by design; that's fine for Firebase
  web keys but should be documented so no one adds a real secret to a `VITE_` var.

## 3. Backend Findings & Proposed Architecture

Current: single-process Express 5, JSON file store, no persistence guarantees, no
auth. Reasonable as a prototype; not a production shape.

Proposed target:
- **Identity:** Firebase Admin token verification middleware → `req.owner`. All owner
  routes derive identity from it.
- **Database:** Postgres. Tables: `owners`, `subscriptions`, `documents`
  (metadata + storage keys, not blobs), `signature_charges` (unique on `document_id`
  — the existing idempotency key at `store.ts:65` is the right idea, enforce it as a
  DB constraint), `signing_tokens` (hash, expiry, one-time), `audit_events`.
- **Blob storage:** encrypted object store (S3+SSE/KMS) for original and signed PDFs;
  DB holds only keys + hashes.
- **Billing/receipts:** implement the stubbed `/api/subscription/verify` (`:142`) for
  Apple App Store Server API and Google Play Developer API; grant entitlement only
  after server-side verification. Add webhook/notification handlers for renewals,
  cancellations, refunds, grace periods, and account holds (Apple App Store Server
  Notifications v2, Google RTDN). Reconcile metered usage against store billing
  events; make charge writes idempotent and store the provider event id.
- **Errors:** the generic 500 handler (`:393`) is correct — keep it, and ensure
  validation errors stay shape-only as they are now.

## 4. Frontend / Mobile UX Findings

- **F-1 (High, mobile):** the signer PDF preview uses a `data:` URL iframe
  (`App.tsx:804`). Mobile Safari frequently refuses to render `data:` PDFs in
  iframes, so the primary signing surface may show blank on iOS — the exact target
  platform. Test on-device; consider PDF.js canvas rendering.
- **F-2 (Medium, accessibility):** signing is canvas-only (`SignaturePad.tsx`) with
  no keyboard/typed-signature fallback and no `role`/label beyond `aria-label`.
  Keyboard-only and assistive-tech users cannot sign. Add a typed-signature option.
- **F-3 (Medium):** `ownerEmail` fallback `${provider}@forg3.local` (`App.tsx:95`)
  and the shared demo emails (S2-4) mean the dashboard can show another user's data in
  demo mode. Cosmetic today, dangerous if demo ships.
- **F-4 (Low):** the top bar shows a static "Store billing ready" pill
  (`App.tsx:339`) while billing is demo-only — misleading; drive it from real state.
- **F-5 (Low):** responsive breakpoints exist (900px, 620px in `styles.css`); layout
  is reasonable. Verify text fit for long titles/emails in the document rows on small
  screens.

## 5. Subscription & Store-Compliance Checklist

- [ ] Remove demo checkout grant from production builds (S1-4).
- [ ] Implement Apple StoreKit purchase/restore + server-side receipt verification.
- [ ] Implement Google Play Billing purchase + server-side verification.
- [ ] Model the **per-signature usage fee** as a store-compliant path (consumable/
      prepaid credits or an approved external-billing entitlement) — a raw metered
      charge is not directly expressible as an auto-renewable subscription and will
      fail review as-is. This is the single biggest store-policy risk.
- [ ] Provide Restore Purchases and Manage Subscription affordances in native builds.
- [ ] Show annual base + per-signature price clearly before purchase.
- [ ] Backend remains source of truth for entitlement (already the design intent).
- [ ] Handle renewals/cancellations/refunds/grace/holds via store notifications.

## 6. Feature Enhancement Roadmap (ranked by impact ÷ effort)

**Do first (high impact, low/medium effort):**
1. Email delivery of signing links + signed copies (currently absent; the product
   can't actually deliver a link today).
2. Tamper-evident audit certificate page appended to the signed PDF (event log,
   hashes, timestamps) — partially covers the privacy/enforceability gap.
3. Multi-signer routing (sequential/parallel) with per-signer tokens.
4. Reusable signer contacts + templates for repeat sends.

**High value, higher effort:**
5. Signer-placed fields (drag signature/initials/date onto the page) instead of a
   fixed stamp.
6. Certificate-authority-backed cryptographic PDF signatures (PAdES) for legal weight.
7. Intelligence: document summarization, missing-field detection, clause extraction,
   auto signer-role suggestions (LLM-assisted, server-side).
8. Renewal/churn insights and reminder nudges for owners.

## 7. Actionable Issue Index (file:line)

- `server/index.ts:77` — S1-2 all-tenant document disclosure.
- `server/index.ts:179` / `:190` / `:257` / `:286` — S1-3 IDOR (read/download/rotate/void).
- `server/index.ts:81` / `:95` / `:159` — S1-4 subscription disclosure/forge/cancel.
- `server/index.ts:331` / `:366` + `src/lib/pdf.ts:10` — S2-1 client-trusted signed PDF.
- `server/index.ts:530` — S2-2 no entitlement re-check at signing.
- `server/store.ts:98`–`:112` — S2-3 read-modify-write race + full-file rewrite.
- `src/lib/auth.ts:65` — S2-4 shared demo tenant email.
- `server/index.ts:70` / `:408` — S3-1/S3-4 body size, CORS-no-origin, no rate limit.
- `server/index.ts:381` — S3-2 no CSP/security headers on served SPA.
- `src/App.tsx:804` — S3-3 / F-1 un-sandboxed `data:` iframe (+ mobile render risk).
- `src/components/SignaturePad.tsx` — F-2 no keyboard/typed-signature fallback.
- `src/App.tsx:95` / `:939` — F-3 owner-email fallback / hardcoded demo billing.

## 8. Go / No-Go

**NO-GO.** Blocking items before any external launch:

1. Real server-side authentication + owner-scoped authorization on all owner routes
   (S1-1..S1-4).
2. Redesign signed-document integrity so the server, not the client, is the source of
   the signed artifact (S2-1).
3. Store-compliant billing with server-side receipt verification and a compliant
   model for the per-signature fee (S1-4 + §5).
4. Replace the JSON file store with a database + encrypted blob storage (S2-3).

The link-lifecycle design and the overall code quality are good foundations — the
blockers are architectural (identity, integrity, persistence, billing), not cosmetic,
and should be resolved before re-review.
