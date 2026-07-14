import type { AuthProvider, AuthSession } from './types';

const sessionKey = 'forg3.auth.session.v1';
const deviceKey = 'forg3.auth.device.v1';
const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const tokenRefreshWindowMs = 5 * 60 * 1000;

function readStorage(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) || null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Native WebViews can temporarily deny storage during startup. Auth retries from a clean state.
  }
}

function removeStorage(key: string) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Nothing to clear when the storage backend is unavailable.
  }
}

export interface DeviceSecurityStatus {
  trusted: boolean;
  required: boolean;
  expiresAt?: string;
  deviceName?: string;
  reason?: string;
}

export interface DeviceVerificationStart {
  challengeId?: string;
  expiresAt?: string;
  deliveryStatus?: string;
  deliveryProvider?: string;
  trusted?: boolean;
  devCode?: string;
}

export interface EmailSignInStart {
  challengeId: string;
  expiresAt: string;
  deliveryStatus?: string;
  deliveryProvider?: string;
  devCode?: string;
}

export class AuthApiError extends Error {
  totpRequired: boolean;

  constructor(message: string, totpRequired = false) {
    super(message);
    this.name = 'AuthApiError';
    this.totpRequired = totpRequired;
  }
}

export function getStoredSession(): AuthSession | null {
  const raw = readStorage(sessionKey);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    removeStorage(sessionKey);
    return null;
  }
}

export function clearStoredSession() {
  removeStorage(sessionKey);
}

export function getDeviceId() {
  const existing = readStorage(deviceKey);

  if (existing) {
    return existing;
  }

  const next = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeStorage(deviceKey, next);
  return next;
}

export function getDeviceName() {
  const platform = navigator.platform || 'device';
  const userAgent = navigator.userAgent.includes('Mobile') ? 'mobile browser' : 'browser';
  return `${userAgent} on ${platform}`;
}

export function firebaseConfigured() {
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY &&
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
      import.meta.env.VITE_FIREBASE_PROJECT_ID &&
      import.meta.env.VITE_FIREBASE_APP_ID
  );
}

export async function getAuthToken() {
  const session = getStoredSession();

  if (!session) {
    return null;
  }

  if (session.idToken && session.expiresAt && session.expiresAt - tokenRefreshWindowMs > Date.now()) {
    return session.idToken;
  }

  if (session.mode === 'firebase' && firebaseConfigured()) {
    const auth = await getFirebaseAuth();
    const user = auth.currentUser || (await waitForFirebaseUser(auth));

    if (!user) {
      clearStoredSession();
      return null;
    }

    const idToken = await user.getIdToken(true);
    const tokenResult = await user.getIdTokenResult();
    const refreshedSession = {
      ...session,
      idToken,
      expiresAt: new Date(tokenResult.expirationTime).getTime()
    };
    writeStorage(sessionKey, JSON.stringify(refreshedSession));
    return idToken;
  }

  if (session.mode === 'demo' && session.provider === 'email') {
    clearStoredSession();
    return null;
  }

  if (session.mode === 'demo' && import.meta.env.DEV) {
    const refreshedSession = await createDevSession(session.provider as 'google' | 'apple', session);
    writeStorage(sessionKey, JSON.stringify(refreshedSession));
    return refreshedSession.idToken || null;
  }

  clearStoredSession();
  return null;
}

export async function signIn(provider: 'google' | 'apple'): Promise<AuthSession> {
  if (firebaseConfigured()) {
    const auth = await getFirebaseAuth();
    const authModule = await import('firebase/auth');
    const authProvider =
      provider === 'google'
        ? new authModule.GoogleAuthProvider()
        : new authModule.OAuthProvider('apple.com');
    const credential = await authModule.signInWithPopup(auth, authProvider);
    const user = credential.user;
    const idToken = await user.getIdToken();
    const tokenResult = await user.getIdTokenResult();
    const session: AuthSession = {
      provider,
      mode: 'firebase',
      uid: user.uid,
      name: user.displayName || user.email || `${provider} user`,
      email: user.email || '',
      idToken,
      expiresAt: new Date(tokenResult.expirationTime).getTime()
    };
    writeStorage(sessionKey, JSON.stringify(session));
    return session;
  }

  if (!import.meta.env.DEV) {
    throw new Error('Firebase authentication is required in production builds.');
  }

  const session = await createDevSession(provider);
  writeStorage(sessionKey, JSON.stringify(session));
  return session;
}

