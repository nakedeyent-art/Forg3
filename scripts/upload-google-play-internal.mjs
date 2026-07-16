import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const env = loadEnvFiles(['.env', '.env.local', '.env.production', '.env.production.local']);
const packageName = readEnv('GOOGLE_PLAY_PACKAGE_NAME') || 'com.forg3.sign';
const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
const uploadBaseUrl = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${encodeURIComponent(
  packageName
)}`;
const track = process.env.GOOGLE_PLAY_TRACK || 'internal';
const releaseStatus = process.env.GOOGLE_PLAY_RELEASE_STATUS || 'completed';
const releaseNotes =
  process.env.GOOGLE_PLAY_RELEASE_NOTES ||
  'Forg3 1.0 internal testing build for signup, 2FA, PDF signing, and billing verification.';
const aabPath = resolveAabPath(process.argv[2]);

if (!['draft', 'inProgress', 'halted', 'completed'].includes(releaseStatus)) {
  throw new Error(`Unsupported GOOGLE_PLAY_RELEASE_STATUS: ${releaseStatus}`);
}

const accessToken = await getGooglePlayAccessToken();
const edit = await googleApi(`${baseUrl}/edits`, {
  method: 'POST',
  body: {}
});
const editId = edit.id;

try {
  const bundle = await uploadBundle(editId, aabPath);
  const versionCode = String(bundle.versionCode || '');
  if (!versionCode) {
    throw new Error('Google Play did not return a bundle versionCode.');
  }

  await googleApi(`${baseUrl}/edits/${encodeURIComponent(editId)}/tracks/${encodeURIComponent(track)}`, {
    method: 'PUT',
    body: {
      track,
      releases: [
        {
          name: `Forg3 1.0 (${versionCode})`,
          versionCodes: [versionCode],
          status: releaseStatus,
          releaseNotes: [
            {
              language: 'en-US',
              text: releaseNotes
            }
          ]
        }
      ]
    }
  });

  const commitUrl = new URL(`${baseUrl}/edits/${encodeURIComponent(editId)}:commit`);
  commitUrl.searchParams.set('changesInReviewBehavior', 'ERROR_IF_IN_REVIEW');
  const committed = await googleApi(commitUrl, { method: 'POST' });

  console.log(
    JSON.stringify(
      {
        packageName,
        track,
        releaseStatus,
        aabPath,
        versionCode,
        editId: committed.id || editId
      },
      null,
      2
    )
  );
} catch (error) {
  await googleApi(`${baseUrl}/edits/${encodeURIComponent(editId)}`, { method: 'DELETE', allowEmpty: true }).catch(() => {});
  throw error;
}

async function uploadBundle(editId, filePath) {
  const bytes = fs.readFileSync(filePath);
  const url = new URL(`${uploadBaseUrl}/edits/${encodeURIComponent(editId)}/bundles`);
  url.searchParams.set('uploadType', 'media');
  return googleApi(url, {
    method: 'POST',
    body: bytes,
    contentType: 'application/octet-stream'
  });
}

async function googleApi(url, options = {}) {
  const response = await fetch(String(url), {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': options.contentType || 'application/json' } : {})
    },
    body: options.body
      ? Buffer.isBuffer(options.body)
        ? options.body
        : JSON.stringify(options.body)
      : undefined
  });

  if (response.status === 204 && options.allowEmpty) {
    return {};
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Google Play API returned ${response.status}.`);
  }

  return payload;
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
    throw new Error(tokenPayload.error_description || tokenPayload.error || `Google OAuth returned ${tokenResponse.status}.`);
  }

  return tokenPayload.access_token;
}

function resolveAabPath(inputPath) {
  if (inputPath) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`AAB not found: ${inputPath}`);
    }
    return inputPath;
  }

  const mobileDir = '.deploy/mobile';
  const candidates = fs
    .readdirSync(mobileDir)
    .filter((file) => file.endsWith('.aab'))
    .map((file) => path.join(mobileDir, file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!candidates.length) {
    throw new Error(`No .aab files found under ${mobileDir}.`);
  }

  return candidates[0].file;
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

function encodeBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
