import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface OwnerIdentity {
  uid: string;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      owner?: OwnerIdentity;
    }
  }
}

const devTokenPrefix = 'dev.';
const devTokenTtlSeconds = 12 * 60 * 60;

export function devAuthEnabled() {
  return process.env.NODE_ENV !== 'production';
}

export async function requireOwner(request: Request, response: Response, next: NextFunction) {
  const authHeader = request.get('authorization') || '';
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    response.status(401).json({ error: 'Authentication is required.' });
    return;
  }

  try {
    const owner = await verifyOwnerToken(token);
    request.owner = owner;
    next();
  } catch {
    response.status(401).json({ error: 'Authentication is required.' });
  }
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

async function verifyOwnerToken(token: string): Promise<OwnerIdentity> {
  if (devAuthEnabled() && token.startsWith(devTokenPrefix)) {
    return verifyDevAuthToken(token);
  }

  const decoded = await getFirebaseVerifier().verifyIdToken(token);
  const email = decoded.email?.trim().toLowerCase();

  if (!email) {
    throw new Error('Verified token is missing an email.');
  }

  return {
    uid: decoded.uid,
    email,
    name: decoded.name || email
  };
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

function getDevAuthSecret() {
  return process.env.DEV_AUTH_SECRET || 'forg3-local-dev-secret';
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
