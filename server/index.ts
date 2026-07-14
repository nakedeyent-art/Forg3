import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import {
  decodeAppleNotification,
  decodeGoogleRtdn,
  hashProviderToken,
  isAppleBillingConfigured,
  isGoogleBillingConfigured,
  isStoreBillingConfigured,
  verifyStoreBillingReceipt,
  type StoreBillingVerificationResult
} from './billing.js';
import {
  configureDeviceTrustVerifier,
  configureSessionVerifier,
  createEmailAuthToken,
  createDevAuthToken,
  devAuthEnabled,
  getEmailAuthTokenTtlSeconds,
  requireOwner,
  requirePrimaryOwner
} from './auth.js';
import { closeDatabasePool } from './db.js';
import { ObjectStore } from './objectStore.js';
import { sealPdfWithSignatures } from './pdf.js';
import { DocumentStore } from './store.js';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotpCode } from './totp.js';
import type {
  AccountSubscription,
  AuthProvider,
  BillingProvider,
  CompanyMember,
  DeliveryChannel,
  EmailDelivery,
  EmailDeliveryStatus,
  MfaChallenge,
  DocumentSummary,
  DocumentSigner,
  DocumentTemplate,
  PlanId,
  PublicStatus,
  SignatureFieldPlacement,
  SignerInboxDocument,
  SigningDocument,
  SubscriptionEntitlement,
  SubscriptionPlan,
  SubscriptionUsageSummary
} from './types.js';

loadRuntimeEnv();
assertProductionReadiness();

const app = express();
const store = new DocumentStore();
const objectStore = new ObjectStore();
const port = Number(process.env.PORT || 4127);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const distPath = path.resolve(process.cwd(), 'dist');
const payPerSignatureFeeCents = clamp(Number(process.env.PAY_PER_SIGNATURE_FEE_CENTS ?? 99), 0, 100000);
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '16mb';
const maxPdfBytes = clamp(Number(process.env.MAX_PDF_BYTES ?? 10 * 1024 * 1024), 1, 50 * 1024 * 1024);
const highestTierPlanId: PlanId = 'forg3_business_monthly';
const mfaCodeAttemptsMax = 5;
const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const signingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 80,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const authCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: clamp(Number(process.env.FORG3_AUTH_CODE_LIMIT ?? 10), 1, 100),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many code requests from this address. Try again later.' }
});
const authVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: clamp(Number(process.env.FORG3_AUTH_VERIFY_LIMIT ?? 40), 1, 200),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many verification attempts from this address. Try again later.' }
});
const codeResendCooldownMs = clamp(Number(process.env.FORG3_CODE_RESEND_COOLDOWN_SECONDS ?? 30), 5, 600) * 1000;
const lastCodeSentAt = new Map<string, number>();
const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: 'forg3_pay_per_signature_annual',
    name: 'Forg3 Pay Per Signature',
    priceLabel: '$12',
    cadence: 'year',
    billingModel: 'metered',
    packetLimit: null,
    seatLimit: 1,
    unlimitedAccess: false,
    appleProductId: 'com.forg3.sign.payper.yearly',
    googleProductId: 'forg3_pay_per_signature_yearly',
    usagePriceCents: payPerSignatureFeeCents,
    usagePriceLabel: `${formatCents(payPerSignatureFeeCents)}/signature`,
    billingNote: '$12 yearly base plus a charge for each completed signature.',
    features: [
      '$12 paid yearly',
      `${formatCents(payPerSignatureFeeCents)} per completed signature`,
      'Automatic signing-link email outbox',
      'Metered access for occasional packet sending'
    ]
  },
  {
    id: 'forg3_pro_monthly',
    name: 'Forg3 Pro',
    priceLabel: '$19',
    cadence: 'month',
    billingModel: 'flat',
    packetLimit: 50,
    seatLimit: 1,
    unlimitedAccess: false,
    appleProductId: 'com.forg3.sign.pro.monthly',
    googleProductId: 'forg3_pro_monthly',
    billingNote: 'Flat monthly access for consistent single-owner use, capped below unlimited tier.',
    features: [
      '50 signature packets per month',
      'Multi-signer routing',
      'Drag-and-drop field placement',
      'Templates and reminders'
    ]
  },
  {
    id: 'forg3_business_monthly',
    name: 'Forg3 Business',
    priceLabel: '$49',
    cadence: 'month',
    billingModel: 'flat',
    packetLimit: null,
    seatLimit: 5,
    unlimitedAccess: true,
    appleProductId: 'com.forg3.sign.business.monthly',
    googleProductId: 'forg3_business_monthly',
    billingNote: 'Flat monthly access for teams.',
    features: [
      'Everything in Pro',
      'Unlimited access for highest tier',
      'Company admin controls',
      'ID verification attestation'
    ]
  }
];

interface ProviderDeliveryResult {
  status: EmailDeliveryStatus;
  provider: string;
  providerMessageId?: string;
  providerSenderEmail?: string;
  replyToEmail?: string;
  error?: string;
}

interface MicrosoftGraphEmailConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sender: string;
  from?: string;
  replyTo?: string;
  saveToSentItems: boolean;
  useFromAlias: boolean;
}

configureDeviceTrustVerifier((owner, request) => isTrustedRequestDevice(owner.email, request));
configureSessionVerifier((ownerEmail, sessionId) => store.isSessionActive(ownerEmail, sessionId));

app.disable('x-powered-by');
// Behind a reverse proxy / load balancer the client IP arrives in
// X-Forwarded-For; rate limits are per-IP so this must match the deployment.
app.set('trust proxy', clamp(Number(process.env.TRUST_PROXY_HOPS ?? (process.env.NODE_ENV === 'production' ? 1 : 0)), 0, 10));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", 'http://127.0.0.1:4127', 'http://localhost:4127'],
        frameAncestors: ["'none'"],
        frameSrc: ["'self'", 'data:'],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"]
      }
    },
    hsts: process.env.NODE_ENV === 'production'
  })
);
app.use(cors({ origin: allowCorsOrigin }));
app.use(express.json({ limit: jsonBodyLimit }));
app.use(noStore);
app.use('/api', globalApiLimiter);
app.use(['/api/subscription/checkout', '/api/documents'], writeLimiter);
app.use('/api/signing/:token', signingLimiter);
app.use('/api/signer/documents', signingLimiter);
app.use(['/api/auth/email/start', '/api/auth/mfa/start'], authCodeLimiter);
app.use(['/api/auth/email/verify', '/api/auth/mfa/verify'], authVerifyLimiter);

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'forg3', time: new Date().toISOString() });
});

if (devAuthEnabled()) {
  app.post('/api/dev-auth/session', (request, response) => {
    const provider = request.body?.provider === 'apple' ? 'apple' : 'google';
    const uid = sanitizeDevId(String(request.body?.uid || crypto.randomUUID()));
    const email = looksLikeEmail(String(request.body?.email || ''))
      ? String(request.body.email).trim().toLowerCase()
      : `${provider}-${uid}@dev.forg3.local`;
    const name = String(request.body?.name || (provider === 'google' ? 'Google account' : 'Apple account')).trim();
    const owner = {
      uid,
      email,
      name: name || email
    };

    response.json({ owner, token: createDevAuthToken(owner) });
  });
}

app.get('/api/auth/device', requirePrimaryOwner, (request, response) => {
  const owner = request.owner!;
  const deviceId = getRequestDeviceId(request);

  if (!isDeviceMfaRequired()) {
    response.json({ trusted: true, required: false });
    return;
  }

  if (!deviceId) {
    response.json({ trusted: false, required: true, reason: 'missing_device_id' });
    return;
  }

  const deviceIdHash = hashDeviceId(owner.email, deviceId);
  const device = store.getTrustedDevice(owner.email, deviceIdHash);

  response.json({
    trusted: Boolean(device),
    required: true,
    expiresAt: device?.expiresAt,
    deviceName: device?.deviceName
  });
});

app.post('/api/auth/mfa/start', requirePrimaryOwner, async (request, response) => {
  const owner = request.owner!;
  const device = getMfaDeviceInput(request);

  if (!isDeviceMfaRequired()) {
    response.status(201).json({ trusted: true, required: false });
    return;
  }

  if (!device) {
    response.status(400).json({ error: 'A valid device id is required for two-factor verification.' });
    return;
  }

  const trustedDevice = store.getTrustedDevice(owner.email, device.deviceIdHash);
  if (trustedDevice) {
    response.status(201).json({ trusted: true, required: true, expiresAt: trustedDevice.expiresAt });
    return;
  }

  if (isCodeSendThrottled(owner.email, device.deviceIdHash, response)) {
    return;
  }

  const code = generateMfaCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getMfaCodeTtlMs()).toISOString();
  const challenge: MfaChallenge = store.addMfaChallenge({
    id: crypto.randomUUID(),
    ownerEmail: owner.email,
    deviceIdHash: device.deviceIdHash,
    deviceName: device.deviceName,
    codeHash: hashMfaCode(owner.email, device.deviceIdHash, code),
    status: 'pending',
    attemptCount: 0,
    createdAt: now.toISOString(),
    expiresAt
  });
  const delivery = await sendMfaCodeEmail(owner.email, owner.name, device.deviceName, code, expiresAt);
  const nextChallenge = store.updateMfaChallenge(owner.email, challenge.id, (current) => ({
    ...current,
    deliveryId: delivery.providerMessageId
  }))!;

  if ((delivery.status === 'failed' || delivery.status === 'provider_required') && process.env.NODE_ENV === 'production') {
    store.updateMfaChallenge(owner.email, challenge.id, (current) => ({ ...current, status: 'expired' }));
    response.status(502).json({ error: 'Could not send the two-factor verification email. Try again shortly.' });
    return;
  }

  response.status(201).json({
    challengeId: nextChallenge.id,
    expiresAt: nextChallenge.expiresAt,
    deliveryStatus: delivery.status,
    deliveryProvider: delivery.provider,
    devCode: process.env.NODE_ENV === 'production' ? undefined : delivery.status === 'logged' ? code : undefined
  });
});

app.post('/api/auth/mfa/verify', requirePrimaryOwner, (request, response) => {
  const owner = request.owner!;
  const device = getMfaDeviceInput(request);
  const challengeId = String(request.body?.challengeId || '').trim();
  const code = normalizeMfaCode(String(request.body?.code || ''));

  if (!isDeviceMfaRequired()) {
    response.json({ trusted: true, required: false });
    return;
  }

  if (!device || !challengeId || !code) {
    response.status(400).json({ error: 'Verification code and device id are required.' });
    return;
  }

  const challenge = store.getMfaChallenge(owner.email, challengeId);
  if (!challenge || challenge.deviceIdHash !== device.deviceIdHash || challenge.status !== 'pending') {
    response.status(400).json({ error: 'Verification code is invalid or expired.' });
    return;
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    store.updateMfaChallenge(owner.email, challenge.id, (current) => ({ ...current, status: 'expired' }));
    response.status(400).json({ error: 'Verification code expired. Request a new code.' });
    return;
  }

  const expectedHash = challenge.codeHash;
  const actualHash = hashMfaCode(owner.email, device.deviceIdHash, code);
  if (!constantTimeStringEqual(expectedHash, actualHash)) {
    const attemptCount = challenge.attemptCount + 1;
    store.updateMfaChallenge(owner.email, challenge.id, (current) => ({
      ...current,
      attemptCount,
      status: attemptCount >= mfaCodeAttemptsMax ? 'locked' : current.status
    }));
    response.status(400).json({
      error: attemptCount >= mfaCodeAttemptsMax ? 'Too many attempts. Request a new code.' : 'Verification code is incorrect.',
      attemptsRemaining: Math.max(0, mfaCodeAttemptsMax - attemptCount)
    });
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + getTrustedDeviceTtlMs()).toISOString();
  store.updateMfaChallenge(owner.email, challenge.id, (current) => ({
    ...current,
    status: 'verified',
    verifiedAt: now.toISOString()
  }));
  const trustedDevice = store.upsertTrustedDevice({
    id: crypto.randomUUID(),
    ownerEmail: owner.email,
    deviceIdHash: device.deviceIdHash,
    deviceName: device.deviceName,
    trustedAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt
  });

  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'auth.mfa_verified',
    message: `Two-factor verification completed on ${device.deviceName}.`
  });

  response.json({
    trusted: true,
    required: true,
    expiresAt: trustedDevice.expiresAt,
    deviceName: trustedDevice.deviceName
  });
});

