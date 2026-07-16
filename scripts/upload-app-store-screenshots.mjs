import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshotRoot = path.join(rootDir, '.deploy', 'store-screenshots');
const apiBase = 'https://api.appstoreconnect.apple.com';
const env = loadEnv();
const credential = loadCredential();
const targets = [
  {
    displayType: 'APP_IPHONE_67',
    folder: path.join(screenshotRoot, 'ios-iphone-6-9')
  },
  {
    displayType: 'APP_IPAD_PRO_3GEN_129',
    folder: path.join(screenshotRoot, 'ios-ipad-13')
  }
];

await main();

async function main() {
  const app = await getApp();
  const version = await getVersion(app.id);
  const localization = await getLocalization(version.id);
  const existingSets = await listScreenshotSets(localization.id);

  console.log(`Uploading App Store screenshots for ${app.attributes.name} ${version.attributes.versionString} (${localization.attributes.locale}).`);

  for (const target of targets) {
    const files = fs
      .readdirSync(target.folder)
      .filter((file) => file.endsWith('.png'))
      .sort()
      .map((file) => path.join(target.folder, file));

    if (!files.length) {
      throw new Error(`No screenshots found in ${path.relative(rootDir, target.folder)}.`);
    }

    if (files.length > 10) {
      throw new Error(`${target.displayType} has ${files.length} screenshots; App Store pages accept at most 10.`);
    }

    const set =
      existingSets.find((candidate) => candidate.attributes?.screenshotDisplayType === target.displayType) ||
      (await createScreenshotSet(localization.id, target.displayType));

    await clearScreenshotSet(set.id);

    for (const filePath of files) {
      await uploadScreenshot(set.id, filePath);
    }

    console.log(`${target.displayType}: uploaded ${files.length} screenshot${files.length === 1 ? '' : 's'}.`);
  }
}

async function getApp() {
  const bundleId = env.APPLE_APP_STORE_BUNDLE_ID || 'com.forg3.sign';
  const response = await api(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  const app = response.data?.[0];

  if (!app) {
    throw new Error(`App Store Connect app not found for bundle ${bundleId}.`);
  }

  return app;
}

async function getVersion(appId) {
  const response = await api(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=10`);
  const version = response.data?.find((candidate) => candidate.attributes?.versionString === '1.0') || response.data?.[0];

  if (!version) {
    throw new Error('No iOS App Store version found.');
  }

  return version;
}

async function getLocalization(versionId) {
  const response = await api(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=10`);
  const localization = response.data?.find((candidate) => candidate.attributes?.locale === 'en-US') || response.data?.[0];

  if (!localization) {
    throw new Error('No App Store version localization found.');
  }

  return localization;
}

async function listScreenshotSets(localizationId) {
  const response = await api(`/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=50`);
  return response.data || [];
}

async function createScreenshotSet(localizationId, displayType) {
  const response = await api('/v1/appScreenshotSets', {
    method: 'POST',
    body: {
      data: {
        type: 'appScreenshotSets',
        attributes: {
          screenshotDisplayType: displayType
        },
        relationships: {
          appStoreVersionLocalization: {
            data: {
              type: 'appStoreVersionLocalizations',
              id: localizationId
            }
          }
        }
      }
    }
  });

  return response.data;
}

async function clearScreenshotSet(setId) {
  const response = await api(`/v1/appScreenshotSets/${setId}/appScreenshots?limit=50`);

  for (const screenshot of response.data || []) {
    await api(`/v1/appScreenshots/${screenshot.id}`, { method: 'DELETE', expectJson: false });
  }
}

async function uploadScreenshot(setId, filePath) {
  const bytes = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const md5 = crypto.createHash('md5').update(bytes).digest('hex');
  const reservation = await api('/v1/appScreenshots', {
    method: 'POST',
    body: {
      data: {
        type: 'appScreenshots',
        attributes: {
          fileName,
          fileSize: bytes.length
        },
        relationships: {
          appScreenshotSet: {
            data: {
              type: 'appScreenshotSets',
              id: setId
            }
          }
        }
      }
    }
  });
  const screenshot = reservation.data;
  const operations = screenshot.attributes?.uploadOperations || [];

  if (!operations.length) {
    throw new Error(`No upload operations returned for ${fileName}.`);
  }

  for (const operation of operations) {
    const offset = Number(operation.offset || 0);
    const length = Number(operation.length || bytes.length);
    const chunk = bytes.subarray(offset, offset + length);
    const headers = {};

    for (const header of operation.requestHeaders || []) {
      headers[header.name] = header.value;
    }

    const response = await fetch(operation.url, {
      method: operation.method || 'PUT',
      headers,
      body: chunk
    });

    if (!response.ok) {
      throw new Error(`Uploading ${fileName} failed with ${response.status}.`);
    }
  }

  await api(`/v1/appScreenshots/${screenshot.id}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'appScreenshots',
        id: screenshot.id,
        attributes: {
          uploaded: true,
          sourceFileChecksum: md5
        }
      }
    }
  });
}

async function api(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${createJwt()}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let body = {};

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname} failed (${response.status}): ${JSON.stringify(body).slice(0, 700)}`);
  }

  return body;
}

function createJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: credential.keyId, typ: 'JWT' };
  const payload = {
    iss: credential.issuerId,
    aud: 'appstoreconnect-v1',
    iat: now,
    exp: now + 900
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto
    .sign('sha256', Buffer.from(signingInput), { key: credential.privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');

  return `${signingInput}.${signature}`;
}

function loadCredential() {
  const issuerId = env.APPLE_APP_STORE_ISSUER_ID;
  const keyId = env.APPLE_APP_STORE_KEY_ID;
  const inlineKey = env.APPLE_APP_STORE_PRIVATE_KEY || (
    env.APPLE_APP_STORE_PRIVATE_KEY_BASE64
      ? Buffer.from(env.APPLE_APP_STORE_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
      : ''
  );
  const keyFile = env.APPLE_APP_STORE_PRIVATE_KEY_FILE || env.APPLE_APP_STORE_PRIVATE_KEY_PATH || '';
  const privateKey = inlineKey || (keyFile ? fs.readFileSync(keyFile, 'utf8') : '');

  if (!issuerId || !keyId || !privateKey) {
    throw new Error('Set APPLE_APP_STORE_ISSUER_ID, APPLE_APP_STORE_KEY_ID, and an Apple private key source.');
  }

  return { issuerId, keyId, privateKey };
}

function loadEnv() {
  const result = { ...process.env };

  for (const file of ['.env.local', '.env']) {
    const envPath = path.join(rootDir, file);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const index = trimmed.indexOf('=');
      if (index <= 0) {
        continue;
      }
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
      result[key] = value;
    }
  }

  return result;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
