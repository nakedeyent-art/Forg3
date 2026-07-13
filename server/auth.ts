import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface OwnerIdentity {
  uid: string;
  email: string;
  name: string;
}

type DeviceTrustVerifier = (owner: OwnerIdentity, request: Request) => boolean | Promise<boolean>;
type SessionVerifier = (ownerEmail: string, sessionId: string) => boolean;

declare global {
  namespace Express {
    interface Request {
      owner?: OwnerIdentity;
      sessionId?: string;
    }
  }
}

const devTokenPrefix = 'dev.';
const emailTokenPrefix = 'email.';
const devTokenTtlSeconds = 12 * 60 * 60;
let deviceTrustVerifier: DeviceTrustVerifier | null = null;
let sessionVerifier: SessionVerifier | null = null;

export function devAuthEnabled() {
  return process.env.NODE_ENV !== 'production';
}

export function configureDeviceTrustVerifier(verifier: DeviceTrustVerifier) {
  deviceTrustVerifier = verifier;
}

export function configureSessionVerifier(verifier: SessionVerifier) {
  sessionVerifier = verifier;
}

export async function requirePrimaryOwner(request: Request, response: Response, next: NextFunction) {
  const authHeader = request.get('authorization') || '';
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    response.status(401).json({ error: 'Authentication is required.' });
    return;
  }

  try {
    const verified = await verifyOwnerToken(token);
    if (verified.sessionId && sessionVerifier && !sessionVerifier(verified.owner.email, verified.sessionId)) {
      response.status(401).json({ error: 'This session has been signed out. Log in again.' });
      return;
    }

    request.owner = verified.owner;
    request.sessionId = verified.sessionId;
    next();
  } catch {
    response.status(401).json({ error: 'Authentication is required.' });
  }
}

export async function requireOwner(request: Request, response: Response, next: NextFunction) {
  await requirePrimaryOwner(request, response, async () => {
    if (!request.owner) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    if (deviceTrustVerifier && !(await deviceTrustVerifier(request.owner, request))) {
      response.status(403).json({
        code: 'mfa_required',
        error: 'Two-factor verification is required on this device.'
      });
      return;
    }

    next();
  });
}

export function createDevAuthToken(owner: OwnerIdentity) {
  if (!devAuthEnabled()) {
    throw new Error('Development auth is disabled.');
  }

  const payload = encodeJson({
    uid: owner.uid,
    email: owner.email,
    name: owner.name,
    exp: Math.floor(Date.now() / 1000) + devTokenTtlSeconds
  });
  const signature = signDevPayload(payload);

  return `${devTokenPrefix}${payload}.${signature}`;
}

export function createEmailAuthToken(owner: OwnerIdentity, sessionId?: string) {
  const payload = encodeJson({
    uid: owner.uid,
    email: owner.email,
    name: owner.name,
    exp: Math.floor(Date.now() / 1000) + devTokenTtlSeconds,
    typ: 'email',
    sid: sessionId
  });
  const signature = signAppPayload(payload);

  return `${emailTokenPrefix}${payload}.${signature}`;
}

export function getEmailAuthTokenTtlSeconds() {
  return devTokenTtlSeconds;
}

async function verifyOwnerToken(token: string): Promise<{ owner: OwnerIdentity; sessionId?: string }> {
  if (devAuthEnabled() && token.startsWith(devTokenPrefix)) {
    return { owner: verifyDevAuthToken(token) };
  }

  if (token.startsWith(emailTokenPrefix)) {
    return verifyEmailAuthToken(token);
  }

  const decoded = await getFirebaseVerifier().verifyIdToken(token);
  const email = decoded.email?.trim().toLowerCase();

  if (!email) {
    throw new Error('Verified token is missing an email.');
  }

  return {
    owner: {
      uid: decoded.uid,
      email,
      name: decoded.name || email
    }
  };
}

function verifyEmailAuthToken(token: string): { owner: OwnerIdentity; sessionId?: string } {
  const parts = token.slice(emailTokenPrefix.length).split('.');

  if (parts.length !== 2) {
    throw new Error('Invalid email token.');
  }

  const [payload, signature] = parts;
  const expectedSignature = signAppPayload(payload);

  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new Error('Invalid email token signature.');
  }

  const parsed = decodeJson(payload);
  const exp = Number(parsed.exp || 0);
  const email = String(parsed.email || '').trim().toLowerCase();
  const uid = String(parsed.uid || '').trim();
  const name = String(parsed.name || email).trim();
  const sessionId = String(parsed.sid || '').trim() || undefined;

  if (parsed.typ !== 'email' || !uid || !email || exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Expired or incomplete email token.');
  }

  return { owner: { uid, email, name: name || email }, sessionId };
}

function verifyDevAuthToken(token: string): OwnerIdentity {
  const parts = token.slice(devTokenPrefix.length).split('.');

  if (parts.length !== 2) {
    throw new Error('Invalid development token.');
  }

  const [payload, signature] = parts;
  const expectedSignature = signDevPayload(payload);

  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new Error('Invalid development token signature.');
  }

  const parsed = decodeJson(payload);
  const exp = Number(parsed.exp || 0);
  const email = String(parsed.email || '').trim().toLowerCase();
  const uid = String(parsed.uid || '').trim();
  const name = String(parsed.name || email).trim();

  if (!uid || !email || exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Expired or incomplete development token.');
  }

  return { uid, email, name: name || email };
}

function getFirebaseVerifier() {
  if (!getApps().length) {
    initializeApp({ credential: getFirebaseCredential(), projectId: process.env.FIREBASE_PROJECT_ID });
  }

  return getAuth();
}

function getFirebaseCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    });
  }

  return applicationDefault();
}

function signDevPayload(payload: string) {
  return crypto.createHmac('sha256', getDevAuthSecret()).update(payload).digest('base64url');
}

function signAppPayload(payload: string) {
  return crypto.createHmac('sha256', getAppAuthSecret()).update(payload).digest('base64url');
}

function getDevAuthSecret() {
  return process.env.DEV_AUTH_SECRET || 'forg3-local-dev-secret';
}

function getAppAuthSecret() {
  return process.env.APP_AUTH_SECRET || process.env.DEVICE_TRUST_SECRET || process.env.DEV_AUTH_SECRET || 'forg3-local-app-auth-secret';
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(payload: string) {
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