app.post('/api/auth/email/start', async (request, response) => {
  const email = normalizeEmailAddress(String(request.body?.email || ''));
  const name = sanitizeEnvValue(String(request.body?.name || email), 120) || email;

  if (!email) {
    response.status(400).json({ error: 'A valid email address is required.' });
    return;
  }

  const device = getEmailAuthDeviceInput(email, request);
  if (!device) {
    response.status(400).json({ error: 'A valid device id is required.' });
    return;
  }

  if (isCodeSendThrottled(email, device.deviceIdHash, response)) {
    return;
  }

  const code = generateMfaCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getMfaCodeTtlMs()).toISOString();
  const challenge = store.addMfaChallenge({
    id: crypto.randomUUID(),
    ownerEmail: email,
    deviceIdHash: device.deviceIdHash,
    deviceName: device.deviceName,
    codeHash: hashMfaCode(email, device.deviceIdHash, code),
    status: 'pending',
    attemptCount: 0,
    createdAt: now.toISOString(),
    expiresAt
  });
  const delivery = await sendEmailLoginCode(email, name, device.deviceName, code, expiresAt);

  store.updateMfaChallenge(email, challenge.id, (current) => ({
    ...current,
    deliveryId: delivery.providerMessageId
  }));

  if ((delivery.status === 'failed' || delivery.status === 'provider_required') && process.env.NODE_ENV === 'production') {
    store.updateMfaChallenge(email, challenge.id, (current) => ({ ...current, status: 'expired' }));
    response.status(502).json({ error: 'Could not send the login code. Try again shortly.' });
    return;
  }

  response.status(201).json({
    challengeId: challenge.id,
    expiresAt,
    deliveryStatus: delivery.status,
    deliveryProvider: delivery.provider,
    devCode: process.env.NODE_ENV === 'production' ? undefined : delivery.status === 'logged' ? code : undefined
  });
});

app.post('/api/auth/email/verify', (request, response) => {
  const email = normalizeEmailAddress(String(request.body?.email || ''));
  const name = sanitizeEnvValue(String(request.body?.name || email), 120) || email;
  const challengeId = String(request.body?.challengeId || '').trim();
  const code = normalizeMfaCode(String(request.body?.code || ''));

  if (!email || !challengeId || !code) {
    response.status(400).json({ error: 'Email, challenge, and code are required.' });
    return;
  }

  const device = getEmailAuthDeviceInput(email, request);
  if (!device) {
    response.status(400).json({ error: 'A valid device id is required.' });
    return;
  }

  const challenge = store.getMfaChallenge(email, challengeId);
  if (!challenge || challenge.deviceIdHash !== device.deviceIdHash || challenge.status !== 'pending') {
    response.status(400).json({ error: 'Login code is invalid or expired.' });
    return;
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    store.updateMfaChallenge(email, challenge.id, (current) => ({ ...current, status: 'expired' }));
    response.status(400).json({ error: 'Login code expired. Request a new code.' });
    return;
  }

  const expectedHash = challenge.codeHash;
  const actualHash = hashMfaCode(email, device.deviceIdHash, code);
  if (!constantTimeStringEqual(expectedHash, actualHash)) {
    const attemptCount = challenge.attemptCount + 1;
    store.updateMfaChallenge(email, challenge.id, (current) => ({
      ...current,
      attemptCount,
      status: attemptCount >= mfaCodeAttemptsMax ? 'locked' : current.status
    }));
    response.status(400).json({
      error: attemptCount >= mfaCodeAttemptsMax ? 'Too many attempts. Request a new code.' : 'Login code is incorrect.',
      attemptsRemaining: Math.max(0, mfaCodeAttemptsMax - attemptCount)
    });
    return;
  }

  const totpEnrollment = store.getTotpEnrollment(email);
  if (totpEnrollment?.status === 'active') {
    const totpCode = String(request.body?.totpCode || '').trim();

    if (!totpCode) {
      response.status(401).json({ error: 'Enter the 6-digit code from your authenticator app.', totpRequired: true });
      return;
    }

    if (!verifyTotpCode(totpEnrollment.secret, totpCode)) {
      response.status(401).json({ error: 'Authenticator app code is incorrect.', totpRequired: true });
      return;
    }
  }

  store.updateMfaChallenge(email, challenge.id, (current) => ({
    ...current,
    status: 'verified',
    verifiedAt: new Date().toISOString()
  }));

  const now = new Date();
  const session = store.addSession({
    id: crypto.randomUUID(),
    ownerEmail: email,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + getEmailAuthTokenTtlSeconds() * 1000).toISOString(),
    deviceName: device.deviceName,
    deviceIdHash: device.deviceIdHash,
    authMethod: 'email_code'
  });
  store.appendAuditEvent({
    ownerEmail: email,
    actorEmail: email,
    type: 'auth.login',
    message: `Signed in with an email code${totpEnrollment?.status === 'active' ? ' and authenticator app' : ''} on ${device.deviceName}.`
  });

  const owner = { uid: `email:${email}`, email, name };
  response.json({
    owner,
    token: createEmailAuthToken(owner, session.id),
    sessionId: session.id,
    totpEnabled: totpEnrollment?.status === 'active'
  });
});

app.get('/api/auth/sessions', requireOwner, (request, response) => {
  const owner = request.owner!;
  const sessions = store.sessionsForOwner(owner.email).slice(0, 50).map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    deviceName: session.deviceName,
    authMethod: session.authMethod,
    active: !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now(),
    current: session.id === request.sessionId
  }));

  response.json({ sessions });
});

app.post('/api/auth/sessions/revoke', requireOwner, (request, response) => {
  const owner = request.owner!;
  const sessionId = String(request.body?.sessionId || '').trim();

  if (!sessionId) {
    response.status(400).json({ error: 'A sessionId is required.' });
    return;
  }

  if (!store.revokeSession(owner.email, sessionId)) {
    response.status(404).json({ error: 'Session not found or already revoked.' });
    return;
  }

  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'auth.session_revoked',
    message: 'A session was signed out remotely.'
  });
  response.json({ revoked: true });
});

app.post('/api/auth/sessions/revoke-all', requireOwner, (request, response) => {
  const owner = request.owner!;
  const revoked = store.revokeAllSessions(owner.email);

  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'auth.sessions_revoked_all',
    message: `All sessions were signed out (${revoked} revoked).`
  });
  response.json({ revoked });
});

app.get('/api/auth/devices', requireOwner, (request, response) => {
  const devices = store.trustedDevicesForOwner(request.owner!.email).map((device) => ({
    id: device.id,
    deviceName: device.deviceName,
    trustedAt: device.trustedAt,
    lastSeenAt: device.lastSeenAt,
    expiresAt: device.expiresAt
  }));

  response.json({ devices });
});

app.delete('/api/auth/devices/:id', requireOwner, (request, response) => {
  const owner = request.owner!;

  if (!store.deleteTrustedDevice(owner.email, String(request.params.id))) {
    response.status(404).json({ error: 'Trusted device not found.' });
    return;
  }

  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'auth.device_revoked',
    message: 'A trusted device was removed. It will need two-factor verification again.'
  });
  response.json({ revoked: true });
});

app.get('/api/auth/totp', requireOwner, (request, response) => {
  const enrollment = store.getTotpEnrollment(request.owner!.email);
  response.json({
    enabled: enrollment?.status === 'active',
    pending: enrollment?.status === 'pending',
    activatedAt: enrollment?.status === 'active' ? enrollment.activatedAt : undefined
  });
});

app.post('/api/auth/totp/enroll', requireOwner, (request, response) => {
  const owner = request.owner!;
  const existing = store.getTotpEnrollment(owner.email);

  if (existing?.status === 'active') {
    response.status(409).json({ error: 'An authenticator app is already active. Disable it before re-enrolling.' });
    return;
  }

  const secret = generateTotpSecret();
  store.upsertTotpEnrollment({
    ownerEmail: owner.email,
    secret,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'auth.totp_enrolled',
    message: 'Authenticator app enrollment started.'
  });

  response.status(201).json({ secret, otpauthUrl: buildOtpAuthUrl(owner.email, secret) });
});

app.post('/api/auth/totp/activate', requireOwner, (request, response) => {
  const owner = request.owner!;
  const enrollment = store.getTotpEnrollment(owner.email);
  const code = String(request.body?.code || '').trim();

  if (!enrollment || enrollment.status !== 'pending') {
    response.status(400).json({ error: 'Start authenticator enrollment first.' });
    return;
  }

  if (!verifyTotpCode(enrollment.secret, code)) {
    response.status(400).json({ error: 'Authenticator code is incorrect. Check the app and try again.' });
    return;
  }

  store.upsertTotpEnrollment({
    ...enrollment,
    status: 'active',
    activatedAt: new Date().toISOString()
  });
  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'auth.totp_activated',
    message: 'Authenticator app two-factor is now required at login.'
  });
  response.json({ enabled: true });
});

app.post('/api/auth/totp/disable', requireOwner, (request, response) => {
  const owner = request.owner!;
  const enrollment = store.getTotpEnrollment(owner.email);
  const code = String(request.body?.code || '').trim();

  if (!enrollment) {
    response.status(404).json({ error: 'No authenticator app is enrolled.' });
    return;
  }

  if (enrollment.status === 'active' && !verifyTotpCode(enrollment.secret, code)) {
    response.status(400).json({ error: 'Enter a valid authenticator code to disable it.' });
    return;
  }

  store.deleteTotpEnrollment(owner.email);
  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'auth.totp_disabled',
    message: 'Authenticator app two-factor was disabled.'
  });
  response.json({ enabled: false });
});

app.get('/api/audit', requireOwner, (request, response) => {
  response.json({ events: store.auditEventsForOwner(request.owner!.email) });
});

app.get('/api/account/export', requireOwner, (request, response) => {
  const owner = request.owner!;
  const documents = store
    .all()
    .filter((document) => sameEmail(document.ownerEmail, owner.email))
    .map(toSummary);

  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'account.exported',
    message: 'Account data export was downloaded.'
  });

  response.json({
    account: { email: owner.email, name: owner.name, exportedAt: new Date().toISOString() },
    subscription: store.getSubscription(owner.email) || null,
    signatureCharges: store.chargesForOwner(owner.email),
    documents,
    emailDeliveries: store.deliveriesForOwner(owner.email),
    templates: store.templatesForOwner(owner.email),
    trustedDevices: store.trustedDevicesForOwner(owner.email).map((device) => ({
      id: device.id,
      deviceName: device.deviceName,
      trustedAt: device.trustedAt,
      lastSeenAt: device.lastSeenAt,
      expiresAt: device.expiresAt
    })),
    sessions: store.sessionsForOwner(owner.email).map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      deviceName: session.deviceName,
      authMethod: session.authMethod
    })),
    auditEvents: store.auditEventsForOwner(owner.email, 1000)
  });
});

app.post('/api/account/delete', requireOwner, async (request, response) => {
  const owner = request.owner!;
  const confirmEmail = normalizeEmailAddress(String(request.body?.confirmEmail || ''));

  if (!sameEmail(confirmEmail, owner.email)) {
    response.status(400).json({ error: 'Type your account email to confirm deletion.' });
    return;
  }

  const removed = store.deleteOwnerData(owner.email);
  await objectStore.deleteOwnerObjects(owner.email);

  response.json({ deleted: true, documentsRemoved: removed.documents.length });
});