export async function startEmailSignIn(email: string, name?: string): Promise<EmailSignInStart> {
  return publicAuthRequest<EmailSignInStart>('/api/auth/email/start', {
    method: 'POST',
    body: JSON.stringify({ email, name, deviceName: getDeviceName() })
  });
}

export async function verifyEmailSignIn(input: {
  email: string;
  name?: string;
  challengeId: string;
  code: string;
  totpCode?: string;
}): Promise<AuthSession> {
  const payload = await publicAuthRequest<{
    owner?: { uid: string; email: string; name: string };
    token?: string;
    error?: string;
  }>('/api/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify({ ...input, deviceName: getDeviceName() })
  });

  if (!payload.owner || !payload.token) {
    throw new Error(payload.error || 'Email login failed.');
  }

  const session: AuthSession = {
    provider: 'email',
    mode: 'demo',
    uid: payload.owner.uid,
    name: payload.owner.name,
    email: payload.owner.email,
    idToken: payload.token,
    expiresAt: Date.now() + 11 * 60 * 60 * 1000
  };
  writeStorage(sessionKey, JSON.stringify(session));
  return session;
}

export async function checkDeviceSecurity(): Promise<DeviceSecurityStatus> {
  return authRequest<DeviceSecurityStatus>('/api/auth/device');
}

export async function startDeviceVerification(): Promise<DeviceVerificationStart> {
  return authRequest<DeviceVerificationStart>('/api/auth/mfa/start', {
    method: 'POST',
    body: JSON.stringify({ deviceName: getDeviceName() })
  });
}

export async function verifyDeviceCode(challengeId: string, code: string): Promise<DeviceSecurityStatus> {
  return authRequest<DeviceSecurityStatus>('/api/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, code, deviceName: getDeviceName() })
  });
}

async function getFirebaseAuth() {
  const [{ initializeApp, getApps }, authModule] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth')
  ]);
  const app =
    getApps()[0] ||
    initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID
    });

  return authModule.getAuth(app);
}

async function waitForFirebaseUser(auth: Awaited<ReturnType<typeof getFirebaseAuth>>) {
  const authModule = await import('firebase/auth');

  return new Promise<import('firebase/auth').User | null>((resolve) => {
    const unsubscribe = authModule.onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

async function createDevSession(provider: 'google' | 'apple', existing?: AuthSession): Promise<AuthSession> {
  const devEmail = existing?.email || import.meta.env.VITE_DEV_OWNER_EMAIL || '';
  const devName = existing?.name || import.meta.env.VITE_DEV_OWNER_NAME || '';
  const response = await fetch(`${apiBase}/api/dev-auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      uid: existing?.uid,
      email: devEmail,
      name: devName
    })
  });
  const payload = (await response.json().catch(() => ({}))) as {
    owner?: { uid: string; email: string; name: string };
    token?: string;
    error?: string;
  };

  if (!response.ok || !payload.owner || !payload.token) {
    throw new Error(payload.error || 'Development authentication is unavailable.');
  }

  return {
    provider,
    mode: 'demo',
    uid: payload.owner.uid,
    name: payload.owner.name,
    email: payload.owner.email,
    idToken: payload.token,
    expiresAt: Date.now() + 11 * 60 * 60 * 1000
  };
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Forg3-Device-Id': getDeviceId(),
      'X-Forg3-Device-Name': getDeviceName(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    }
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

async function publicAuthRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Forg3-Device-Id': getDeviceId(),
      'X-Forg3-Device-Name': getDeviceName(),
      ...(init.headers || {})
    }
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; totpRequired?: boolean };

  if (!response.ok) {
    throw new AuthApiError(
      payload.error || `Request failed with status ${response.status}`,
      Boolean(payload.totpRequired)
    );
  }

  return payload;
}
