import crypto from 'node:crypto';
import fs from 'node:fs';

const env = loadEnvFiles(['.env', '.env.local', '.env.production', '.env.production.local']);
const packageName = readEnv('GOOGLE_PLAY_PACKAGE_NAME') || 'com.forg3.sign';
const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
const track = process.env.GOOGLE_PLAY_TRACK || process.argv[2] || 'alpha';
const versionCode = String(process.env.GOOGLE_PLAY_VERSION_CODE || process.argv[3] || '').trim();
const releaseStatus = process.env.GOOGLE_PLAY_RELEASE_STATUS || 'draft';
const mode = process.env.GOOGLE_PLAY_TRACK_MODE || process.argv[4] || 'validate';
const releaseName = process.env.GOOGLE_PLAY_RELEASE_NAME || `Forg3 1.0 (${versionCode}) closed testing`;
const releaseNotes =
  process.env.GOOGLE_PLAY_RELEASE_NOTES ||
  'Forg3 1.0 closed testing build for production-access testing, signup, 2FA, document signing, and billing verification.';
const testerGroups = readList('GOOGLE_PLAY_TESTER_GROUPS');
const allowEmptyTesters = readBool('GOOGLE_PLAY_ALLOW_EMPTY_TESTERS', false);

if (!versionCode) {
  throw new Error('Set GOOGLE_PLAY_VERSION_CODE or pass a version code argument.');
}

if (!['draft', 'inProgress', 'halted', 'completed'].includes(releaseStatus)) {
  throw new Error(`Unsupported GOOGLE_PLAY_RELEASE_STATUS: ${releaseStatus}`);
}

if (!['validate', 'commit'].includes(mode)) {
  throw new Error(`Unsupported GOOGLE_PLAY_TRACK_MODE: ${mode}. Use validate or commit.`);
}

if (
  mode === 'commit' &&
  ['alpha', 'beta'].includes(track) &&
  testerGroups.length === 0 &&
  !allowEmptyTesters
) {
  throw new Error(
    `Refusing to commit ${track} release with no GOOGLE_PLAY_TESTER_GROUPS. ` +
      'Set GOOGLE_PLAY_TESTER_GROUPS to a Google Group email, or set GOOGLE_PLAY_ALLOW_EMPTY_TESTERS=1 only after selecting tester lists in Play Console.'
  );
}

const accessToken = await getGooglePlayAccessToken();
const edit = await googleApi(`${baseUrl}/edits`, {
  method: 'POST',
  body: {}
});
const editId = edit.id;

try {
  if (testerGroups.length) {
    await googleApi(`${baseUrl}/edits/${encodeURIComponent(editId)}/testers/${encodeURIComponent(track)}`, {
      method: 'PUT',
      body: {
        googleGroups: testerGroups
      }
    });
  }

  await googleApi(`${baseUrl}/edits/${encodeURIComponent(editId)}/tracks/${encodeURIComponent(track)}`, {
    method: 'PUT',
    body: {
      track,
      releases: [
        {
          name: releaseName,
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

  const result =
    mode === 'commit'
      ? await commitEdit(editId)
      : await googleApi(`${baseUrl}/edits/${encodeURIComponent(editId)}:validate`, { method: 'POST', body: {} });

  console.log(
    JSON.stringify(
      {
        packageName,
        track,
        versionCode,
        releaseStatus,
        testerGroups,
        allowEmptyTesters,
        mode,
        committed: mode === 'commit',
        editId: result.id || editId
      },
      null,
      2
    )
  );
} catch (error) {
  await googleApi(`${baseUrl}/edits/${encodeURIComponent(editId)}`, { method: 'DELETE', allowEmpty: true }).catch(() => {});
  throw error;
}

async function commitEdit(editId) {
  const commitUrl = new URL(`${baseUrl}/edits/${encodeURIComponent(editId)}:commit`);
  commitUrl.searchParams.set('changesInReviewBehavior', 'ERROR_IF_IN_REVIEW');
  return googleApi(commitUrl, { method: 'POST' });
}

async function googleApi(url, options = {}) {
  const response = await fetch(String(url), {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
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

function readList(key) {
  const value = readEnv(key);
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readBool(key, defaultValue = false) {
  const value = readEnv(key);
  if (!value) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
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
