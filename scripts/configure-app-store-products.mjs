import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = 'https://api.appstoreconnect.apple.com';
const env = loadEnv();
const credential = loadCredential();
const mode = process.argv[2] || 'configure';
const reviewScreenshotPath = path.join(
  rootDir,
  '.deploy',
  'store-screenshots',
  'ios-iphone-6-9',
  '02-native-sender-plans.png'
);

const products = [
  {
    productId: 'com.forg3.sign.pro.monthly',
    displayName: 'Forg3 Pro',
    description: 'Secure e-signature sending for solo users.',
    usaPrice: '18.99'
  },
  {
    productId: 'com.forg3.sign.business.monthly',
    displayName: 'Forg3 Business',
    description: 'Highest-tier secure e-signature access.',
    usaPrice: '39.99'
  },
  {
    productId: 'com.forg3.sign.payper.yearly',
    displayName: 'Forg3 Pay Per Signature',
    description: 'Annual base access plus metered signatures.',
    usaPrice: '11.99'
  }
];

await main();

async function main() {
  const app = await getApp();
  const group = await getSubscriptionGroup(app.id);
  const subscriptions = await listSubscriptions(group.id);

  if (mode === 'status') {
    await printStatus(group.id);
    return;
  }

  if (mode !== 'configure') {
    throw new Error(`Unknown mode "${mode}". Use configure or status.`);
  }

  if (!fs.existsSync(reviewScreenshotPath)) {
    throw new Error(`Subscription review screenshot is missing at ${path.relative(rootDir, reviewScreenshotPath)}.`);
  }

  console.log(`Configuring App Store subscriptions for ${app.attributes.name} (${app.id}).`);

  await upsertGroupLocalization(group.id);

  for (const product of products) {
    const subscription = subscriptions.find((candidate) => candidate.attributes?.productId === product.productId);

    if (!subscription) {
      throw new Error(`Subscription product not found in App Store Connect: ${product.productId}`);
    }

    await updateSubscriptionReviewNote(subscription.id, product);
    await upsertLocalization(subscription.id, product);
    await setPrices(subscription.id, product.usaPrice);
    await replaceReviewScreenshot(subscription.id, reviewScreenshotPath);

    console.log(`${product.productId}: localization, USA price ${product.usaPrice}, and review screenshot configured.`);
  }

  await printStatus(group.id);
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

async function getSubscriptionGroup(appId) {
  const response = await api(`/v1/apps/${appId}/subscriptionGroups?limit=50`);
  const group =
    response.data?.find((candidate) => candidate.attributes?.referenceName === 'Forg3 Plans') || response.data?.[0];

  if (!group) {
    throw new Error('No App Store subscription group found.');
  }

  return group;
}

async function upsertGroupLocalization(groupId) {
  const existing = await api(`/v1/subscriptionGroups/${groupId}/subscriptionGroupLocalizations?limit=20`);
  const localization = existing.data?.find((candidate) => candidate.attributes?.locale === 'en-US');

  if (localization) {
    await api(`/v1/subscriptionGroupLocalizations/${localization.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'subscriptionGroupLocalizations',
          id: localization.id,
          attributes: {
            name: 'Forg3 Plans'
          }
        }
      }
    });
    return;
  }

  await api('/v1/subscriptionGroupLocalizations', {
    method: 'POST',
    body: {
      data: {
        type: 'subscriptionGroupLocalizations',
        attributes: {
          locale: 'en-US',
          name: 'Forg3 Plans'
        },
        relationships: {
          subscriptionGroup: {
            data: {
              type: 'subscriptionGroups',
              id: groupId
            }
          }
        }
      }
    }
  });
}

async function listSubscriptions(groupId) {
  const response = await api(`/v1/subscriptionGroups/${groupId}/subscriptions?limit=50`);
  return response.data || [];
}

async function updateSubscriptionReviewNote(subscriptionId, product) {
  await api(`/v1/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'subscriptions',
        id: subscriptionId,
        attributes: {
          reviewNote:
            product.productId === 'com.forg3.sign.payper.yearly'
              ? 'Forg3 Pay Per Signature is prepared for the annual base plan. The first native launch presents Pro and Business only while per-signature credits are finalized as store-managed usage products.'
              : 'Forg3 native subscription entitlement is verified server-side before creating or emailing signing requests.'
        }
      }
    }
  });
}

