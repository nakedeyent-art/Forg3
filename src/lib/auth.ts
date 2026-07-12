import type { AuthProvider, AuthSession } from './types';

const sessionKey = 'forg3.auth.session.v1';
const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const tokenRefreshWindowMs = 5 * 60 * 1000;

export function getStoredSession(): AuthSession | null {
  const raw = localStorage.getItem(sessionKey);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    localStorage.removeItem(sessionKey);
    return null;
  }
}

export function clearStoredSession() {
  localStorage.removeItem(sessionKey);
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
    localStorage.setItem(sessionKey, JSON.stringify(refreshedSession));
    return idToken;
  }

  if (session.mode === 'demo' && import.meta.env.DEV) {
    const refreshedSession = await createDevSession(session.provider as Exclude<AuthProvider, 'demo'>, session);
    localStorage.setItem(sessionKey, JSON.stringify(refreshedSession));
    return refreshedSession.idToken || null;
  }

  clearStoredSession();
  return null;
}

export async function signIn(provider: Exclude<AuthProvider, 'demo'>): Promise<AuthSession> {
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
    localStorage.setItem(sessionKey, JSON.stringify(session));
    return session;
  }

  if (!import.meta.env.DEV) {
    throw new Error('Firebase authentication is required in production builds.');
  }

  const session = await createDevSession(provider);
  localStorage.setItem(sessionKey, JSON.stringify(session));
  return session;
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

async function createDevSession(provider: Exclude<AuthProvider, 'demo'>, existing?: AuthSession): Promise<AuthSession> {
  const response = await fetch(`${apiBase}/api/dev-auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      uid: existing?.uid,
      email: existing?.email,
      name: existing?.name
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
