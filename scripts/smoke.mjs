#!/usr/bin/env node
// Backend smoke test: boots the built API server against a throwaway data
// directory and exercises the core auth + document flows end to end.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 4300 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forg3-smoke-'));
const deviceId = crypto.randomUUID();
const ownerEmail = 'smoke-owner@forg3.test';
const signerEmail = 'smoke-signer@forg3.test';
const reviewEmail = 'store-review@forg3.test';
const reviewCode = '246810';
const agentOverrideCode = 'smoke-agent-override';

const serverEntry = fs.existsSync(path.resolve('dist-server/server/index.js'))
  ? ['dist-server/server/index.js']
  : ['--import', 'tsx', 'server/index.ts'];

const server = spawn(process.execPath, serverEntry, {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    FORG3_DATA_FILE: path.join(dataDir, 'store.json'),
    FORG3_OBJECT_STORE_PATH: path.join(dataDir, 'objects'),
    FORG3_DEVICE_2FA: 'true',
    FORG3_CREATOR_EMAILS: reviewEmail,
    FORG3_AGENT_OVERRIDE_EMAILS: ownerEmail,
    FORG3_AGENT_OVERRIDE_CODE_SHA256: crypto.createHash('sha256').update(agentOverrideCode).digest('hex'),
    FORG3_REVIEW_ACCESS_EMAIL: reviewEmail,
    FORG3_REVIEW_ACCESS_CODE: reviewCode,
    EMAIL_PROVIDER: '',
    APP_AUTH_SECRET: 'smoke-test-secret'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
server.stdout.on('data', (chunk) => (serverOutput += chunk));
server.stderr.on('data', (chunk) => (serverOutput += chunk));

const failures = [];
let passed = 0;

try {
  await waitForServer();
  await run();
  report();
} catch (error) {
  console.error('SMOKE FATAL:', error.message);
  console.error(serverOutput.slice(-2000));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}

async function run() {
  const health = await api('GET', '/api/health');
  check('health responds ok', health.status === 200 && health.body.ok === true);

  // Email-code login for the sender/owner.
  const ownerToken = await emailLogin(ownerEmail, 'Smoke Owner');
  check('email login issues a bearer token', Boolean(ownerToken));

  const reviewStart = await api('POST', '/api/auth/email/start', { email: reviewEmail, name: 'Store Review' });
  check('review access starts without inbox delivery', reviewStart.status === 201 && reviewStart.body.deliveryProvider === 'review_access');
  const reviewVerify = await api('POST', '/api/auth/email/verify', {
    email: reviewEmail,
    name: 'Store Review',
    challengeId: reviewStart.body.challengeId,
    code: reviewCode
  });
  check('review access reusable code issues a bearer token', reviewVerify.status === 200 && Boolean(reviewVerify.body.token));
  await trustCurrentDevice(reviewVerify.body.token, reviewCode, 'review access account');
  const reviewSubscription = await api('GET', '/api/subscription', undefined, reviewVerify.body.token);
  check('review access account has creator sender entitlement', reviewSubscription.status === 200 && reviewSubscription.body.entitlement?.creatorAccess === true);

  const documentsBefore = await api('GET', '/api/documents', undefined, ownerToken);
  check('documents list requires and accepts auth', documentsBefore.status === 200 && Array.isArray(documentsBefore.body.documents));

  const unauthenticated = await api('GET', '/api/documents');
  check('documents list rejects missing auth', unauthenticated.status === 401);

  const pdfDataUrl = `data:application/pdf;base64,${buildMinimalPdfBase64()}`;
  const unpaidCreate = await api(
    'POST',
    '/api/documents',
    {
      title: 'Unpaid Smoke Agreement',
      fileName: 'unpaid-smoke.pdf',
      fileType: 'application/pdf',
      fileDataUrl: pdfDataUrl,
      signers: [{ name: 'Smoke Signer', email: signerEmail }],
      expiresInHours: 24
    },
    ownerToken
  );
  check('unpaid owner cannot create signing links', unpaidCreate.status === 402);

  const invalidOverrideCreate = await api(
    'POST',
    '/api/documents',
    {
      title: 'Invalid Override Smoke Agreement',
      fileName: 'invalid-override-smoke.pdf',
      fileType: 'application/pdf',
      fileDataUrl: pdfDataUrl,
      signers: [{ name: 'Smoke Signer', email: signerEmail }],
      expiresInHours: 24
    },
    ownerToken,
    { 'x-forg3-agent-override': 'wrong-code' }
  );
  check('wrong agent override code cannot create signing links', invalidOverrideCreate.status === 402);

  const agentHeaders = { 'x-forg3-agent-override': agentOverrideCode };
  const agentEntitlement = await api('GET', '/api/subscription', undefined, ownerToken, agentHeaders);
  check(
    'agent override exposes active override entitlement for approved owner',
    agentEntitlement.status === 200 && agentEntitlement.body.entitlement?.agentOverrideAccess === true
  );
  const agentFeatures = await api('GET', '/api/features', undefined, ownerToken, agentHeaders);
  check('agent override grants highest-tier send capabilities', agentFeatures.status === 200 && agentFeatures.body.capabilities?.reminders === true);

  const overrideCreated = await api(
    'POST',
    '/api/documents',
    {
      title: 'Agent Override Smoke Agreement',
      fileName: 'agent-override-smoke.pdf',
      fileType: 'application/pdf',
      fileDataUrl: pdfDataUrl,
      signers: [{ name: 'Smoke Signer', email: signerEmail }],
      expiresInHours: 24
    },
    ownerToken,
    agentHeaders
  );
  check('approved agent override can create a signing link without a subscription', overrideCreated.status === 201 && createdLinkCount(overrideCreated.body) === 1);

  const overrideMultiSigner = await api(
    'POST',
    '/api/documents',
    {
      title: 'Agent Override Multi Signer Agreement',
      fileName: 'agent-override-multi-smoke.pdf',
      fileType: 'application/pdf',
      fileDataUrl: pdfDataUrl,
      signers: [
        { name: 'Smoke Signer', email: signerEmail },
        { name: 'Smoke Co Signer', email: 'smoke-cosigner@forg3.test' }
      ],
      expiresInHours: 24
    },
    ownerToken,
    agentHeaders
  );
  check('agent override grants multi-signer capability', overrideMultiSigner.status === 201 && createdLinkCount(overrideMultiSigner.body) === 2);

  const signerToken = await emailLogin(signerEmail, 'Smoke Signer');
  const signerSubscription = await api('GET', '/api/subscription', undefined, signerToken);
  check('free signer account has no active sender entitlement', signerSubscription.status === 200 && signerSubscription.body.entitlement?.active === false);

  const overrideSignerId = overrideCreated.body.signingLinks?.[0]?.signerId || 'missing-signer';
  const overrideSigned = await api(
    'POST',
    `/api/signer/documents/${overrideCreated.body.document?.id || 'missing-document'}/${overrideSignerId}/sign`,
    {
      signatureDataUrl: `data:image/png;base64,${buildTinyPngBase64()}`,
      signerNameConfirmation: 'Smoke Signer',
      consentText: 'I agree to sign electronically.'
    },
    signerToken
  );
  check('recipient can complete an override-created packet while owner is unpaid', overrideSigned.status === 200 && typeof overrideSigned.body.signedFileDataUrl === 'string');

  // Session management (added in the hardening sprint).
  const sessions = await api('GET', '/api/auth/sessions', undefined, ownerToken);
  check('sessions list returns the active session', sessions.status === 200 && Array.isArray(sessions.body.sessions) && sessions.body.sessions.length >= 1);

  // Audit log exists and is hash chained.
  const audit = await api('GET', '/api/audit', undefined, ownerToken);
  check('audit log is readable and owner scoped', audit.status === 200 && Array.isArray(audit.body.events));
  check('audit log records the login event', audit.body.events.some((event) => event.type === 'auth.login'));
  check('audit log records agent override usage', audit.body.events.some((event) => event.type === 'agent.override_used'));

  // Account export.
  const exported = await api('GET', '/api/account/export', undefined, ownerToken);
  check('account export returns owner data', exported.status === 200 && exported.body.account?.email === ownerEmail);

  // Document creation is subscription gated; a demo checkout unlocks it outside production.
  const payPerCheckout = await api('POST', '/api/subscription/checkout', { planId: 'forg3_pay_per_signature_annual', billingProvider: 'demo' }, ownerToken);
  check('demo pay-per-signature checkout activates an entitlement outside production', payPerCheckout.status === 201 && payPerCheckout.body.entitlement?.active === true);

  const payPerCreated = await api(
    'POST',
    '/api/documents',
    {
      title: 'Pay Per Signature Smoke Agreement',
      fileName: 'payper-smoke.pdf',
      fileType: 'application/pdf',
      fileDataUrl: pdfDataUrl,
      signers: [{ name: 'Smoke Signer', email: signerEmail }],
      expiresInHours: 24
    },
    ownerToken
  );
  check('pay-per-signature plan can create a single-signer link', payPerCreated.status === 201 && createdLinkCount(payPerCreated.body) === 1);

  const payPerCancel = await api('POST', '/api/subscription/cancel', {}, ownerToken);
  check('canceling pay-per-signature removes active entitlement', payPerCancel.status === 200 && payPerCancel.body.entitlement?.active === false);

  const payPerDocumentId = payPerCreated.body.document?.id || 'missing-document';
  const inactiveRotate = await api('POST', `/api/documents/${payPerDocumentId}/rotate-link`, { expiresInHours: 24 }, ownerToken);
  check('inactive owner cannot rotate signing links', inactiveRotate.status === 402);

  const checkout = await api('POST', '/api/subscription/checkout', { planId: 'forg3_business_monthly', billingProvider: 'demo' }, ownerToken);
  check('demo checkout activates a subscription outside production', checkout.status === 201 && checkout.body.entitlement?.active === true);

  const created = await api(
    'POST',
    '/api/documents',
    {
      title: 'Smoke Agreement',
      fileName: 'smoke.pdf',
      fileType: 'application/pdf',
      fileDataUrl: pdfDataUrl,
      signers: [{ name: 'Smoke Signer', email: signerEmail }],
      expiresInHours: 24
    },
    ownerToken
  );
  check('document creation succeeds', created.status === 201 && created.body.document?.status === 'sent');
  check('signing link is returned once', typeof created.body.signingLinks?.[0]?.signingPath === 'string');

  const pausedSubscription = await api('POST', '/api/subscription/cancel', {}, ownerToken);
  check('canceling monthly subscription removes active entitlement', pausedSubscription.status === 200 && pausedSubscription.body.entitlement?.active === false);

  const documentId = created.body.document.id;
  const inactiveReminder = await api('POST', `/api/documents/${documentId}/remind`, {}, ownerToken);
  check('inactive owner cannot send reminder signing links', inactiveReminder.status === 402);

  const reactivated = await api('POST', '/api/subscription/checkout', { planId: 'forg3_business_monthly', billingProvider: 'demo' }, ownerToken);
  check('reactivated monthly subscription restores entitlement', reactivated.status === 201 && reactivated.body.entitlement?.active === true);

  // The assigned recipient must authenticate with the matching email to view.
  const signerId = created.body.signingLinks[0].signerId;
  const inbox = await api('GET', '/api/signer/documents', undefined, signerToken);
  check('signer inbox lists the assigned document', inbox.status === 200 && inbox.body.documents.some((doc) => doc.id === documentId));

  const assigned = await api('GET', `/api/signer/documents/${documentId}/${signerId}`, undefined, signerToken);
  check('assigned signer can open the signing room', assigned.status === 200 && typeof assigned.body.fileDataUrl === 'string');

  const wrongSigner = await api('GET', `/api/signer/documents/${documentId}/${signerId}`, undefined, ownerToken);
  check('non-matching email cannot open the signing room', wrongSigner.status === 404);

  const signed = await api(
    'POST',
    `/api/signer/documents/${documentId}/${signerId}/sign`,
    {
      signatureDataUrl: `data:image/png;base64,${buildTinyPngBase64()}`,
      signerNameConfirmation: 'Smoke Signer',
      consentText: 'I agree to sign electronically.'
    },
    signerToken
  );
  check('signature completes and seals the PDF', signed.status === 200 && typeof signed.body.signedFileDataUrl === 'string');

  const sealed = await api('GET', `/api/documents/${documentId}/signed`, undefined, ownerToken);
  check('owner can download the sealed PDF', sealed.status === 200 && typeof sealed.body.signedFileDataUrl === 'string');

  const auditAfter = await api('GET', '/api/audit', undefined, ownerToken);
  check('audit log records document lifecycle events', auditAfter.body.events.some((event) => event.type === 'document.signed'));
  check('audit log is hash chained', verifyAuditChain(auditAfter.body.events));

  // Revoking all sessions invalidates the owner token.
  const revoke = await api('POST', '/api/auth/sessions/revoke-all', {}, ownerToken);
  check('revoke-all sessions succeeds', revoke.status === 200);
  const afterRevoke = await api('GET', '/api/documents', undefined, ownerToken);
  check('revoked token is rejected', afterRevoke.status === 401);
}

async function emailLogin(email, name) {
  const start = await api('POST', '/api/auth/email/start', { email, name, deviceId });
  if (start.status !== 201 || !start.body.devCode) {
    failures.push(`email/start for ${email} failed: ${start.status} ${JSON.stringify(start.body)}`);
    return '';
  }

  const verify = await api('POST', '/api/auth/email/verify', {
    email,
    name,
    deviceId,
    challengeId: start.body.challengeId,
    code: start.body.devCode
  });

  if (verify.status !== 200 || !verify.body.token) {
    failures.push(`email/verify for ${email} failed: ${verify.status} ${JSON.stringify(verify.body)}`);
    return '';
  }

  await trustCurrentDevice(verify.body.token, undefined, email);
  return verify.body.token;
}

async function trustCurrentDevice(token, expectedCode, label) {
  const deviceStatus = await api('GET', '/api/auth/device', undefined, token);
  check(`${label} sees device verification requirement`, deviceStatus.status === 200 && deviceStatus.body.required === true);

  if (deviceStatus.body.trusted === true) {
    return;
  }

  const start = await api('POST', '/api/auth/mfa/start', { deviceName: 'Smoke Device' }, token);
  const code = expectedCode || start.body.devCode;
  check(`${label} can start device verification immediately after email login`, start.status === 201 && Boolean(code));

  const verify = await api('POST', '/api/auth/mfa/verify', {
    deviceName: 'Smoke Device',
    challengeId: start.body.challengeId,
    code
  }, token);
  check(`${label} can complete device verification`, verify.status === 200 && verify.body.trusted === true);
}

function verifyAuditChain(events) {
  if (!events.length) {
    return false;
  }

  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].previousHash !== ordered[index - 1].hash) {
      return false;
    }
  }

  return true;
}

function check(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`ok - ${label}`);
  } else {
    failures.push(label);
    console.error(`FAIL - ${label}`);
  }
}

function createdLinkCount(body) {
  return Array.isArray(body?.signingLinks) ? body.signingLinks.length : 0;
}

function report() {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error(serverOutput.slice(-2000));
    process.exitCode = 1;
  }
}

async function api(method, apiPath, body, token, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-forg3-device-id': deviceId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  return { status: response.status, body: parsed };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Server did not become healthy in time.');
}

function buildMinimalPdfBase64() {
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 24 Tf 72 720 Td (Smoke) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f
trailer << /Size 5 /Root 1 0 R >>
startxref
0
%%EOF`;
  return Buffer.from(pdf, 'utf8').toString('base64');
}

function buildTinyPngBase64() {
  // 1x1 transparent PNG.
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
}
