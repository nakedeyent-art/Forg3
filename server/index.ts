import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createDevAuthToken, devAuthEnabled, requireOwner } from './auth.js';
import { sealPdfWithSignature } from './pdf.js';
import { DocumentStore } from './store.js';
import type {
  AccountSubscription,
  AuthProvider,
  BillingProvider,
  DocumentSummary,
  PlanId,
  SigningDocument,
  SubscriptionEntitlement,
  SubscriptionPlan,
  SubscriptionUsageSummary
} from './types.js';

const app = express();
const store = new DocumentStore();
const port = Number(process.env.PORT || 4127);
const distPath = path.resolve(process.cwd(), 'dist');
const payPerSignatureFeeCents = clamp(Number(process.env.PAY_PER_SIGNATURE_FEE_CENTS ?? 99), 0, 100000);
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '16mb';
const maxPdfBytes = clamp(Number(process.env.MAX_PDF_BYTES ?? 10 * 1024 * 1024), 1, 50 * 1024 * 1024);
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
const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: 'forg3_pay_per_signature_annual',
    name: 'Forg3 Pay Per Signature',
    priceLabel: '$12',
    cadence: 'year',
    billingModel: 'metered',
    packetLimit: null,
    seatLimit: 1,
    appleProductId: 'com.forg3.sign.payper.yearly',
    googleProductId: 'forg3_pay_per_signature_yearly',
    usagePriceCents: payPerSignatureFeeCents,
    usagePriceLabel: `${formatCents(payPerSignatureFeeCents)}/signature`,
    billingNote: '$12 yearly base plus a charge for each completed signature.',
    features: ['$12 paid yearly', `${formatCents(payPerSignatureFeeCents)} per completed signature`, 'Built for occasional sending']
  },
  {
    id: 'forg3_pro_monthly',
    name: 'Forg3 Pro',
    priceLabel: '$19',
    cadence: 'month',
    billingModel: 'flat',
    packetLimit: null,
    seatLimit: 1,
    appleProductId: 'com.forg3.sign.pro.monthly',
    googleProductId: 'forg3_pro_monthly',
    billingNote: 'Flat monthly access for consistent single-owner use.',
    features: ['Unlimited signature packets', 'Single-use expiring links', 'Signed PDF downloads']
  },
  {
    id: 'forg3_business_monthly',
    name: 'Forg3 Business',
    priceLabel: '$49',
    cadence: 'month',
    billingModel: 'flat',
    packetLimit: null,
    seatLimit: 5,
    appleProductId: 'com.forg3.sign.business.monthly',
    googleProductId: 'forg3_business_monthly',
    billingNote: 'Flat monthly access for teams.',
    features: ['Everything in Pro', 'Five owner seats', 'Priority audit exports']
  }
];

app.disable('x-powered-by');
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

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'forg3-sign', time: new Date().toISOString() });
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
  response.status(201).json({ entitlement: getSubscriptionEntitlement(owner.email), plans: subscriptionPlans });
});

app.post('/api/subscription/verify', requireOwner, (request, response) => {
  const providerReceipt = String(request.body?.providerReceipt || '').trim();
  const planId = normalizePlanId(request.body?.planId);
  const billingProvider = normalizeBillingProvider(request.body?.billingProvider);

  if (!planId || !billingProvider || !providerReceipt) {
    response.status(400).json({ error: 'planId, billingProvider, and providerReceipt are required.' });
    return;
  }

  response.status(501).json({
    error: 'Receipt verification is intentionally stubbed in this build.',
    requiredNextStep: 'Verify StoreKit / Play Billing receipts server-side, then upsert an active subscription.'
  });
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
  response.json({ entitlement: getSubscriptionEntitlement(ownerEmail), plans: subscriptionPlans });
});

app.get('/api/documents/:id', requireOwner, (request, response) => {
  const document = store.get(String(request.params.id));

  if (!document || !sameEmail(document.ownerEmail, request.owner!.email)) {
    response.status(404).json({ error: 'Document not found.' });
    return;
  }

  response.json({ document: toSummary(document), fileDataUrl: document.fileDataUrl });
});

app.get('/api/documents/:id/signed', requireOwner, (request, response) => {
  const document = store.get(String(request.params.id));

  if (!document || !sameEmail(document.ownerEmail, request.owner!.email) || !document.signedFileDataUrl) {
    response.status(404).json({ error: 'Signed PDF is not available.' });
    return;
  }

  response.json({
    fileName: signedFileName(document.fileName),
    signedFileDataUrl: document.signedFileDataUrl,
    signedDocumentHash: document.signedDocumentHash,
    signedAt: document.signedAt
  });
});

app.post('/api/documents', requireOwner, (request, response) => {
  const owner = request.owner!;
  const body = request.body as Partial<SigningDocument> & { expiresInHours?: number };
  const requiredFields = ['title', 'fileName', 'fileType', 'fileDataUrl', 'signerName', 'signerEmail'] as const;
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

  if (!entitlement.active) {
    response.status(402).json({
      error: 'An active Forg3 subscription is required before creating signing links.',
      entitlement
    });
    return;
  }

  const expiresInHours = clamp(Number(body.expiresInHours || 72), 1, 24 * 30);
  const token = generateToken();
  const now = new Date();
  const document: SigningDocument = {
    id: crypto.randomUUID(),
    title: String(body.title).trim(),
    fileName: String(body.fileName),
    fileType: String(body.fileType),
    fileDataUrl: String(body.fileDataUrl),
    documentHash: sha256DataUrl(String(body.fileDataUrl)),
    ownerName: owner.name || owner.email,
    ownerEmail: owner.email,
    signerName: String(body.signerName).trim(),
    signerEmail: String(body.signerEmail).trim(),
    authProvider: normalizeProvider(body.authProvider),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString(),
    status: 'sent',
    tokenHash: hashToken(token)
  };

  store.create(document);
  response.status(201).json({ document: toSummary(document), signingPath: `/sign/${token}` });
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

  const token = generateToken();
  const expiresInHours = clamp(Number(request.body?.expiresInHours || 72), 1, 24 * 30);
  const next = store.update(document.id, (current) => ({
    ...current,
    expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
    tokenHash: hashToken(token)
  }));

  response.json({ document: toSummary(next!), signingPath: `/sign/${token}` });
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
    voidedAt: new Date().toISOString()
  }));

  response.json({ document: toSummary(next!) });
});