app.get('/api/documents', requireOwner, (request, response) => {
  response.json({
    documents: store
      .all()
      .filter((document) => sameEmail(document.ownerEmail, request.owner!.email))
      .map(toSummary)
  });
});

app.get('/api/subscription', requireOwner, (request, response) => {
  response.json({
    entitlement: getSubscriptionEntitlement(request.owner!.email),
    plans: subscriptionPlans
  });
});

app.post('/api/subscription/checkout', requireOwner, (request, response) => {
  const owner = request.owner!;
  const planId = normalizePlanId(request.body?.planId);
  const billingProvider = normalizeBillingProvider(request.body?.billingProvider);

  if (!planId) {
    response.status(400).json({ error: 'A valid planId is required.' });
    return;
  }

  if (!billingProvider) {
    response.status(400).json({ error: 'A valid billingProvider is required.' });
    return;
  }

  if (billingProvider === 'demo' && process.env.NODE_ENV === 'production') {
    response.status(403).json({ error: 'Demo billing is disabled in production.' });
    return;
  }

  if (billingProvider !== 'demo') {
    response.status(501).json({
      error: 'Native billing receipt verification is not connected yet.',
      requiredNextStep: 'Wire StoreKit or Google Play Billing receipt verification into /api/subscription/verify.'
    });
    return;
  }

  const now = new Date();
  const renewalDays = getPlanRenewalDays(planId);
  const subscription: AccountSubscription = {
    ownerEmail: owner.email,
    ownerName: owner.name || owner.email,
    planId,
    billingProvider,
    status: 'active',
    startedAt: now.toISOString(),
    renewsAt: new Date(now.getTime() + renewalDays * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: now.toISOString(),
    providerTransactionId: `demo_${crypto.randomUUID()}`
  };

  store.upsertSubscription(subscription);
  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'subscription.activated',
    message: `Subscription ${planId} was activated via ${billingProvider}.`
  });
  response.status(201).json({ entitlement: getSubscriptionEntitlement(owner.email), plans: subscriptionPlans });
});

app.post('/api/subscription/verify', requireOwner, async (request, response, next) => {
  const owner = request.owner!;
  const providerReceipt = String(request.body?.providerReceipt || '').trim();
  const planId = normalizePlanId(request.body?.planId);
  const billingProvider = normalizeBillingProvider(request.body?.billingProvider);

  if (!planId || !billingProvider || !providerReceipt) {
    response.status(400).json({ error: 'planId, billingProvider, and providerReceipt are required.' });
    return;
  }

  const plan = subscriptionPlans.find((current) => current.id === planId);

  if (!plan) {
    response.status(400).json({ error: 'Unknown planId.' });
    return;
  }

  try {
    const verification = await verifyStoreBillingReceipt({
      billingProvider,
      providerReceipt,
      plan,
      requestBody: request.body as Record<string, unknown>
    });

    if (!verification.verified) {
      response.status(verification.requiredNextStep ? 501 : 422).json({
        error: verification.error || 'Receipt verification failed.',
        requiredNextStep: verification.requiredNextStep
      });
      return;
    }

    const subscription = upsertVerifiedSubscription(owner.email, owner.name || owner.email, planId, billingProvider, verification);
    recordBillingEvent({
      ownerEmail: owner.email,
      billingProvider,
      providerEventId: verification.providerEventId || verification.providerTransactionId || crypto.randomUUID(),
      providerTransactionId: verification.providerTransactionId,
      providerOriginalTransactionId: verification.providerOriginalTransactionId,
      providerProductId: verification.providerProductId,
      providerPurchaseTokenHash: verification.providerPurchaseTokenHash,
      planId,
      eventType: 'receipt.verified',
      status: 'processed'
    });

    store.appendAuditEvent({
      ownerEmail: owner.email,
      actorEmail: owner.email,
      type: 'subscription.activated',
      message: `Subscription ${subscription.planId} was activated via ${billingProvider} receipt verification.`
    });
    response.status(201).json({ entitlement: getSubscriptionEntitlement(owner.email), plans: subscriptionPlans });
  } catch (error) {
    next(error);
  }
});