async function upsertLocalization(subscriptionId, product) {
  const existing = await api(`/v1/subscriptions/${subscriptionId}/subscriptionLocalizations?limit=20`);
  const localization = existing.data?.find((candidate) => candidate.attributes?.locale === 'en-US');

  if (localization) {
    await api(`/v1/subscriptionLocalizations/${localization.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'subscriptionLocalizations',
          id: localization.id,
          attributes: {
            name: product.displayName,
            description: product.description
          }
        }
      }
    });
    return;
  }

  await api('/v1/subscriptionLocalizations', {
    method: 'POST',
    body: {
      data: {
        type: 'subscriptionLocalizations',
        attributes: {
          locale: 'en-US',
          name: product.displayName,
          description: product.description
        },
        relationships: {
          subscription: {
            data: {
              type: 'subscriptions',
              id: subscriptionId
            }
          }
        }
      }
    }
  });
}

async function setAvailability(subscriptionId, territoryIds) {
  await api('/v1/subscriptionAvailabilities', {
    method: 'POST',
    body: {
      data: {
        type: 'subscriptionAvailabilities',
        attributes: {
          availableInNewTerritories: true
        },
        relationships: {
          availableTerritories: {
            data: territoryIds.map((id) => ({
              type: 'territories',
              id
            }))
          },
          subscription: {
            data: {
              type: 'subscriptions',
              id: subscriptionId
            }
          }
        }
      }
    }
  });
}

async function setPrices(subscriptionId, usaPrice) {
  const basePricePoint = await findUsaPricePoint(subscriptionId, usaPrice);
  const pricePoints = await listEqualizedPricePoints(basePricePoint);
  const territoryIds = Array.from(
    new Set(pricePoints.map((pricePoint) => pricePoint.relationships?.territory?.data?.id).filter(Boolean))
  ).sort();

  await setAvailability(subscriptionId, territoryIds);

  const existingPrices = await api(`/v1/subscriptions/${subscriptionId}/prices?limit=200`);
  const existingTerritories = new Set(
    (existingPrices.data || []).map((price) => price.relationships?.territory?.data?.id).filter(Boolean)
  );

  for (const pricePoint of pricePoints) {
    const territoryId = pricePoint.relationships?.territory?.data?.id;

    if (!territoryId || existingTerritories.has(territoryId)) {
      continue;
    }

    await api('/v1/subscriptionPrices', {
      method: 'POST',
      body: {
        data: {
          type: 'subscriptionPrices',
          relationships: {
            subscription: {
              data: {
                type: 'subscriptions',
                id: subscriptionId
              }
            },
            subscriptionPricePoint: {
              data: {
                type: 'subscriptionPricePoints',
                id: pricePoint.id
              }
            },
            territory: {
              data: {
                type: 'territories',
                id: territoryId
              }
            }
          }
        }
      }
    });
    existingTerritories.add(territoryId);
  }
}

async function findUsaPricePoint(subscriptionId, customerPrice) {
  let nextPath = `/v1/subscriptions/${subscriptionId}/pricePoints?filter[territory]=USA&limit=200&include=territory`;

  while (nextPath) {
    const response = await api(nextPath);
    const pricePoint = (response.data || []).find(
      (candidate) => String(candidate.attributes?.customerPrice) === customerPrice
    );

    if (pricePoint) {
      return pricePoint;
    }

    nextPath = toApiPath(response.links?.next);
  }

  throw new Error(`USA subscription price point ${customerPrice} not found for subscription ${subscriptionId}.`);
}

async function listEqualizedPricePoints(basePricePoint) {
  const pricePoints = [basePricePoint];
  let nextPath = `/v1/subscriptionPricePoints/${encodeURIComponent(basePricePoint.id)}/equalizations?limit=200&include=territory`;

  while (nextPath) {
    const response = await api(nextPath);
    pricePoints.push(...(response.data || []));
    nextPath = toApiPath(response.links?.next);
  }

  return pricePoints;
}

async function replaceReviewScreenshot(subscriptionId, filePath) {
  const existing = await api(`/v1/subscriptions/${subscriptionId}/appStoreReviewScreenshot`);

  if (existing.data?.id) {
    await api(`/v1/subscriptionAppStoreReviewScreenshots/${existing.data.id}`, {
      method: 'DELETE',
      expectJson: false
    });
  }

  await uploadReviewScreenshot(subscriptionId, filePath);
}

async function uploadReviewScreenshot(subscriptionId, filePath) {
  const bytes = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const md5 = crypto.createHash('md5').update(bytes).digest('hex');
  const reservation = await api('/v1/subscriptionAppStoreReviewScreenshots', {
    method: 'POST',
    body: {
      data: {
        type: 'subscriptionAppStoreReviewScreenshots',
        attributes: {
          fileName,
          fileSize: bytes.length
        },
        relationships: {
          subscription: {
            data: {
              type: 'subscriptions',
              id: subscriptionId
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

  await api(`/v1/subscriptionAppStoreReviewScreenshots/${screenshot.id}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'subscriptionAppStoreReviewScreenshots',
        id: screenshot.id,
        attributes: {
          uploaded: true,
          sourceFileChecksum: md5
        }
      }
    }
  });
}

async function printStatus(groupId) {
  const subscriptions = await listSubscriptions(groupId);

  for (const subscription of subscriptions) {
    const prices = await api(`/v1/subscriptions/${subscription.id}/prices?limit=200`);
    const review = await api(`/v1/subscriptions/${subscription.id}/appStoreReviewScreenshot`);
    console.log(
      `${subscription.attributes.productId}: ${subscription.attributes.state}; prices=${prices.data?.length || 0}; reviewScreenshot=${
        review.data?.attributes?.assetDeliveryState?.state || (review.data?.id ? 'uploaded' : 'missing')
      }`
    );
  }
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
    throw new Error(`${options.method || 'GET'} ${pathname} failed (${response.status}): ${JSON.stringify(body).slice(0, 900)}`);
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

function toApiPath(url) {
  if (!url) {
    return '';
  }

  return url.startsWith(apiBase) ? url.slice(apiBase.length) : url;
}