app.get('/api/signing/:token', (request, response) => {
  const document = getValidDocumentForToken(request.params.token, response);

  if (!document) {
    return;
  }

  response.json({
    document: {
      id: document.id,
      title: document.title,
      fileName: document.fileName,
      documentHash: document.documentHash,
      signerName: document.signerName,
      signerEmail: document.signerEmail,
      ownerName: document.ownerName,
      expiresAt: document.expiresAt
    },
    fileDataUrl: document.fileDataUrl
  });
});

app.post('/api/signing/:token/sign', async (request, response, next) => {
  const document = getValidDocumentForToken(request.params.token, response);

  if (!document) {
    return;
  }

  const signatureDataUrl = String(request.body?.signatureDataUrl || '');
  const signerNameConfirmation = String(request.body?.signerNameConfirmation || '').trim();
  const consentText = String(request.body?.consentText || '');

  if (!signatureDataUrl.startsWith('data:image/png;base64,')) {
    response.status(400).json({ error: 'A PNG signature image is required.' });
    return;
  }

  if (normalizeLooseName(signerNameConfirmation) !== normalizeLooseName(document.signerName)) {
    response.status(400).json({ error: 'Signer name confirmation must match the assigned signer.' });
    return;
  }

  const signedAt = new Date().toISOString();

  if (!canCompleteSignature(document, response)) {
    return;
  }

  try {
    const signedFileDataUrl = await sealPdfWithSignature({
      fileDataUrl: document.fileDataUrl,
      signatureDataUrl,
      title: document.title,
      signerName: document.signerName,
      signerEmail: document.signerEmail,
      documentHash: document.documentHash,
      signedAt
    });
    const signedDocumentHash = sha256DataUrl(signedFileDataUrl);
    const signedDocument = store.update(document.id, (current) => ({
      ...current,
      status: 'signed',
      signedAt,
      signedFileDataUrl,
      signatureDataUrl,
      signerNameConfirmation,
      signedDocumentHash,
      consentText,
      tokenHash: null
    }));

    recordSignatureUsage(signedDocument!);

    response.json({
      document: toSummary(signedDocument!),
      fileName: signedFileName(document.fileName),
      signedFileDataUrl,
      signedDocumentHash
    });
  } catch (error) {
    next(error);
  }
});

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

app.listen(port, '127.0.0.1', () => {
  console.log(`Forg3 Sign API listening at http://127.0.0.1:${port}`);
});

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

function getValidDocumentForToken(token: string, response: Response): SigningDocument | undefined {
  const tokenHash = hashToken(token);
  const document = store.findByTokenHash(tokenHash);

  if (!document) {
    response.status(404).json({ error: 'This signing link is invalid or already sealed.' });
    return undefined;
  }

  if (document.status !== 'sent') {
    response.status(410).json({ error: 'This signing link is no longer active.' });
    return undefined;
  }

  if (isExpired(document)) {
    response.status(410).json({ error: 'This signing link has expired.' });
    return undefined;
  }

  return document;
}

function toSummary(document: SigningDocument): DocumentSummary {
  return {
    id: document.id,
    title: document.title,
    fileName: document.fileName,
    documentHash: document.documentHash,
    ownerName: document.ownerName,
    ownerEmail: document.ownerEmail,
    signerName: document.signerName,
    signerEmail: document.signerEmail,
    authProvider: document.authProvider,
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
    status: document.status === 'sent' && isExpired(document) ? 'expired' : document.status,
    signedAt: document.signedAt,
    signedDocumentHash: document.signedDocumentHash,
    linkAvailable: Boolean(document.tokenHash && document.status === 'sent' && !isExpired(document))
  };
}

function getSubscriptionEntitlement(ownerEmail: string): SubscriptionEntitlement {
  const subscription = store.getSubscription(ownerEmail);
  const usageSummary = getUsageSummary(ownerEmail);

  if (!subscription) {
    return {
      active: false,
      status: 'inactive',
      plan: null,
      subscription: null,
      usageSummary,
      reason: 'No subscription is on file.'
    };
  }

  const plan = subscriptionPlans.find((currentPlan) => currentPlan.id === subscription.planId) || null;

  if (subscription.status !== 'active') {
    return {
      active: false,
      status: subscription.status,
      plan,
      subscription,
      usageSummary,
      reason: `Subscription is ${subscription.status}.`
    };
  }

  if (new Date(subscription.renewsAt).getTime() <= Date.now()) {
    return {
      active: false,
      status: 'past_due',
      plan,
      subscription: { ...subscription, status: 'past_due' },
      usageSummary,
      reason: 'Subscription renewal date has passed.'
    };
  }

  return {
    active: true,
    status: subscription.status,
    plan,
    subscription,
    usageSummary
  };
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
  if (provider === 'google' || provider === 'apple') {
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

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sameEmail(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
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
