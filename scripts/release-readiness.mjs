import { spawnSync } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';

const env = loadEnvFiles(['.env.production', '.env.local', '.env']);
const baseUrl = (process.env.FORG3_MONITOR_URL || env.PUBLIC_SIGNING_BASE_URL || 'https://forg3.nak3deye.com').replace(/\/$/, '');
const checks = [];

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
checkEnvGroup('Apple store billing', [
  'APPLE_APP_STORE_ISSUER_ID',
  'APPLE_APP_STORE_KEY_ID',
  'APPLE_APP_STORE_PRIVATE_KEY_BASE64',
  'APPLE_APP_STORE_BUNDLE_ID'
]);
checkOneOf('Google Play billing', [
  ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64'],
  ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_APPLICATION_CREDENTIALS']
]);
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
