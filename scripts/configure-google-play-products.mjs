import crypto from 'node:crypto';
import fs from 'node:fs';

const env = loadEnvFiles(['.env.production', '.env.local', '.env']);
const packageName = readEnv('GOOGLE_PLAY_PACKAGE_NAME') || 'com.forg3.sign';
const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;

const products = [
  {
    productId: 'forg3_pro_monthly',
    basePlanId: 'monthly',
    title: 'Forg3 Pro',
    description: 'Monthly sender access for individual secure e-signature workflows.',
    benefits: ['Send signing packets', 'Recipient-only access', 'Sealed PDFs', 'Audit trail'],
    price: { currencyCode: 'USD', units: '18', nanos: 990_000_000 }
  },
  {
    productId: 'forg3_business_monthly',
    basePlanId: 'monthly',
    title: 'Forg3 Business',
    description: 'Monthly sender access for business secure e-signature workflows.',
    benefits: ['Unlimited sender access', 'Recipient-only access', 'Sealed PDFs', 'Audit trail'],
    price: { currencyCode: 'USD', units: '39', nanos: 990_000_000 }
  }
];

const accessToken = await getGooglePlayAccessToken();
const existing = await listSubscriptions();

for (const product of products) {
  if (!existing.has(product.productId)) {
    const prices = await convertRegionPrices(product.price);
    await createSubscription(product, prices);
    console.log(`created - ${product.productId}`);
  } else {
    console.log(`exists - ${product.productId}`);
  }

  const subscription = await getSubscription(product.productId);
  const basePlan = subscription.basePlans?.find((current) => current.basePlanId === product.basePlanId);
  if (basePlan?.state !== 'ACTIVE') {
    await activateBasePlan(product);
    console.log(`activated - ${product.productId}/${product.basePlanId}`);
  } else {
    console.log(`active - ${product.productId}/${product.basePlanId}`);
  }
}

const finalProducts = await listSubscriptions();
console.log(
  JSON.stringify(
    Array.from(finalProducts.values()).map((subscription) => ({
      productId: subscription.productId,
      basePlans: (subscription.basePlans || []).map((basePlan) => ({
        basePlanId: basePlan.basePlanId,
        state: basePlan.state
      }))
    })),
    null,
    2
  )
);

async function listSubscriptions() {
  const response = await googleApi(`${baseUrl}/subscriptions`, { allowEmpty: true });
  const subscriptions = response.subscriptions || [];
  return new Map(subscriptions.map((subscription) => [subscription.productId, subscription]));
}

async function getSubscription(productId) {
  return googleApi(`${baseUrl}/subscriptions/${encodeURIComponent(productId)}`);
}

async function convertRegionPrices(price) {
  const converted = await googleApi(`${baseUrl}/pricing:convertRegionPrices`, {
    method: 'POST',
    body: {
      price
    }
  });

  if (!converted.regionVersion || !converted.convertedRegionPrices || !converted.convertedOtherRegionsPrice) {
    throw new Error(`Google Play did not return complete converted prices for ${price.currencyCode}.`);
  }

  return converted;
}

async function createSubscription(product, prices) {
  const url = new URL(`${baseUrl}/subscriptions`);
  url.searchParams.set('productId', product.productId);
  url.searchParams.set('regionsVersion.version', prices.regionVersion.version);

  const regionalConfigs = Object.values(prices.convertedRegionPrices).map((regionPrice) => ({
    regionCode: regionPrice.regionCode,
    newSubscriberAvailability: true,
    price: regionPrice.price
  }));

  return googleApi(url, {
    method: 'POST',
    body: {
      packageName,
      productId: product.productId,
      listings: [
        {
          languageCode: 'en-US',
          title: product.title,
          benefits: product.benefits,
          description: product.description
        }
      ],
      basePlans: [
        {
          basePlanId: product.basePlanId,
          regionalConfigs,
          otherRegionsConfig: {
            usdPrice: prices.convertedOtherRegionsPrice.usdPrice,
            eurPrice: prices.convertedOtherRegionsPrice.eurPrice,
            newSubscriberAvailability: true
          },
          autoRenewingBasePlanType: {
            billingPeriodDuration: 'P1M',
            resubscribeState: 'RESUBSCRIBE_STATE_ACTIVE'
          }
        }
      ]
    }
  });
}

async function activateBasePlan(product) {
  return googleApi(
    `${baseUrl}/subscriptions/${encodeURIComponent(product.productId)}/basePlans/${encodeURIComponent(
      product.basePlanId
    )}:activate`,
    {
      method: 'POST',
      body: {}
    }
  );
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
