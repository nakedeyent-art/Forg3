import crypto from 'node:crypto';
import fs from 'node:fs';
import type { BillingProvider, PlanId, SubscriptionPlan, SubscriptionStatus } from './types.js';

const appleSandboxBaseUrl = 'https://api.storekit-sandbox.itunes.apple.com';
const appleProductionBaseUrl = 'https://api.storekit.itunes.apple.com';
const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const googleAndroidPublisherScope = 'https://www.googleapis.com/auth/androidpublisher';

export interface StoreBillingVerificationInput {
  billingProvider: BillingProvider;
  providerReceipt: string;
  plan: SubscriptionPlan;
  requestBody: Record<string, unknown>;
}

export interface StoreBillingVerificationResult {
  verified: boolean;
  status?: SubscriptionStatus;
  renewsAt?: string;
  providerTransactionId?: string;
  providerOriginalTransactionId?: string;
  providerProductId?: string;
  providerPurchaseTokenHash?: string;
  providerEnvironment?: string;
  providerEventId?: string;
  error?: string;
  requiredNextStep?: string;
}

interface AppleTransactionPayload {
  bundleId?: string;
  environment?: string;
  expiresDate?: number | string;
  originalTransactionId?: string;
  productId?: string;
  revocationDate?: number | string;
  transactionId?: string;
}

interface GoogleSubscriptionPurchaseV2 {
  acknowledgementState?: string;
  latestOrderId?: string;
  lineItems?: Array<{
    expiryTime?: string;
    productId?: string;
  }>;
  subscriptionState?: string;
}