app.post('/api/billing/apple/notifications', async (request, response, next) => {
  if (!isAppleBillingConfigured()) {
    response.status(501).json({
      error: 'Apple App Store Server Notifications are not configured.',
      requiredNextStep: 'Configure App Store Server API credentials before accepting Apple subscription notifications.'
    });
    return;
  }

  try {
    const signedPayload = String(request.body?.signedPayload || '').trim();

    if (!signedPayload) {
      response.status(400).json({ error: 'signedPayload is required.' });
      return;
    }

    const notification = decodeAppleNotification(signedPayload);
    const transaction = notification.transaction;
    const providerEventId = notification.notificationUUID || hashProviderToken(signedPayload);

    if (store.getBillingEvent('apple_app_store', providerEventId)) {
      response.json({ duplicate: true, processed: false });
      return;
    }

    const subscription =
      (transaction?.transactionId && store.findSubscriptionByProviderTransactionId(transaction.transactionId)) ||
      (transaction?.originalTransactionId &&
        store.findSubscriptionByProviderOriginalTransactionId(transaction.originalTransactionId));
    const nextSubscription = subscription
      ? store.upsertSubscription({
          ...subscription,
          status: appleNotificationStatus(notification.notificationType, subscription.status),
          renewsAt: transaction?.expiresDate ? new Date(Number(transaction.expiresDate)).toISOString() : subscription.renewsAt,
          updatedAt: new Date().toISOString(),
          providerTransactionId: transaction?.transactionId || subscription.providerTransactionId,
          providerOriginalTransactionId: transaction?.originalTransactionId || subscription.providerOriginalTransactionId,
          providerProductId: transaction?.productId || subscription.providerProductId,
          providerEnvironment: transaction?.environment || subscription.providerEnvironment
        })
      : null;

    recordBillingEvent({
      ownerEmail: nextSubscription?.ownerEmail,
      billingProvider: 'apple_app_store',
      providerEventId,
      providerTransactionId: transaction?.transactionId,
      providerOriginalTransactionId: transaction?.originalTransactionId,
      providerProductId: transaction?.productId,
      planId: nextSubscription?.planId,
      eventType: notification.subtype
        ? `${notification.notificationType || 'unknown'}.${notification.subtype}`
        : notification.notificationType || 'unknown',
      status: nextSubscription ? 'processed' : 'ignored'
    });

    if (nextSubscription) {
      store.appendAuditEvent({
        ownerEmail: nextSubscription.ownerEmail,
        actorEmail: 'apple_app_store',
        type: 'subscription.webhook_received',
        message: `Apple billing notification ${notification.notificationType || 'unknown'} reconciled.`
      });
    }

    response.json({ processed: Boolean(nextSubscription) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/billing/google/rtdn', async (request, response, next) => {
  if (!isGoogleBillingConfigured()) {
    response.status(501).json({
      error: 'Google Play RTDN is not configured.',
      requiredNextStep: 'Configure Google Play service-account credentials before accepting RTDN events.'
    });
    return;
  }

  if (!isGoogleRtdnRequestTrusted(request)) {
    response.status(401).json({ error: 'Google RTDN verification token is missing or invalid.' });
    return;
  }

  try {
    const notification = decodeGoogleRtdn(request.body as Record<string, unknown>);

    if (store.getBillingEvent('google_play', notification.eventId)) {
      response.json({ duplicate: true, processed: false });
      return;
    }

    const purchaseTokenHash = notification.purchaseToken ? hashProviderToken(notification.purchaseToken) : '';
    const subscription = purchaseTokenHash
      ? store.findSubscriptionByProviderPurchaseTokenHash(purchaseTokenHash)
      : undefined;
    const nextSubscription = subscription
      ? store.upsertSubscription({
          ...subscription,
          status: googleNotificationStatus(notification.notificationType, subscription.status),
          updatedAt: new Date().toISOString()
        })
      : null;

    recordBillingEvent({
      ownerEmail: nextSubscription?.ownerEmail,
      billingProvider: 'google_play',
      providerEventId: notification.eventId,
      providerProductId: notification.productId,
      providerPurchaseTokenHash: purchaseTokenHash || undefined,
      planId: nextSubscription?.planId,
      eventType: notification.notificationType || 'unknown',
      status: nextSubscription ? 'processed' : 'ignored'
    });

    if (nextSubscription) {
      store.appendAuditEvent({
        ownerEmail: nextSubscription.ownerEmail,
        actorEmail: 'google_play',
        type: 'subscription.webhook_received',
        message: `Google Play RTDN ${notification.notificationType || 'unknown'} reconciled.`
      });
    }

    response.json({ processed: Boolean(nextSubscription) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/subscription/cancel', requireOwner, (request, response) => {
  const ownerEmail = request.owner!.email;
  const subscription = store.getSubscription(ownerEmail);

  if (!subscription) {
    response.status(404).json({ error: 'Subscription not found.' });
    return;
  }

  const canceled: AccountSubscription = {
    ...subscription,
    status: 'canceled',
    canceledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.upsertSubscription(canceled);
  store.appendAuditEvent({
    ownerEmail,
    actorEmail: ownerEmail,
    type: 'subscription.canceled',
    message: 'Subscription was canceled.'
  });
  response.json({ entitlement: getSubscriptionEntitlement(ownerEmail), plans: subscriptionPlans });
});

app.get('/api/features', requireOwner, (request, response) => {
  response.json({
    featureStatus: getFeatureStatus(),
    capabilities: getCapabilitiesForOwner(request.owner!.email)
  });
});

app.get('/api/email-deliveries', requireOwner, (request, response) => {
  response.json({ deliveries: store.deliveriesForOwner(request.owner!.email).slice(0, 25) });
});

app.get('/api/signer/documents', requireOwner, (request, response) => {
  const signerEmail = request.owner!.email;
  const documents = store
    .all()
    .flatMap((document) =>
      getDocumentSigners(document)
        .filter((signer) => sameEmail(signer.email, signerEmail))
        .map((signer) => toSignerInboxDocument(document, signer))
    )
    .slice(0, 100);

  response.json({ documents });
});

app.get('/api/templates', requireOwner, (request, response) => {
  const gate = requireCapability(request.owner!.email, 'templates', response);

  if (!gate) {
    return;
  }

  response.json({ templates: store.templatesForOwner(request.owner!.email) });
});

app.post('/api/templates', requireOwner, (request, response) => {
  const owner = request.owner!;
  const gate = requireCapability(owner.email, 'templates', response);

  if (!gate) {
    return;
  }

  const now = new Date().toISOString();
  const signerRoles = normalizeSigners(request.body?.signers || [], {
    signerName: 'Signer',
    signerEmail: owner.email
  }).map((signer, index) => ({
    name: signer.name,
    email: signer.email,
    role: signer.role,
    order: index + 1
  }));
  const template: DocumentTemplate = {
    id: crypto.randomUUID(),
    ownerEmail: owner.email,
    name: String(request.body?.name || request.body?.title || 'Untitled template').trim(),
    title: String(request.body?.title || 'Untitled document').trim(),
    signerRoles,
    expiresInHours: clamp(Number(request.body?.expiresInHours || 72), 1, 24 * 30),
    signatureField: normalizeSignatureField(request.body?.signatureField),
    identityVerificationRequired: Boolean(request.body?.identityVerificationRequired),
    createdAt: now,
    updatedAt: now
  };

  store.upsertTemplate(template);
  response.status(201).json({ template });
});

app.delete('/api/templates/:id', requireOwner, (request, response) => {
  const gate = requireCapability(request.owner!.email, 'templates', response);

  if (!gate) {
    return;
  }

  if (!store.deleteTemplate(request.owner!.email, String(request.params.id))) {
    response.status(404).json({ error: 'Template not found.' });
    return;
  }

  response.status(204).send();
});

app.get('/api/company', requireOwner, (request, response) => {
  const owner = request.owner!;
  const gate = requireCapability(owner.email, 'companyAdmin', response);

  if (!gate) {
    return;
  }

  response.json({ company: getOrCreateCompany(owner.email, owner.name || owner.email) });
});

app.post('/api/company/members', requireOwner, (request, response) => {
  const owner = request.owner!;
  const gate = requireCapability(owner.email, 'companyAdmin', response);

  if (!gate) {
    return;
  }

  const email = String(request.body?.email || '').trim().toLowerCase();
  const name = String(request.body?.name || email).trim();
  const role = normalizeCompanyRole(request.body?.role);

  if (!looksLikeEmail(email)) {
    response.status(400).json({ error: 'A valid member email is required.' });
    return;
  }

  const company = getOrCreateCompany(owner.email, owner.name || owner.email);
  const member: CompanyMember = {
    id: crypto.randomUUID(),
    email,
    name: name || email,
    role,
    status: 'invited',
    invitedAt: new Date().toISOString()
  };
  const nextCompany = {
    ...company,
    members: [...company.members.filter((current) => !sameEmail(current.email, email)), member],
    updatedAt: new Date().toISOString()
  };

  store.upsertCompany(nextCompany);
  response.status(201).json({ company: nextCompany });
});

app.get('/api/documents/:id', requireOwner, async (request, response) => {
  const document = store.get(String(request.params.id));

  if (!document || !sameEmail(document.ownerEmail, request.owner!.email)) {
    response.status(404).json({ error: 'Document not found.' });
    return;
  }

  response.json({ document: toSummary(document), fileDataUrl: await readOriginalFileDataUrl(document) });
});

app.get('/api/documents/:id/signed', requireOwner, async (request, response) => {
  const document = store.get(String(request.params.id));

  if (
    !document ||
    !sameEmail(document.ownerEmail, request.owner!.email) ||
    (!document.signedFileDataUrl && !document.signedFileObjectKey)
  ) {
    response.status(404).json({ error: 'Signed PDF is not available.' });
    return;
  }

  response.json({
    fileName: signedFileName(document.fileName),
    signedFileDataUrl: await readSignedFileDataUrl(document),
    signedDocumentHash: document.signedDocumentHash,
    signedAt: document.signedAt
  });
});

app.post('/api/documents', requireOwner, async (request, response) => {
  const owner = request.owner!;
  const body = request.body as Partial<SigningDocument> & { expiresInHours?: number; signers?: unknown };
  const requiredFields = ['title', 'fileName', 'fileType', 'fileDataUrl'] as const;
  const missingFields = requiredFields.filter((field) => !body[field]);

  if (missingFields.length) {
    response.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    return;
  }

  if (!String(body.fileType).includes('pdf') || !String(body.fileDataUrl).startsWith('data:application/pdf;base64,')) {
    response.status(400).json({ error: 'Only PDF documents are supported in this version.' });
    return;
  }

  if (dataUrlByteLength(String(body.fileDataUrl)) > maxPdfBytes) {
    response.status(413).json({ error: 'PDF exceeds the configured upload size limit.' });
    return;
  }

  const entitlement = getSubscriptionEntitlement(owner.email);
  const creationBlock = getDocumentCreationBlock(owner.email, entitlement);

  if (creationBlock) {
    response.status(402).json({ error: creationBlock, entitlement });
    return;
  }

  const expiresInHours = clamp(Number(body.expiresInHours || 72), 1, 24 * 30);
  const now = new Date();
  const documentId = crypto.randomUUID();
  const rawSigners = normalizeSigners(body.signers, {
    signerName: String(body.signerName || ''),
    signerEmail: String(body.signerEmail || '')
  });

  if (!rawSigners.length) {
    response.status(400).json({ error: 'At least one signer name and email is required.' });
    return;
  }

  const capabilities = getCapabilitiesForOwner(owner.email);
  if (rawSigners.length > 1 && !capabilities.multiSigner) {
    response.status(402).json({ error: 'Multi-signer routing requires Forg3 Pro or Business.' });
    return;
  }

  const signatureField = normalizeSignatureField(body.signatureField);
  if (!isDefaultSignatureField(signatureField) && !capabilities.fieldPlacement) {
    response.status(402).json({ error: 'Drag-and-drop field placement requires Forg3 Pro or Business.' });
    return;
  }

  const identityVerificationRequired = Boolean(body.identityVerificationRequired);
  if (identityVerificationRequired && !capabilities.idVerification) {
    response.status(402).json({ error: 'ID verification requires Forg3 Business.' });
    return;
  }

  const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString();
  const links = rawSigners.map((signer, index) => {
    const token = generateToken();
    return {
      signer: {
        id: crypto.randomUUID(),
        name: signer.name,
        email: signer.email,
        role: signer.role,
        order: index + 1,
        status: 'sent' as const,
        tokenHash: hashToken(token),
        expiresAt,
        identityVerification: {
          status: identityVerificationRequired ? 'provider_required' as const : 'not_required' as const,
          method: identityVerificationRequired ? 'provider' as const : 'none' as const
        }
      },
      token
    };
  });
  const fileObjectKey = await objectStore.putDataUrl(owner.email, documentId, 'original', String(body.fileDataUrl));
  const document: SigningDocument = {
    id: documentId,
    title: String(body.title).trim(),
    fileName: String(body.fileName),
    fileType: String(body.fileType),
    fileObjectKey,
    documentHash: sha256DataUrl(String(body.fileDataUrl)),
    ownerName: owner.name || owner.email,
    ownerEmail: owner.email,
    signerName: links[0].signer.name,
    signerEmail: links[0].signer.email,
    signers: links.map((link) => link.signer),
    signatureField,
    identityVerificationRequired,
    authProvider: normalizeProvider(body.authProvider),
    createdAt: now.toISOString(),
    expiresAt,
    status: 'sent',
    tokenHash: links[0].signer.tokenHash
  };

  store.create(document);
  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'document.created',
    message: `Document "${document.title}" was sent to ${links.length} signer${links.length === 1 ? '' : 's'}.`,
    documentId: document.id
  });
  const signingLinks = links.map((link) => ({
    signerId: link.signer.id,
    signerName: link.signer.name,
    signerEmail: link.signer.email,
    signingUrl: makePublicSigningUrl(makeAssignedSigningPath(document.id, link.signer.id), request),
    signingPath: makeAssignedSigningPath(document.id, link.signer.id)
  }));

  const deliveries: EmailDelivery[] = [];
  for (const link of signingLinks) {
    deliveries.push(...await createSignerDeliveries({
      request,
      ownerEmail: owner.email,
      ownerName: owner.name,
      documentId: document.id,
      signerId: link.signerId,
      toEmail: link.signerEmail,
      toName: link.signerName,
      kind: 'signing_link',
      signingPath: link.signingPath,
      signingUrl: link.signingUrl,
      documentTitle: document.title
    }));
  }

  response.status(201).json({ document: toSummary(document), signingPath: signingLinks[0]?.signingPath, signingLinks, deliveries });
});

app.post('/api/documents/:id/rotate-link', requireOwner, (request, response) => {
  const document = store.get(String(request.params.id));

  if (!document || !sameEmail(document.ownerEmail, request.owner!.email)) {
    response.status(404).json({ error: 'Document not found.' });
    return;
  }

  if (document.status === 'signed') {
    response.status(409).json({ error: 'Signed documents cannot receive a new signing link.' });
    return;
  }

  if (document.status === 'voided') {
    response.status(409).json({ error: 'Voided documents cannot receive a new signing link.' });
    return;
  }

  const expiresInHours = clamp(Number(request.body?.expiresInHours || 72), 1, 24 * 30);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  const unsignedSigners = getDocumentSigners(document).filter((signer) => signer.status !== 'signed');
  const links = unsignedSigners.map((signer) => ({ signerId: signer.id, token: generateToken() }));
  const next = store.update(document.id, (current) => ({
    ...current,
    expiresAt,
    tokenHash: links[0] ? hashToken(links[0].token) : null,
    signers: getDocumentSigners(current).map((signer) => {
      const link = links.find((currentLink) => currentLink.signerId === signer.id);
      return link ? { ...signer, tokenHash: hashToken(link.token), expiresAt } : signer;
    })
  }));
  const signingLinks = links.map((link) => {
    const signer = getDocumentSigners(next!).find((current) => current.id === link.signerId)!;
    return {
      signerId: signer.id,
      signerName: signer.name,
      signerEmail: signer.email,
      signingPath: makeAssignedSigningPath(document.id, signer.id),
      signingUrl: makePublicSigningUrl(makeAssignedSigningPath(document.id, signer.id), request)
    };
  });

  store.appendAuditEvent({
    ownerEmail: request.owner!.email,
    actorEmail: request.owner!.email,
    type: 'document.link_rotated',
    message: `Signing links were rotated for "${document.title}".`,
    documentId: document.id
  });

  response.json({ document: toSummary(next!), signingPath: signingLinks[0]?.signingPath, signingLinks });
});

app.post('/api/documents/:id/remind', requireOwner, async (request, response) => {
  const owner = request.owner!;
  const gate = requireCapability(owner.email, 'reminders', response);

  if (!gate) {
    return;
  }

  const document = store.get(String(request.params.id));

  if (!document || !sameEmail(document.ownerEmail, owner.email)) {
    response.status(404).json({ error: 'Document not found.' });
    return;
  }

  if (document.status !== 'sent') {
    response.status(409).json({ error: 'Only active documents can receive reminders.' });
    return;
  }

  const activeSigners = getDocumentSigners(document).filter((signer) => signer.status !== 'signed');
  const reminderLinks = activeSigners.map((signer) => ({ signerId: signer.id, token: generateToken() }));
  const next = store.update(document.id, (current) => ({
    ...current,
    tokenHash: reminderLinks[0] ? hashToken(reminderLinks[0].token) : null,
    signers: getDocumentSigners(current).map((signer) => {
      const reminderLink = reminderLinks.find((link) => link.signerId === signer.id);
      return reminderLink ? { ...signer, tokenHash: hashToken(reminderLink.token) } : signer;
    })
  }));
  const deliveries: EmailDelivery[] = [];
  const signingLinks: Array<{
    signerId: string;
    signerName: string;
    signerEmail: string;
    signingPath: string;
    signingUrl: string;
  }> = [];
  for (const link of reminderLinks) {
    const signer = getDocumentSigners(next!).find((current) => current.id === link.signerId)!;
    const signingPath = makeAssignedSigningPath(document.id, signer.id);
    const signingUrl = makePublicSigningUrl(signingPath, request);
    signingLinks.push({
      signerId: signer.id,
      signerName: signer.name,
      signerEmail: signer.email,
      signingPath,
      signingUrl
    });
    deliveries.push(...await createSignerDeliveries({
      request,
      ownerEmail: owner.email,
      ownerName: owner.name,
      documentId: document.id,
      signerId: signer.id,
      toEmail: signer.email,
      toName: signer.name,
      kind: 'reminder',
      signingPath,
      signingUrl,
      documentTitle: document.title
    }));
  }

  store.appendAuditEvent({
    ownerEmail: owner.email,
    actorEmail: owner.email,
    type: 'document.reminder_sent',
    message: `Reminders were sent for "${document.title}".`,
    documentId: document.id
  });

  response.status(201).json({ deliveries, signingLinks });
});

app.post('/api/documents/:id/void', requireOwner, (request, response) => {
  const document = store.get(String(request.params.id));

  if (!document || !sameEmail(document.ownerEmail, request.owner!.email)) {
    response.status(404).json({ error: 'Document not found.' });
    return;
  }

  if (document.status === 'signed') {
    response.status(409).json({ error: 'Signed documents cannot be voided.' });
    return;
  }

  const next = store.update(document.id, (current) => ({
    ...current,
    status: 'voided',
    tokenHash: null,
    signers: getDocumentSigners(current).map((signer) => ({ ...signer, tokenHash: null })),
    voidedAt: new Date().toISOString()
  }));

  store.appendAuditEvent({
    ownerEmail: request.owner!.email,
    actorEmail: request.owner!.email,
    type: 'document.voided',
    message: `Document "${document.title}" was voided.`,
    documentId: document.id
  });

  response.json({ document: toSummary(next!) });
});

app.get('/api/signing/:token', requireOwner, async (request, response) => {
  const tokenContext = getValidDocumentForToken(String(request.params.token), response);

  if (!tokenContext) {
    return;
  }

  const { document, signer } = tokenContext;
  if (!sameEmail(signer.email, request.owner!.email)) {
    response.status(404).json({ error: 'Document not found for this signer.' });
    return;
  }

  response.json({
    document: {
      id: document.id,
      title: document.title,
      fileName: document.fileName,
      documentHash: document.documentHash,
      signerId: signer.id,
      signerName: signer.name,
      signerEmail: signer.email,
      signerRole: signer.role,
      ownerName: document.ownerName,
      expiresAt: signer.expiresAt,
      identityVerificationRequired: Boolean(document.identityVerificationRequired)
    },
    fileDataUrl: await readOriginalFileDataUrl(document)
  });
});

app.get('/api/signer/documents/:documentId/:signerId', requireOwner, async (request, response) => {
  const signerContext = getValidDocumentForAssignedSigner(
    String(request.params.documentId),
    String(request.params.signerId),
    request.owner!.email,
    response
  );

  if (!signerContext) {
    return;
  }

  const { document, signer } = signerContext;

  store.appendAuditEvent({
    ownerEmail: document.ownerEmail,
    actorEmail: signer.email,
    type: 'document.viewed',
    message: `${signer.name} <${signer.email}> opened "${document.title}" in the signing room.`,
    documentId: document.id,
    signerId: signer.id
  });

  response.json({
    document: toPublicSigningDocument(document, signer),
    fileDataUrl: await readOriginalFileDataUrl(document)
  });
});

app.post('/api/signing/:token/sign', requireOwner, async (request, response, next) => {
  const tokenContext = getValidDocumentForToken(String(request.params.token), response);

  if (!tokenContext) {
    return;
  }

  const { document, signer } = tokenContext;
  if (!sameEmail(signer.email, request.owner!.email)) {
    response.status(404).json({ error: 'Document not found for this signer.' });
    return;
  }

  await completeSignerSignature(document, signer, request, response, next);
});

app.post('/api/signer/documents/:documentId/:signerId/sign', requireOwner, async (request, response, next) => {
  const signerContext = getValidDocumentForAssignedSigner(
    String(request.params.documentId),
    String(request.params.signerId),
    request.owner!.email,
    response
  );

  if (!signerContext) {
    return;
  }

  const { document, signer } = signerContext;

  await completeSignerSignature(document, signer, request, response, next);
});

async function completeSignerSignature(
  document: SigningDocument,
  signer: DocumentSigner,
  request: Request,
  response: Response,
  next: NextFunction
) {

  const signatureDataUrl = String(request.body?.signatureDataUrl || '');
  const signerNameConfirmation = String(request.body?.signerNameConfirmation || '').trim();
  const signerEmailConfirmation = String(request.body?.signerEmailConfirmation || '').trim().toLowerCase();
  const consentText = String(request.body?.consentText || '');

  if (!signatureDataUrl.startsWith('data:image/png;base64,')) {
    response.status(400).json({ error: 'A PNG signature image is required.' });
    return;
  }

  if (normalizeLooseName(signerNameConfirmation) !== normalizeLooseName(signer.name)) {
    response.status(400).json({ error: 'Signer name confirmation must match the assigned signer.' });
    return;
  }

  if (document.identityVerificationRequired && !sameEmail(signerEmailConfirmation, signer.email)) {
    response.status(400).json({ error: 'Signer email confirmation is required for ID verification.' });
    return;
  }

  const signedAt = new Date().toISOString();

  if (!canCompleteSignature(document, response)) {
    return;
  }

  try {
    const signedDocument = store.update(document.id, (current) => ({
      ...current,
      signers: getDocumentSigners(current).map((currentSigner) =>
        currentSigner.id === signer.id
          ? {
              ...currentSigner,
              status: 'signed',
              signedAt,
              signatureDataUrl,
              signerNameConfirmation,
              consentText,
              tokenHash: null,
              identityVerification: document.identityVerificationRequired
                ? {
                    status: 'self_attested',
                    method: 'self_attestation',
                    verifiedAt: signedAt,
                    signerEmailConfirmation
                  }
                : {
                    status: 'not_required',
                    method: 'none'
                  }
            }
          : currentSigner
      ),
      tokenHash: current.tokenHash === signer.tokenHash ? null : current.tokenHash
    }));
    const remaining = getDocumentSigners(signedDocument!).filter((current) => current.status !== 'signed').length;

    store.appendAuditEvent({
      ownerEmail: document.ownerEmail,
      actorEmail: signer.email,
      type: 'document.signer_signed',
      message: `${signer.name} <${signer.email}> signed "${document.title}".`,
      documentId: document.id,
      signerId: signer.id
    });

    if (remaining > 0) {
      response.json({
        document: toSummary(signedDocument!),
        fileName: signedFileName(document.fileName),
        pendingSignerCount: remaining
      });
      return;
    }

    const completedSigners = getDocumentSigners(signedDocument!);
    const signedFileDataUrl = await sealPdfWithSignatures({
      fileDataUrl: await readOriginalFileDataUrl(document),
      title: document.title,
      documentHash: document.documentHash,
      signatureField: document.signatureField,
      certificateAuthorityStatus: getFeatureStatus().certificateAuthoritySignatures.configured
        ? 'Configured provider available'
        : 'Provider certificate not configured',
      signers: completedSigners.map((completedSigner) => ({
        signerName: completedSigner.name,
        signerEmail: completedSigner.email,
        signatureDataUrl: completedSigner.signatureDataUrl!,
        signedAt: completedSigner.signedAt!,
        role: completedSigner.role,
        identityVerificationStatus: completedSigner.identityVerification?.status
      }))
    });
    const signedDocumentHash = sha256DataUrl(signedFileDataUrl);
    const signedFileObjectKey = await objectStore.putDataUrl(document.ownerEmail, document.id, 'signed', signedFileDataUrl);
    const finalDocument = store.update(document.id, (current) => ({
      ...current,
      status: 'signed',
      signedAt,
      signedFileObjectKey,
      signedDocumentHash,
      signedFileDataUrl: undefined,
      tokenHash: null,
      signers: getDocumentSigners(current).map((currentSigner) => ({ ...currentSigner, tokenHash: null }))
    }));

    recordSignatureUsage(finalDocument!);
    store.appendAuditEvent({
      ownerEmail: document.ownerEmail,
      actorEmail: signer.email,
      type: 'document.signed',
      message: `Document "${document.title}" is fully signed and sealed. Hash ${signedDocumentHash.slice(0, 16)}…`,
      documentId: document.id,
      signerId: signer.id
    });

    response.json({
      document: toSummary(finalDocument!),
      fileName: signedFileName(document.fileName),
      signedFileDataUrl,
      signedDocumentHash
    });
  } catch (error) {
    next(error);
  }
}

if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath));
  app.use((request, response, next) => {
    if (request.path.startsWith('/api')) {
      next();
      return;
    }

    response.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  response.status(500).json({ error: 'Unexpected server error.' });
});

let httpServer: ReturnType<typeof app.listen> | undefined;
let shuttingDown = false;

void (async () => {
  try {
    await store.init();
    await objectStore.init();
  } catch (error) {
    console.error('Forg3 startup failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  httpServer = app.listen(port, host, () => {
    const storage = objectStore.status();
    console.log(
      `Forg3 API listening at http://${host}:${port} ` +
        `(storage: ${storage.mode}, encrypted at rest: ${storage.encryptedAtRest ? 'yes' : 'no'})`
    );
  });
})();

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received; draining connections and flushing storage.`);
  setTimeout(() => process.exit(0), 8000).unref();

  await new Promise<void>((resolve) => {
    if (!httpServer) {
      resolve();
      return;
    }

    httpServer.close(() => resolve());
  });

  try {
    await store.flush();
    await closeDatabasePool();
  } catch (error) {
    console.error('Shutdown flush failed:', error instanceof Error ? error.message : error);
  }

  process.exit(0);
}

function noStore(_request: Request, response: Response, next: NextFunction) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  next();
}

function allowCorsOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
  if (!origin) {
    callback(null, true);
    return;
  }

  const configuredOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'capacitor://localhost',
    'https://localhost',
    ...configuredOrigins
  ]);

  callback(null, allowedOrigins.has(origin));
}

function getValidDocumentForToken(
  token: string,
  response: Response
): { document: SigningDocument; signer: DocumentSigner } | undefined {
  const tokenHash = hashToken(token);
  const tokenMatch = store.findByTokenHash(tokenHash);

  if (!tokenMatch) {
    response.status(404).json({ error: 'This signing link is invalid or already sealed.' });
    return undefined;
  }

  const document = tokenMatch.document;
  const signer = tokenMatch.signerId
    ? getDocumentSigners(document).find((current) => current.id === tokenMatch.signerId)
    : getDocumentSigners(document).find((current) => current.tokenHash === tokenHash);

  if (!signer) {
    response.status(404).json({ error: 'This signing link is invalid or already sealed.' });
    return undefined;
  }

  if (document.status !== 'sent') {
    response.status(410).json({ error: 'This signing link is no longer active.' });
    return undefined;
  }

  if (isExpired(document) || new Date(signer.expiresAt).getTime() <= Date.now()) {
    response.status(410).json({ error: 'This signing link has expired.' });
    return undefined;
  }

  return { document, signer };
}

function getValidDocumentForAssignedSigner(
  documentId: string,
  signerId: string,
  signerEmail: string,
  response: Response
): { document: SigningDocument; signer: DocumentSigner } | undefined {
  const document = store.get(String(documentId));

  if (!document) {
    response.status(404).json({ error: 'Document not found for this signer.' });
    return undefined;
  }

  const signer = getDocumentSigners(document).find((current) => current.id === String(signerId));

  if (!signer || !sameEmail(signer.email, signerEmail)) {
    response.status(404).json({ error: 'Document not found for this signer.' });
    return undefined;
  }

  if (document.status !== 'sent') {
    response.status(410).json({ error: 'This assigned document is no longer active.' });
    return undefined;
  }

  if (signer.status === 'signed') {
    response.status(410).json({ error: 'This signer assignment is already complete.' });
    return undefined;
  }

  if (isExpired(document) || new Date(signer.expiresAt).getTime() <= Date.now()) {
    response.status(410).json({ error: 'This assigned document has expired.' });
    return undefined;
  }

  return { document, signer };
}

function toPublicSigningDocument(document: SigningDocument, signer: DocumentSigner) {
  return {
    id: document.id,
    title: document.title,
    fileName: document.fileName,
    documentHash: document.documentHash,
    signerId: signer.id,
    signerName: signer.name,
    signerEmail: signer.email,
    signerRole: signer.role,
    ownerName: document.ownerName,
    expiresAt: signer.expiresAt,
    identityVerificationRequired: Boolean(document.identityVerificationRequired)
  };
}

function toSummary(document: SigningDocument): DocumentSummary {
  const signers = getDocumentSigners(document);
  const primarySigner = signers[0];

  return {
    id: document.id,
    title: document.title,
    fileName: document.fileName,
    documentHash: document.documentHash,
    ownerName: document.ownerName,
    ownerEmail: document.ownerEmail,
    signerName: primarySigner?.name || document.signerName,
    signerEmail: primarySigner?.email || document.signerEmail,
    signerCount: signers.length,
    signedSignerCount: signers.filter((signer) => signer.status === 'signed').length,
    signers: signers.map((signer) => ({
      id: signer.id,
      name: signer.name,
      email: signer.email,
      phone: signer.phone,
      role: signer.role,
      status: signer.status,
      signedAt: signer.signedAt
    })),
    signatureField: document.signatureField,
    identityVerificationRequired: Boolean(document.identityVerificationRequired),
    authProvider: document.authProvider,
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
    status: getPublicStatus(document),
    signedAt: document.signedAt,
    signedDocumentHash: document.signedDocumentHash,
    linkAvailable: signers.some((signer) => Boolean(signer.tokenHash) && signer.status === 'sent') && document.status === 'sent' && !isExpired(document)
  };
}

function toSignerInboxDocument(document: SigningDocument, signer: DocumentSigner): SignerInboxDocument {
  const documentStatus = getPublicStatus(document);
  const canSign = document.status === 'sent' && signer.status === 'sent' && !isExpired(document) && new Date(signer.expiresAt).getTime() > Date.now();

  return {
    id: document.id,
    title: document.title,
    fileName: document.fileName,
    documentHash: document.documentHash,
    ownerName: document.ownerName,
    ownerEmail: document.ownerEmail,
    signerId: signer.id,
    signerName: signer.name,
    signerEmail: signer.email,
    signerRole: signer.role,
    signerStatus: signer.status,
    documentStatus,
    expiresAt: signer.expiresAt,
    signedAt: signer.signedAt,
    canSign
  };
}

function getPublicStatus(document: SigningDocument): PublicStatus {
  return document.status === 'sent' && isExpired(document) ? 'expired' : document.status;
}

function getDocumentSigners(document: SigningDocument): DocumentSigner[] {
  if (document.signers?.length) {
    return document.signers;
  }

  return [
    {
      id: 'legacy-signer',
      name: document.signerName,
      email: document.signerEmail,
      order: 1,
      status: document.status === 'signed' ? 'signed' : 'sent',
      tokenHash: document.tokenHash,
      expiresAt: document.expiresAt,
      signedAt: document.signedAt,
      signatureDataUrl: document.signatureDataUrl,
      signerNameConfirmation: document.signerNameConfirmation,
      consentText: document.consentText,
      identityVerification: { status: 'not_required', method: 'none' }
    }
  ];
}

async function readOriginalFileDataUrl(document: SigningDocument) {
  if (document.fileObjectKey) {
    return objectStore.getDataUrl(document.fileObjectKey);
  }

  if (document.fileDataUrl) {
    return document.fileDataUrl;
  }

  throw new Error('Original PDF object is missing.');
}

async function readSignedFileDataUrl(document: SigningDocument) {
  if (document.signedFileObjectKey) {
    return objectStore.getDataUrl(document.signedFileObjectKey);
  }

  if (document.signedFileDataUrl) {
    return document.signedFileDataUrl;
  }

  throw new Error('Signed PDF object is missing.');
}

function normalizeSigners(
  signers: unknown,
  fallback: { signerName: string; signerEmail: string }
): Array<{ name: string; email: string; role?: string }> {
  const rawSigners = Array.isArray(signers) ? signers : [];
  const normalized = rawSigners
    .map((signer) => ({
      name: String((signer as { name?: unknown })?.name || '').trim(),
      email: String((signer as { email?: unknown })?.email || '').trim().toLowerCase(),
      role: String((signer as { role?: unknown })?.role || '').trim() || undefined
    }))
    .filter((signer) => signer.name && looksLikeEmail(signer.email));

  if (normalized.length) {
    return normalized.slice(0, 10);
  }

  const fallbackName = fallback.signerName.trim();
  const fallbackEmail = fallback.signerEmail.trim().toLowerCase();

  return fallbackName && looksLikeEmail(fallbackEmail) ? [{ name: fallbackName, email: fallbackEmail }] : [];
}

function normalizeSignatureField(value: unknown): SignatureFieldPlacement {
  const field = value as Partial<SignatureFieldPlacement> | undefined;
  return {
    page: 'last',
    xPercent: clamp(Number(field?.xPercent ?? 4), 0, 100),
    yPercent: clamp(Number(field?.yPercent ?? 4), 0, 100),
    widthPercent: clamp(Number(field?.widthPercent ?? 88), 35, 95)
  };
}

function isDefaultSignatureField(field: SignatureFieldPlacement) {
  return field.xPercent === 4 && field.yPercent === 4 && field.widthPercent === 88;
}

async function createSignerDeliveries(input: {
  request: Request;
  ownerEmail: string;
  ownerName?: string;
  documentId: string;
  signerId?: string;
  toEmail: string;
  toName: string;
  kind: 'signing_link' | 'reminder' | 'signed_copy';
  signingPath?: string;
  signingUrl?: string;
  documentTitle: string;
}) {
  const signingUrl = input.signingUrl || (input.signingPath ? makePublicSigningUrl(input.signingPath, input.request) : undefined);
  const senderEmail = normalizeEmailAddress(input.ownerEmail);
  const senderName = sanitizeEnvValue(input.ownerName || input.ownerEmail, 120);
  const subject =
    input.kind === 'reminder'
      ? `Reminder: ${input.documentTitle} is waiting for signature`
      : `${input.documentTitle} is ready for signature`;
  const bodyLines = [
    `Hello ${input.toName},`,
    '',
    senderEmail ? `Sent by: ${senderName} <${senderEmail}>` : '',
    '',
    input.kind === 'reminder' ? 'This is a reminder to sign the document.' : 'Please review and sign the document.',
    signingUrl ? `Signing link: ${signingUrl}` : '',
    '',
    'Forg3'
  ].filter(Boolean);
  const body = bodyLines.join('\n');

  return [
    await createDeliveryRecord({
      ...input,
      channel: 'email',
      senderEmail,
      subject,
      body,
      signingUrl
    })
  ];
}

async function createDeliveryRecord(input: {
  ownerEmail: string;
  ownerName?: string;
  documentId: string;
  signerId?: string;
  senderEmail?: string;
  toEmail: string;
  toName: string;
  channel: DeliveryChannel;
  kind: 'signing_link' | 'reminder' | 'signed_copy';
  subject: string;
  body: string;
  signingUrl?: string;
}) {
  const providerResult = await sendEmailDelivery({
    toEmail: input.toEmail,
    toName: input.toName,
    subject: input.subject,
    body: input.body,
    senderEmail: input.senderEmail || input.ownerEmail,
    senderName: input.ownerName
  });

  return store.addEmailDelivery({
    id: crypto.randomUUID(),
    ownerEmail: input.ownerEmail,
    documentId: input.documentId,
    signerId: input.signerId,
    senderEmail: input.senderEmail || input.ownerEmail,
    providerSenderEmail: providerResult.providerSenderEmail,
    replyToEmail: providerResult.replyToEmail,
    toEmail: input.toEmail,
    toName: input.toName,
    channel: input.channel,
    kind: input.kind,
    status: providerResult.status,
    subject: input.subject,
    body: redactSigningUrlFromBody(input.body, input.signingUrl),
    createdAt: new Date().toISOString(),
    provider: providerResult.provider,
    providerMessageId: providerResult.providerMessageId,
    error: providerResult.error
  });
}

function redactSigningUrlFromBody(body: string, signingUrl?: string) {
  if (!signingUrl) {
    return body;
  }

  return body.split(signingUrl).join('[signing link delivered externally or returned once]');
}

async function sendEmailDelivery(input: {
  toEmail: string;
  toName: string;
  subject: string;
  body: string;
  senderEmail?: string;
  senderName?: string;
}): Promise<ProviderDeliveryResult> {
  const provider = normalizeProviderName(process.env.EMAIL_PROVIDER);
  if (!provider) {
    return {
      status: 'logged' as const,
      provider: 'local_outbox',
      providerSenderEmail: normalizeEmailAddress(input.senderEmail),
      replyToEmail: normalizeEmailAddress(input.senderEmail)
    };
  }

  if (provider === 'microsoft_graph' || provider === 'msgraph' || provider === 'graph') {
    return sendMicrosoftGraphEmail(input);
  }

  if (provider === 'smtp') {
    return {
      status: 'provider_required' as const,
      provider,
      error: 'SMTP delivery is not connected in this build. Use EMAIL_PROVIDER=microsoft_graph or EMAIL_PROVIDER=resend.'
    };
  }

  if (provider !== 'resend') {
    return { status: 'provider_required' as const, provider, error: `Unsupported EMAIL_PROVIDER: ${provider}` };
  }

  const apiKey = process.env.RESEND_API_KEY || '';
  const senderEmail = normalizeEmailAddress(input.senderEmail);
  const configuredFrom = process.env.FORG3_EMAIL_FROM || process.env.EMAIL_FROM || '';
  const from = getEmailSendAsOwnerEnabled() && senderEmail ? senderEmail : configuredFrom;
  const replyTo = senderEmail || normalizeEmailAddress(process.env.FORG3_EMAIL_REPLY_TO || process.env.MAIL_REPLY_TO || configuredFrom);

  if (!apiKey || !from) {
    return { status: 'provider_required' as const, provider, error: 'RESEND_API_KEY and FORG3_EMAIL_FROM are required.' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [input.toEmail],
        subject: input.subject,
        text: input.body,
        html: plainTextEmailHtml(input.body),
        reply_to: replyTo || undefined
      })
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: string };

    if (!response.ok) {
      return {
        status: 'failed' as const,
        provider,
        error: redactConfiguredSecrets(String(payload.message || payload.error || response.statusText))
      };
    }

    return { status: 'sent' as const, provider, providerMessageId: payload.id, providerSenderEmail: normalizeEmailAddress(from), replyToEmail: replyTo };
  } catch (error) {
    return { status: 'failed' as const, provider, error: redactConfiguredSecrets(getErrorMessage(error)) };
  }
}

async function sendMicrosoftGraphEmail(input: {
  toEmail: string;
  subject: string;
  body: string;
  senderEmail?: string;
}): Promise<ProviderDeliveryResult> {
  const provider = 'microsoft_graph';
  const config = getMicrosoftGraphEmailConfig(input.senderEmail);

  if (!config) {
    return {
      status: 'provider_required' as const,
      provider,
      error: 'MICROSOFT_GRAPH_TENANT_ID, MICROSOFT_GRAPH_CLIENT_ID, MICROSOFT_GRAPH_CLIENT_SECRET, and MICROSOFT_GRAPH_SENDER are required.'
    };
  }

  try {
    const token = await getMicrosoftGraphAccessToken(config);
    const message: Record<string, unknown> = {
      subject: input.subject,
      body: {
        contentType: 'HTML',
        content: plainTextEmailHtml(input.body)
      },
      toRecipients: toGraphRecipients(input.toEmail)
    };
    const replyTo = toGraphRecipients(config.replyTo);
    if (replyTo.length) {
      message.replyTo = replyTo;
    }
    if (config.useFromAlias && config.from) {
      message.from = { emailAddress: { address: config.from } };
    }

    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        saveToSentItems: config.saveToSentItems
      })
    });
    const responseText = await response.text();

    if (response.status !== 202) {
      return {
        status: 'failed' as const,
        provider,
        error: redactConfiguredSecrets(responseText || response.statusText)
      };
    }

    return {
      status: 'sent' as const,
      provider,
      providerMessageId: `graph-${Date.now()}`,
      providerSenderEmail: config.sender,
      replyToEmail: config.replyTo
    };
  } catch (error) {
    return { status: 'failed' as const, provider, error: redactConfiguredSecrets(getErrorMessage(error)) };
  }
}

function getMicrosoftGraphEmailConfig(senderEmail?: string): MicrosoftGraphEmailConfig | null {
  const tenantId = sanitizeEnvValue(process.env.MICROSOFT_GRAPH_TENANT_ID);
  const clientId = sanitizeEnvValue(process.env.MICROSOFT_GRAPH_CLIENT_ID);
  const clientSecret = process.env.MICROSOFT_GRAPH_CLIENT_SECRET || '';
  const configuredSender = normalizeEmailAddress(process.env.MICROSOFT_GRAPH_SENDER || process.env.SMTP_USER || process.env.EMAIL_FROM || '');
  const requestedSender = normalizeEmailAddress(senderEmail);
  const sender = getEmailSendAsOwnerEnabled() && requestedSender ? requestedSender : configuredSender;
  const from = normalizeEmailAddress(process.env.FORG3_EMAIL_FROM || process.env.MAIL_FROM || process.env.EMAIL_FROM || sender);

  if (!tenantId || !clientId || !clientSecret || !sender) {
    return null;
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    sender,
    from,
    replyTo: requestedSender || normalizeEmailAddress(process.env.FORG3_EMAIL_REPLY_TO || process.env.MAIL_REPLY_TO || from || sender),
    saveToSentItems: process.env.MICROSOFT_GRAPH_SAVE_TO_SENT_ITEMS !== 'false',
    useFromAlias: process.env.MICROSOFT_GRAPH_USE_FROM_ALIAS === 'true'
  };
}

function getEmailSendAsOwnerEnabled() {
  return process.env.EMAIL_SEND_AS_OWNER === 'true' || process.env.MICROSOFT_GRAPH_SEND_AS_OWNER === 'true';
}

async function getMicrosoftGraphAccessToken(config: MicrosoftGraphEmailConfig) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };

  if (!response.ok || !body.access_token) {
    throw new Error(`Microsoft Graph token request failed: ${body.error_description || body.error || response.statusText}`);
  }

  return body.access_token;
}

function toGraphRecipients(value?: string) {
  return String(value || '')
    .split(',')
    .map((address) => normalizeEmailAddress(address))
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function isTrustedRequestDevice(ownerEmail: string, request: Request) {
  if (!isDeviceMfaRequired()) {
    return true;
  }

  const deviceId = getRequestDeviceId(request);
  if (!deviceId) {
    return false;
  }

  return Boolean(store.getTrustedDevice(ownerEmail, hashDeviceId(ownerEmail, deviceId)));
}

function getMfaDeviceInput(request: Request) {
  const deviceId = getRequestDeviceId(request);

  if (!deviceId) {
    return null;
  }

  const rawDeviceName = String(request.body?.deviceName || request.get('x-forg3-device-name') || 'Current device');
  return {
    deviceId,
    deviceIdHash: hashDeviceId(request.owner!.email, deviceId),
    deviceName: sanitizeEnvValue(rawDeviceName, 80) || 'Current device'
  };
}

function getEmailAuthDeviceInput(email: string, request: Request) {
  const deviceId = getRequestDeviceId(request);

  if (!deviceId) {
    return null;
  }

  const rawDeviceName = String(request.body?.deviceName || request.get('x-forg3-device-name') || 'Current device');
  return {
    deviceId,
    deviceIdHash: hashDeviceId(email, deviceId),
    deviceName: sanitizeEnvValue(rawDeviceName, 80) || 'Current device'
  };
}

function getRequestDeviceId(request: Request) {
  const value = String(request.get('x-forg3-device-id') || request.body?.deviceId || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(value)) {
    return '';
  }
  return value;
}

function isDeviceMfaRequired() {
  return process.env.FORG3_DEVICE_2FA !== 'false';
}

function isCodeSendThrottled(email: string, deviceIdHash: string, response: Response) {
  const throttleKey = `${email.trim().toLowerCase()}:${deviceIdHash}`;
  const lastSent = lastCodeSentAt.get(throttleKey) || 0;

  if (Date.now() - lastSent < codeResendCooldownMs) {
    response.status(429).json({
      error: `A code was just sent. Wait ${Math.ceil((codeResendCooldownMs - (Date.now() - lastSent)) / 1000)}s before requesting another.`
    });
    return true;
  }

  lastCodeSentAt.set(throttleKey, Date.now());

  if (lastCodeSentAt.size > 10000) {
    lastCodeSentAt.clear();
  }

  return false;
}

function generateMfaCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function normalizeMfaCode(value: string) {
  const code = value.replace(/\D/g, '').slice(0, 6);
  return code.length === 6 ? code : '';
}

function hashDeviceId(ownerEmail: string, deviceId: string) {
  return crypto
    .createHmac('sha256', getDeviceTrustSecret())
    .update(`${ownerEmail.trim().toLowerCase()}:${deviceId}`)
    .digest('hex');
}

function hashMfaCode(ownerEmail: string, deviceIdHash: string, code: string) {
  return crypto
    .createHmac('sha256', getDeviceTrustSecret())
    .update(`${ownerEmail.trim().toLowerCase()}:${deviceIdHash}:${code}`)
    .digest('hex');
}

function getDeviceTrustSecret() {
  return process.env.DEVICE_TRUST_SECRET || process.env.DEV_AUTH_SECRET || 'forg3-local-device-trust-secret';
}

function getMfaCodeTtlMs() {
  return clamp(Number(process.env.FORG3_MFA_CODE_TTL_MINUTES ?? 10), 2, 60) * 60 * 1000;
}

function getTrustedDeviceTtlMs() {
  return clamp(Number(process.env.FORG3_TRUSTED_DEVICE_DAYS ?? 30), 1, 365) * 24 * 60 * 60 * 1000;
}

function constantTimeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function sendMfaCodeEmail(toEmail: string, ownerName: string, deviceName: string, code: string, expiresAt: string) {
  const body = [
    `Hello ${ownerName || toEmail},`,
    '',
    `Your Forg3 verification code is ${code}.`,
    '',
    `Device: ${deviceName}`,
    `Expires: ${expiresAt}`,
    '',
    'If you did not try to sign in, do not share this code.',
    '',
    'Forg3'
  ].join('\n');

  return sendEmailDelivery({
    toEmail,
    toName: ownerName || toEmail,
    subject: 'Your Forg3 verification code',
    body,
    senderEmail: getSecurityEmailSender()
  });
}

async function sendEmailLoginCode(toEmail: string, ownerName: string, deviceName: string, code: string, expiresAt: string) {
  const body = [
    `Hello ${ownerName || toEmail},`,
    '',
    `Your Forg3 login code is ${code}.`,
    '',
    `Device: ${deviceName}`,
    `Expires: ${expiresAt}`,
    '',
    'If you did not try to log in, do not share this code.',
    '',
    'Forg3'
  ].join('\n');

  return sendEmailDelivery({
    toEmail,
    toName: ownerName || toEmail,
    subject: 'Your Forg3 login code',
    body,
    senderEmail: getSecurityEmailSender()
  });
}

function getSecurityEmailSender() {
  return normalizeEmailAddress(
    process.env.FORG3_SECURITY_EMAIL_FROM ||
      process.env.FORG3_EMAIL_FROM ||
      process.env.MICROSOFT_GRAPH_SENDER ||
      process.env.EMAIL_FROM ||
      ''
  );
}

function makePublicSigningUrl(signingPath: string, request: Request) {
  const pathPart = signingPath.startsWith('/') ? signingPath : `/${signingPath}`;
  return `${getPublicSigningBaseUrl(request)}/#${pathPart}`;
}

function makeAssignedSigningPath(documentId: string, signerId: string) {
  return `/inbox/sign/${encodeURIComponent(documentId)}/${encodeURIComponent(signerId)}`;
}

function getPublicSigningBaseUrl(request: Request) {
  const configured = process.env.PUBLIC_SIGNING_BASE_URL || process.env.FORG3_PUBLIC_URL || process.env.APP_PUBLIC_URL || '';
  if (configured.trim()) {
    return configured.trim().replace(/\/+$/, '');
  }

  const origin = request.get('origin');
  if (origin && /^https?:\/\//i.test(origin)) {
    return origin.replace(/\/+$/, '');
  }

  const host = request.get('x-forwarded-host') || request.get('host') || `127.0.0.1:${port}`;
  const proto = request.get('x-forwarded-proto') || request.protocol || 'http';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function loadRuntimeEnv() {
  const loadedValues: Record<string, string> = {};

  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.resolve(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    Object.assign(loadedValues, parseEnvFile(fs.readFileSync(filePath, 'utf8')));
  }

  for (const [key, value] of Object.entries(loadedValues)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseEnvFile(contents: string) {
  const values: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    values[match[1]] = parseEnvValue(match[2]);
  }

  return values;
}

function parseEnvValue(raw: string) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const unquoted = value.slice(1, -1);
    return value.startsWith('"')
      ? unquoted.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : unquoted;
  }

  return value.replace(/\s+#.*$/, '').trim();
}

function plainTextEmailHtml(text: string) {
  return text
    .split('\n')
    .map((line) => (line ? escapeHtml(line) : '<br />'))
    .join('<br />');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char] || char);
}

function normalizeProviderName(value: string | undefined) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function sanitizeEnvValue(value: string | undefined, maxLength = 300) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
}

