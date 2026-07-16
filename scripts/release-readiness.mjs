import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';

const env = loadEnvFiles(['.env', '.env.local', '.env.production', '.env.production.local']);
const baseUrl = (process.env.FORG3_MONITOR_URL || env.PUBLIC_SIGNING_BASE_URL || 'https://forg3.nak3deye.com').replace(/\/$/, '');
const checks = [];
const requiredGoogleSubscriptions = [
  { productId: 'forg3_pro_monthly', basePlanId: 'monthly' },
  { productId: 'forg3_business_monthly', basePlanId: 'monthly' }
];

await check('mobile release assets', () => {
  const result = spawnSync('node', ['scripts/verify-mobile-release-assets.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, RELEASE_API_BASE_URL: baseUrl },
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || 'mobile asset verification failed');
  }
});

await check('public DNS', async () => {
  const hostname = new URL(baseUrl).hostname;
  const addresses = await dns.resolve4(hostname);
  if (!addresses.length) {
    throw new Error(`${hostname} has no A record`);
  }
});

await check('public health endpoint', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true || body.service !== 'forg3') {
    throw new Error(`/api/health returned ${response.status}`);
  }
});

checkEnvGroup('production core secrets', ['APP_AUTH_SECRET', 'DEVICE_TRUST_SECRET', 'FORG3_OBJECT_ENCRYPTION_KEY']);
checkEnvGroup('production persistence', ['DATABASE_URL', 'PUBLIC_SIGNING_BASE_URL']);
checkOneOf('email delivery provider', [
  ['EMAIL_PROVIDER', 'MICROSOFT_GRAPH_TENANT_ID', 'MICROSOFT_GRAPH_CLIENT_ID', 'MICROSOFT_GRAPH_CLIENT_SECRET', 'MICROSOFT_GRAPH_SENDER'],
  ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'FORG3_EMAIL_FROM']
]);
checkOneOf('Apple/Google sign-in client config', [
  ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'],
  ['FIREBASE_WEB_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_WEB_APP_ID']
]);
checkOneOf('Firebase Admin token verification', [
  ['FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT_JSON'],
  ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'],
  ['FIREBASE_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS']
]);
checkOneOf('Apple store billing', [
  [
    'APPLE_APP_STORE_ISSUER_ID',
    'APPLE_APP_STORE_KEY_ID',
    'APPLE_APP_STORE_PRIVATE_KEY_BASE64',
    'APPLE_APP_STORE_BUNDLE_ID'
  ],
  [
    'APPLE_APP_STORE_ISSUER_ID',
    'APPLE_APP_STORE_KEY_ID',
    'APPLE_APP_STORE_PRIVATE_KEY',
    'APPLE_APP_STORE_BUNDLE_ID'
  ],
  [
    'APPLE_APP_STORE_ISSUER_ID',
    'APPLE_APP_STORE_KEY_ID',
    'APPLE_APP_STORE_PRIVATE_KEY_FILE',
    'APPLE_APP_STORE_BUNDLE_ID'
  ],
  [
    'APPLE_APP_STORE_ISSUER_ID',
    'APPLE_APP_STORE_KEY_ID',
    'APPLE_APP_STORE_PRIVATE_KEY_PATH',
    'APPLE_APP_STORE_BUNDLE_ID'
  ]
]);
checkOneOf('Google Play billing', [
  ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64'],
  ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_APPLICATION_CREDENTIALS']
]);
if (readEnv('GOOGLE_PLAY_PACKAGE_NAME') && readGoogleServiceAccount()) {
  await check('Google Play Developer API access/products', async () => {
    const packageName = readEnv('GOOGLE_PLAY_PACKAGE_NAME');
    const accessToken = await getGooglePlayAccessToken();
    const response = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
        packageName
      )}/subscriptions`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error?.message || `Android Publisher API returned ${response.status}`);
    }

    const subscriptions = new Map((payload.subscriptions || []).map((subscription) => [subscription.productId, subscription]));
    const missing = [];
    for (const required of requiredGoogleSubscriptions) {
      const subscription = subscriptions.get(required.productId);
      const basePlan = subscription?.basePlans?.find((candidate) => candidate.basePlanId === required.basePlanId);
      if (basePlan?.state !== 'ACTIVE') {
        missing.push(`${required.productId}/${required.basePlanId}`);
      }
    }

    if (missing.length) {
      throw new Error(`missing active Google Play products: ${missing.join(', ')}`);
    }
  });
}
checkEnvGroup('Google RTDN webhook protection', ['GOOGLE_RTDN_VERIFICATION_TOKEN']);

const failed = checks.filter((checkResult) => checkResult.status === 'fail');
const pending = checks.filter((checkResult) => checkResult.status === 'pending');

for (const checkResult of checks) {
  const marker = checkResult.status === 'pass' ? 'ok' : checkResult.status === 'pending' ? 'pending' : 'fail';
  console.log(`${marker} - ${checkResult.name}${checkResult.detail ? `: ${checkResult.detail}` : ''}`);
}

if (failed.length || pending.length) {
  process.exit(1);
}

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, status: 'pass' });
  } catch (error) {
    checks.push({ name, status: 'fail', detail: error instanceof Error ? error.message : String(error) });
  }
}

function checkEnvGroup(name, keys) {
  const missing = keys.filter((key) => !readEnv(key));
  checks.push({
    name,
    status: missing.length ? 'pending' : 'pass',
    detail: missing.length ? `missing ${missing.join(', ')}` : ''
  });
}

function checkOneOf(name, alternatives) {
  const satisfied = alternatives.some((keys) => keys.every((key) => readEnv(key)));
  checks.push({
    name,
    status: satisfied ? 'pass' : 'pending',
    detail: satisfied ? '' : `missing one complete option: ${alternatives.map((keys) => keys.join('+')).join(' OR ')}`
  });
}

function readEnv(key) {
  return process.env[key] || env[key] || '';
}

function readGoogleServiceAccount() {
  const rawJson = readEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
  if (rawJson) {
    return JSON.parse(rawJson);
  }

  const rawBase64 = readEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64');
  if (rawBase64) {
    return JSON.parse(Buffer.from(rawBase64, 'base64').toString('utf8'));
  }

  const credentialsPath = readEnv('GOOGLE_APPLICATION_CREDENTIALS');
  if (credentialsPath && fs.existsSync(credentialsPath)) {
    return JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  }

  return null;
}

async function getGooglePlayAccessToken() {
  const serviceAccount = readGoogleServiceAccount();
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error('Google Play service account JSON is missing client_email or private_key.');
  }

  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = encodeBase64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const encodedPayload = encodeBase64UrlJson({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  });
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(serviceAccount.private_key, 'base64url');
  const tokenResponse = await fetch(serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));

  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(tokenPayload.error_description || tokenPayload.error || `Google OAuth returned ${tokenResponse.status}`);
  }

  return tokenPayload.access_token;
}

function encodeBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function loadEnvFiles(files) {
  const output = {};
  for (const file of files) {
    if (!fs.existsSync(file)) {
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) {
        continue;
      }
      const [, key, rawValue] = match;
      output[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }
  return output;
}