interface GoogleServiceAccount {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

export function isStoreBillingConfigured() {
  return isAppleBillingConfigured() || isGoogleBillingConfigured() || process.env.STORE_BILLING_VERIFICATION_MODE === 'mock';
}

export function isAppleBillingConfigured() {
  return Boolean(
    process.env.APPLE_APP_STORE_ISSUER_ID &&
      process.env.APPLE_APP_STORE_KEY_ID &&
      readApplePrivateKey() &&
      getAppleBundleId()
  );
}

export function isGoogleBillingConfigured() {
  return Boolean(getGooglePackageName() && readGoogleServiceAccount());
}

export async function verifyStoreBillingReceipt(
  input: StoreBillingVerificationInput
): Promise<StoreBillingVerificationResult> {
  if (input.billingProvider === 'demo') {
    return {
      verified: process.env.NODE_ENV !== 'production',
      status: process.env.NODE_ENV !== 'production' ? 'active' : undefined,
      providerTransactionId: `demo_verify_${crypto.randomUUID()}`,
      error: 'Demo receipt verification is disabled in production.',
      requiredNextStep: 'Use App Store or Play Billing receipt verification in production.'
    };
  }

  if (process.env.STORE_BILLING_VERIFICATION_MODE === 'mock' && input.providerReceipt.startsWith('mock_receipt_')) {
    return {
      verified: true,
      status: 'active',
      providerTransactionId: `${input.billingProvider}_${crypto.randomUUID()}`
    };
  }

  if (input.billingProvider === 'apple_app_store') {
    return verifyAppleReceipt(input);
  }

  if (input.billingProvider === 'google_play') {
    return verifyGooglePlayReceipt(input);
  }

  return {
    verified: false,
    error: 'This billing provider is not supported in the native mobile build.',
    requiredNextStep: 'Use App Store or Google Play Billing for iOS and Android.'
  };
}

export function decodeAppleNotification(signedPayload: string) {
  const payload = decodeJwsPayload<Record<string, unknown>>(signedPayload);
  const notificationUUID = stringFrom(payload.notificationUUID);
  const notificationType = stringFrom(payload.notificationType);
  const subtype = stringFrom(payload.subtype);
  const data = isRecord(payload.data) ? payload.data : {};
  const signedTransactionInfo = stringFrom(data.signedTransactionInfo);
  const transaction = signedTransactionInfo ? decodeJwsPayload<AppleTransactionPayload>(signedTransactionInfo) : null;

  return {
    notificationUUID,
    notificationType,
    subtype,
    signedTransactionInfo,
    transaction
  };
}

export function decodeGoogleRtdn(body: Record<string, unknown>) {
  const message = isRecord(body.message) ? body.message : {};
  const data = stringFrom(message.data);

  if (!data) {
    throw new Error('Google RTDN payload is missing message.data.');
  }

  const decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as Record<string, unknown>;
  const subscriptionNotification = isRecord(decoded.subscriptionNotification)
    ? decoded.subscriptionNotification
    : {};

  return {
    eventId: stringFrom(message.messageId) || crypto.createHash('sha256').update(data).digest('hex'),
    packageName: stringFrom(decoded.packageName),
    productId: stringFrom(subscriptionNotification.subscriptionId),
    purchaseToken: stringFrom(subscriptionNotification.purchaseToken),
    notificationType: stringFrom(subscriptionNotification.notificationType)
  };
}

export function hashProviderToken(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function verifyAppleReceipt(input: StoreBillingVerificationInput): Promise<StoreBillingVerificationResult> {
  if (!isAppleBillingConfigured()) {
    return {
      verified: false,
      error: 'Apple App Store Server API credentials are not configured.',
      requiredNextStep:
        'Set APPLE_APP_STORE_ISSUER_ID, APPLE_APP_STORE_KEY_ID, APPLE_APP_STORE_PRIVATE_KEY, and APPLE_APP_STORE_BUNDLE_ID.'
    };
  }

  const signedTransactionInfo =
    stringFrom(input.requestBody.signedTransactionInfo) || (looksLikeJws(input.providerReceipt) ? input.providerReceipt : '');
  const transactionId =
    stringFrom(input.requestBody.transactionId) ||
    (signedTransactionInfo ? stringFrom(decodeJwsPayload<AppleTransactionPayload>(signedTransactionInfo).transactionId) : '') ||
    input.providerReceipt;

  if (!transactionId && !signedTransactionInfo) {
    return {
      verified: false,
      error: 'Apple verification requires a transactionId or signedTransactionInfo.',
      requiredNextStep: 'Pass the StoreKit Transaction id or signed transaction payload from the native iOS purchase.'
    };
  }

  const transactionPayload = signedTransactionInfo
    ? decodeJwsPayload<AppleTransactionPayload>(signedTransactionInfo)
    : await fetchAppleTransaction(transactionId);
  const expectedBundleId = getAppleBundleId();

  if (transactionPayload.bundleId !== expectedBundleId) {
    return {
      verified: false,
      error: 'Apple transaction bundleId does not match this app.'
    };
  }

  if (transactionPayload.productId !== input.plan.appleProductId) {
    return {
      verified: false,
      error: 'Apple transaction productId does not match the selected plan.'
    };
  }

  if (transactionPayload.revocationDate) {
    return {
      verified: false,
      status: 'canceled',
      error: 'Apple transaction was revoked or refunded.'
    };
  }

  const expiresAt = timestampToIso(transactionPayload.expiresDate);
  const status: SubscriptionStatus = expiresAt && new Date(expiresAt).getTime() <= Date.now() ? 'canceled' : 'active';

  return {
    verified: status === 'active',
    status,
    renewsAt: expiresAt,
    providerTransactionId: transactionPayload.transactionId || transactionId,
    providerOriginalTransactionId: transactionPayload.originalTransactionId,
    providerProductId: transactionPayload.productId,
    providerEnvironment: transactionPayload.environment
  };
}

async function fetchAppleTransaction(transactionId: string): Promise<AppleTransactionPayload> {
  const response = await fetch(`${getAppleApiBaseUrl()}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
    headers: {
      Authorization: `Bearer ${createAppleServerApiJwt()}`
    }
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(stringFrom(payload.errorMessage) || `Apple transaction lookup failed with status ${response.status}.`);
  }

  const signedTransactionInfo = stringFrom(payload.signedTransactionInfo);

  if (!signedTransactionInfo) {
    throw new Error('Apple transaction lookup did not return signedTransactionInfo.');
  }

  return decodeJwsPayload<AppleTransactionPayload>(signedTransactionInfo);
}

async function verifyGooglePlayReceipt(input: StoreBillingVerificationInput): Promise<StoreBillingVerificationResult> {
  if (!isGoogleBillingConfigured()) {
    return {
      verified: false,
      error: 'Google Play Developer API credentials are not configured.',
      requiredNextStep:
        'Set GOOGLE_PLAY_PACKAGE_NAME and GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64, or GOOGLE_APPLICATION_CREDENTIALS.'
    };
  }

  const purchaseToken = stringFrom(input.requestBody.purchaseToken) || input.providerReceipt;

  if (!purchaseToken) {
    return {
      verified: false,
      error: 'Google Play verification requires a purchase token.',
      requiredNextStep: 'Pass the Play Billing purchaseToken from the native Android purchase.'
    };
  }

  const purchase = await fetchGoogleSubscriptionPurchase(purchaseToken);
  const lineItem = purchase.lineItems?.find((item) => item.productId === input.plan.googleProductId);

  if (!lineItem) {
    return {
      verified: false,
      error: 'Google Play productId does not match the selected plan.'
    };
  }

  const status = googleSubscriptionStatus(purchase.subscriptionState);
  const renewsAt = lineItem.expiryTime;

  return {
    verified: status === 'active',
    status,
    renewsAt,
    providerTransactionId: purchase.latestOrderId || `google_play_${hashProviderToken(purchaseToken).slice(0, 20)}`,
    providerOriginalTransactionId: purchase.latestOrderId,
    providerProductId: lineItem.productId,
    providerPurchaseTokenHash: hashProviderToken(purchaseToken),
    providerEnvironment: 'google_play'
  };
}

async function fetchGoogleSubscriptionPurchase(purchaseToken: string): Promise<GoogleSubscriptionPurchaseV2> {
  const packageName = getGooglePackageName();
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      packageName
    )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const error = isRecord(payload.error) ? payload.error : {};
    throw new Error(stringFrom(error.message) || `Google Play purchase lookup failed with status ${response.status}.`);
  }

  return payload as GoogleSubscriptionPurchaseV2;
}

async function getGoogleAccessToken() {
  const serviceAccount = readGoogleServiceAccount();

  if (!serviceAccount?.client_email || !serviceAccount.private_key) {
    throw new Error('Google Play service account JSON is missing client_email or private_key.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const assertion = signJwtRs256(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: serviceAccount.client_email,
      scope: googleAndroidPublisherScope,
      aud: serviceAccount.token_uri || googleTokenUrl,
      iat: nowSeconds,
      exp: nowSeconds + 300
    },
    serviceAccount.private_key
  );
  const response = await fetch(serviceAccount.token_uri || googleTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(stringFrom(payload.error_description) || `Google OAuth token request failed with status ${response.status}.`);
  }

  const token = stringFrom(payload.access_token);

  if (!token) {
    throw new Error('Google OAuth token response did not include access_token.');
  }

  return token;
}

function createAppleServerApiJwt() {
  const issuerId = process.env.APPLE_APP_STORE_ISSUER_ID!;
  const keyId = process.env.APPLE_APP_STORE_KEY_ID!;
  const privateKey = readApplePrivateKey()!;
  const nowSeconds = Math.floor(Date.now() / 1000);

  return signJwtEs256(
    { alg: 'ES256', kid: keyId, typ: 'JWT' },
    {
      iss: issuerId,
      iat: nowSeconds,
      exp: nowSeconds + 300,
      aud: 'appstoreconnect-v1',
      bid: getAppleBundleId()
    },
    privateKey
  );
}

function signJwtEs256(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: string) {
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  });

  return `${signingInput}.${base64Url(signature)}`;
}

function signJwtRs256(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: string) {
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);

  return `${signingInput}.${base64Url(signature)}`;
}

function decodeJwsPayload<T>(jws: string): T {
  const [, payload] = jws.split('.');

  if (!payload) {
    throw new Error('Expected a compact JWS payload.');
  }

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
}

function base64UrlJson(value: Record<string, unknown>) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value: Buffer) {
  return value.toString('base64url');
}

function readApplePrivateKey() {
  const raw =
    process.env.APPLE_APP_STORE_PRIVATE_KEY ||
    (process.env.APPLE_APP_STORE_PRIVATE_KEY_BASE64
      ? Buffer.from(process.env.APPLE_APP_STORE_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
      : '');

  return raw ? raw.replace(/\\n/g, '\n') : '';
}

function readGoogleServiceAccount(): GoogleServiceAccount | null {
  const inline =
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ||
    (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64
      ? Buffer.from(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8')
      : '');
  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const raw = inline || (filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as GoogleServiceAccount;
  } catch {
    return null;
  }
}

function getAppleBundleId() {
  return process.env.APPLE_APP_STORE_BUNDLE_ID || process.env.IOS_BUNDLE_ID || 'com.forg3.sign';
}

function getAppleApiBaseUrl() {
  if (process.env.APPLE_APP_STORE_API_BASE_URL) {
    return process.env.APPLE_APP_STORE_API_BASE_URL.replace(/\/$/, '');
  }

  return process.env.APPLE_APP_STORE_ENVIRONMENT === 'production' ? appleProductionBaseUrl : appleSandboxBaseUrl;
}

function getGooglePackageName() {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME || process.env.ANDROID_PACKAGE_NAME || 'com.forg3.sign';
}

function googleSubscriptionStatus(subscriptionState?: string): SubscriptionStatus {
  if (subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE' || subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') {
    return 'active';
  }

  if (
    subscriptionState === 'SUBSCRIPTION_STATE_ON_HOLD' ||
    subscriptionState === 'SUBSCRIPTION_STATE_PENDING' ||
    subscriptionState === 'SUBSCRIPTION_STATE_PAUSED'
  ) {
    return 'past_due';
  }

  return 'canceled';
}

function timestampToIso(value: number | string | undefined) {
  if (!value) {
    return undefined;
  }

  const timestamp = typeof value === 'string' ? Number(value) : value;

  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return new Date(timestamp).toISOString();
}

function looksLikeJws(value: string) {
  return value.split('.').length === 3;
}

function stringFrom(value: unknown) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