function normalizeEmailAddress(value: string | undefined) {
  const raw = sanitizeEnvValue(value, 254);
  const angleMatch = raw.match(/<([^>]+)>/);
  const address = (angleMatch?.[1] || raw).trim().toLowerCase();
  return looksLikeEmail(address) ? address : '';
}

function redactConfiguredSecrets(value: string) {
  let output = value;
  for (const secret of [
    process.env.RESEND_API_KEY,
    process.env.MICROSOFT_GRAPH_CLIENT_SECRET,
    process.env.MICROSOFT_GRAPH_CLIENT_ID,
    process.env.MICROSOFT_GRAPH_TENANT_ID,
    process.env.SMTP_PASS,
    process.env.SMTP_PASSWORD
  ]) {
    if (secret) {
      output = output.split(secret).join('[redacted]');
    }
  }
  return output.slice(0, 300);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getSubscriptionEntitlement(ownerEmail: string): SubscriptionEntitlement {
  const subscription = store.getSubscription(ownerEmail);
  const usageSummary = getUsageSummary(ownerEmail);

  if (isCreatorEmail(ownerEmail)) {
    return {
      active: true,
      status: 'active',
      plan: null,
      subscription: null,
      usageSummary,
      reason: 'Creator unlimited access is configured for this account.',
      accessKind: 'creator_unlimited',
      unlimitedAccess: true,
      creatorAccess: true,
      packetLimit: null
    };
  }

  if (!subscription) {
    return {
      active: false,
      status: 'inactive',
      plan: null,
      subscription: null,
      usageSummary,
      reason: 'No subscription is on file.',
      accessKind: 'inactive',
      unlimitedAccess: false,
      creatorAccess: false,
      packetLimit: null
    };
  }

  const plan = subscriptionPlans.find((currentPlan) => currentPlan.id === subscription.planId) || null;
  const unlimitedAccess = Boolean(plan?.unlimitedAccess);
  const accessKind = plan?.id === highestTierPlanId ? 'highest_tier' : 'paid';

  if (subscription.status !== 'active') {
    return {
      active: false,
      status: subscription.status,
      plan,
      subscription,
      usageSummary,
      reason: `Subscription is ${subscription.status}.`,
      accessKind: 'inactive',
      unlimitedAccess: false,
      creatorAccess: false,
      packetLimit: plan?.packetLimit ?? null
    };
  }

  if (new Date(subscription.renewsAt).getTime() <= Date.now()) {
    return {
      active: false,
      status: 'past_due',
      plan,
      subscription: { ...subscription, status: 'past_due' },
      usageSummary,
      reason: 'Subscription renewal date has passed.',
      accessKind: 'inactive',
      unlimitedAccess: false,
      creatorAccess: false,
      packetLimit: plan?.packetLimit ?? null
    };
  }

  return {
    active: true,
    status: subscription.status,
    plan,
    subscription,
    usageSummary,
    accessKind,
    unlimitedAccess,
    creatorAccess: false,
    packetLimit: plan?.packetLimit ?? null
  };
}

function getCapabilitiesForOwner(ownerEmail: string) {
  const entitlement = getSubscriptionEntitlement(ownerEmail);
  const planId = entitlement.plan?.id;

  if (entitlement.creatorAccess) {
    return getCapabilitiesForPlan(highestTierPlanId, true);
  }

  return getCapabilitiesForPlan(planId, entitlement.unlimitedAccess);
}

function getDocumentCreationBlock(ownerEmail: string, entitlement: SubscriptionEntitlement) {
  if (!entitlement.active) {
    return 'An active Forg3 subscription is required before creating signing links.';
  }

  if (entitlement.unlimitedAccess || entitlement.creatorAccess || entitlement.packetLimit === null) {
    return null;
  }

  const windowStart = entitlement.subscription?.startedAt || new Date(0).toISOString();
  const usedInCurrentWindow = store
    .all()
    .filter((document) => sameEmail(document.ownerEmail, ownerEmail))
    .filter((document) => new Date(document.createdAt).getTime() >= new Date(windowStart).getTime()).length;

  if (usedInCurrentWindow >= entitlement.packetLimit) {
    return `This tier includes ${entitlement.packetLimit} signature packets in the current billing window. Upgrade to the highest tier for unlimited access.`;
  }

  return null;
}

function getCapabilitiesForPlan(planId?: PlanId | null, unlimitedAccess = false) {
  const proOrHigher = planId === 'forg3_pro_monthly' || planId === highestTierPlanId || unlimitedAccess;
  const highestTier = planId === highestTierPlanId || unlimitedAccess;

  return {
    automaticEmailDelivery: Boolean(planId),
    unlimitedAccess,
    multiSigner: proOrHigher,
    fieldPlacement: proOrHigher,
    templates: proOrHigher,
    reminders: proOrHigher,
    idVerification: highestTier,
    companyAdmin: highestTier,
    priorityAuditExports: highestTier,
    caBackedPdfSignatures: highestTier
  };
}

function requireCapability(
  ownerEmail: string,
  capability: keyof ReturnType<typeof getCapabilitiesForPlan>,
  response: Response
) {
  const capabilities = getCapabilitiesForOwner(ownerEmail);

  if (!capabilities[capability]) {
    response.status(402).json({ error: `${capability} is not available on the current Forg3 tier.` });
    return false;
  }

  return true;
}

function getFeatureStatus() {
  const emailProvider = normalizeProviderName(process.env.EMAIL_PROVIDER);
  return {
    emailDelivery: {
      mode: (emailProvider ? 'provider' : 'local_outbox') as 'provider' | 'local_outbox',
      configured: isEmailDeliveryConfigured(emailProvider)
    },
    identityVerification: {
      mode: (process.env.ID_VERIFICATION_PROVIDER ? 'provider' : 'self_attestation') as
        | 'provider'
        | 'self_attestation',
      configured: Boolean(process.env.ID_VERIFICATION_PROVIDER)
    },
    receiptVerification: {
      mode: (process.env.STORE_BILLING_VERIFICATION_MODE === 'mock' ? 'mock' : 'provider_required') as
        | 'mock'
        | 'provider_required',
      configured: isStoreBillingConfigured()
    },
    objectStorage: objectStore.status(),
    certificateAuthoritySignatures: {
      mode: 'provider_required' as const,
      configured: Boolean(process.env.PDF_SIGNING_CERT_P12_BASE64 && process.env.PDF_SIGNING_CERT_PASSWORD)
    }
  };
}

function isEmailDeliveryConfigured(provider = normalizeProviderName(process.env.EMAIL_PROVIDER)) {
  if (provider === 'resend') {
    return Boolean(process.env.RESEND_API_KEY && (process.env.FORG3_EMAIL_FROM || process.env.EMAIL_FROM));
  }

  if (provider === 'microsoft_graph' || provider === 'msgraph' || provider === 'graph') {
    return Boolean(getMicrosoftGraphEmailConfig());
  }

  return false;
}

function assertProductionReadiness() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const problems: string[] = [];

  if (!process.env.APP_AUTH_SECRET) {
    problems.push('APP_AUTH_SECRET — strong random secret that signs login tokens.');
  }

  if (isDeviceMfaRequired() && !process.env.DEVICE_TRUST_SECRET) {
    problems.push('DEVICE_TRUST_SECRET — strong random secret for device two-factor hashes.');
  }

  if (!isEmailDeliveryConfigured()) {
    problems.push('EMAIL_PROVIDER — a working microsoft_graph or resend configuration is required to deliver login codes and signing links.');
  }

  if (!process.env.DATABASE_URL && process.env.ALLOW_FILE_STORE_IN_PRODUCTION !== 'true') {
    problems.push('DATABASE_URL — Postgres connection string for durable storage.');
  }

  if (!process.env.FORG3_OBJECT_ENCRYPTION_KEY && process.env.ALLOW_PLAINTEXT_OBJECTS_IN_PRODUCTION !== 'true') {
    problems.push('FORG3_OBJECT_ENCRYPTION_KEY — 32-byte key (hex or base64) encrypting stored PDFs.');
  }

  if (problems.length) {
    throw new Error(
      `Production configuration is incomplete. Set the following environment variables (see docs/DEPLOYMENT.md):\n- ${problems.join('\n- ')}`
    );
  }

  if (!process.env.PUBLIC_SIGNING_BASE_URL && !process.env.FORG3_PUBLIC_URL && !process.env.APP_PUBLIC_URL) {
    console.warn('PUBLIC_SIGNING_BASE_URL is not set; signing links will be derived from request headers.');
  }
}

function upsertVerifiedSubscription(
  ownerEmail: string,
  ownerName: string,
  planId: PlanId,
  billingProvider: BillingProvider,
  verification: StoreBillingVerificationResult
) {
  const now = new Date();
  const renewalDays = getPlanRenewalDays(planId);
  const subscription: AccountSubscription = {
    ownerEmail,
    ownerName,
    planId,
    billingProvider,
    status: verification.status || 'active',
    startedAt: now.toISOString(),
    renewsAt:
      verification.renewsAt || new Date(now.getTime() + renewalDays * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: now.toISOString(),
    providerTransactionId: verification.providerTransactionId,
    providerOriginalTransactionId: verification.providerOriginalTransactionId,
    providerProductId: verification.providerProductId,
    providerPurchaseTokenHash: verification.providerPurchaseTokenHash,
    providerEnvironment: verification.providerEnvironment
  };

  return store.upsertSubscription(subscription);
}

function recordBillingEvent(event: {
  ownerEmail?: string;
  billingProvider: BillingProvider;
  providerEventId: string;
  providerTransactionId?: string;
  providerOriginalTransactionId?: string;
  providerProductId?: string;
  providerPurchaseTokenHash?: string;
  planId?: PlanId;
  eventType: string;
  status: 'processed' | 'ignored' | 'failed';
  error?: string;
}) {
  return store.addBillingEvent({
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    ...event
  });
}

function appleNotificationStatus(notificationType: string, fallback: AccountSubscription['status']) {
  if (['EXPIRED', 'REFUND', 'REVOKE'].includes(notificationType)) {
    return 'canceled';
  }

  if (['DID_FAIL_TO_RENEW', 'GRACE_PERIOD_EXPIRED'].includes(notificationType)) {
    return 'past_due';
  }

  if (['SUBSCRIBED', 'DID_RENEW', 'DID_CHANGE_RENEWAL_STATUS', 'DID_CHANGE_RENEWAL_PREF'].includes(notificationType)) {
    return 'active';
  }

  return fallback;
}

function googleNotificationStatus(notificationType: string, fallback: AccountSubscription['status']) {
  if (['3', '6', '12', '13', '20'].includes(notificationType)) {
    return 'canceled';
  }

  if (['5', '10', '11'].includes(notificationType)) {
    return 'past_due';
  }

  if (['1', '2', '4', '7', '8', '9', '19'].includes(notificationType)) {
    return 'active';
  }

  return fallback;
}

function isGoogleRtdnRequestTrusted(request: Request) {
  const expected = process.env.GOOGLE_RTDN_VERIFICATION_TOKEN || process.env.BILLING_WEBHOOK_TOKEN;

  if (!expected) {
    return true;
  }

  const provided = String(request.query.token || request.headers['x-forg3-webhook-token'] || '');

  if (Buffer.byteLength(expected) !== Buffer.byteLength(provided)) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function getOrCreateCompany(ownerEmail: string, ownerName: string) {
  const existing = store.getCompany(ownerEmail);

  if (existing) {
    return existing;
  }

  return store.upsertCompany({
    ownerEmail,
    companyName: `${ownerName}'s company`,
    members: [
      {
        id: crypto.randomUUID(),
        email: ownerEmail,
        name: ownerName,
        role: 'owner',
        status: 'active',
        invitedAt: new Date().toISOString()
      }
    ],
    updatedAt: new Date().toISOString()
  });
}

function getUsageSummary(ownerEmail: string): SubscriptionUsageSummary {
  const charges = store.chargesForOwner(ownerEmail).filter((charge) => charge.status === 'metered');
  const totalUsageCents = charges.reduce((total, charge) => total + charge.amountCents, 0);

  return {
    signatureCount: charges.length,
    totalUsageCents,
    totalUsageLabel: formatCents(totalUsageCents)
  };
}

function recordSignatureUsage(document: SigningDocument) {
  const entitlement = getSubscriptionEntitlement(document.ownerEmail);
  const plan = entitlement.plan;

  if (!plan || plan.billingModel !== 'metered') {
    return;
  }

  if (!entitlement.active && getSigningEntitlementPolicy() !== 'bill_metered') {
    return;
  }

  const amountCents = clamp(Number(plan.usagePriceCents ?? payPerSignatureFeeCents), 0, 100000);

  store.addSignatureCharge({
    id: crypto.randomUUID(),
    ownerEmail: document.ownerEmail,
    documentId: document.id,
    signerEmail: document.signerEmail,
    planId: plan.id,
    amountCents,
    status: amountCents > 0 ? 'metered' : 'waived',
    createdAt: document.signedAt || new Date().toISOString()
  });
}

function canCompleteSignature(document: SigningDocument, response: Response) {
  const entitlement = getSubscriptionEntitlement(document.ownerEmail);

  if (entitlement.active) {
    return true;
  }

  if (getSigningEntitlementPolicy() === 'bill_metered' && entitlement.plan?.billingModel === 'metered') {
    return true;
  }

  response.status(402).json({ error: 'The document owner subscription is not active.' });
  return false;
}

function getSigningEntitlementPolicy() {
  return process.env.SIGNING_ENTITLEMENT_POLICY === 'bill_metered' ? 'bill_metered' : 'block_when_inactive';
}

function getPlanRenewalDays(planId: PlanId) {
  return planId === 'forg3_pay_per_signature_annual' ? 365 : 30;
}

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sha256DataUrl(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return crypto.createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}

function dataUrlByteLength(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Buffer.byteLength(base64, 'base64');
}

function isExpired(document: SigningDocument) {
  return new Date(document.expiresAt).getTime() <= Date.now();
}

function normalizeProvider(provider: unknown): AuthProvider {
  if (provider === 'google' || provider === 'apple' || provider === 'email') {
    return provider;
  }

  return 'demo';
}

function normalizePlanId(planId: unknown): PlanId | null {
  return subscriptionPlans.some((plan) => plan.id === planId) ? (planId as PlanId) : null;
}

function normalizeBillingProvider(provider: unknown): BillingProvider | null {
  if (
    provider === 'apple_app_store' ||
    provider === 'google_play' ||
    provider === 'stripe' ||
    provider === 'demo'
  ) {
    return provider;
  }

  return null;
}

function normalizeCompanyRole(role: unknown) {
  return role === 'admin' || role === 'sender' || role === 'viewer' ? role : 'viewer';
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sameEmail(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function isCreatorEmail(ownerEmail: string) {
  return getCreatorEmailSet().has(ownerEmail.trim().toLowerCase());
}

function getCreatorEmailSet() {
  return new Set(
    (process.env.FORG3_CREATOR_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function sanitizeDevId(value: string) {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return sanitized || crypto.randomUUID();
}

function normalizeLooseName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.round(value), min), max);
}

function signedFileName(fileName: string) {
  return fileName.replace(/\.pdf$/i, '') + '-signed.pdf';
}

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(cents / 100);
}
