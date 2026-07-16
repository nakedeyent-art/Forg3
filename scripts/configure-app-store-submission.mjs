import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = 'https://api.appstoreconnect.apple.com';
const env = loadEnv();
const credential = loadCredential();
const mode = process.argv[2] || 'status';
const bundleId = env.APPLE_APP_STORE_BUNDLE_ID || 'com.forg3.sign';
const versionString = env.APP_STORE_VERSION || '1.0';

await main();

async function main() {
  const app = await getApp();
  const version = await getVersion(app.id);
  const localization = await firstOrNull(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=10`);
  const reviewDetail = await getRelationship(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`);
  const appInfo = await getAppInfo(app.id);
  const ageRating = appInfo?.id ? await getAgeRating(appInfo.id) : null;
  const submission = await getRelationship(`/v1/appStoreVersions/${version.id}/appStoreVersionSubmission`);
  const build = await getRelationship(`/v1/appStoreVersions/${version.id}/build`);
  const encryption = build?.id
    ? await getRelationship(`/v1/builds/${build.id}/appEncryptionDeclaration`)
    : null;

  if (mode === 'status') {
    printStatus({ app, version, localization, reviewDetail, ageRating, submission, build, appInfo, encryption });
    return;
  }

  if (mode === 'configure') {
    await configure({ app, version, localization, reviewDetail, ageRating, build });
    return;
  }

  if (mode === 'submit') {
    await submitForReview({ version, reviewDetail, ageRating, build });
    return;
  }

  throw new Error(`Unknown mode "${mode}". Use status, configure, or submit.`);
}

async function configure({ app, version, localization, reviewDetail, ageRating, build }) {
  const missing = [];

  if (!ageRating?.id) {
    missing.push('Age rating declaration record is missing in App Store Connect.');
  }

  if (!build?.id) {
    missing.push('No build is attached to the App Store version.');
  }

  if (ageRating?.id) {
    await configureAgeRating(ageRating.id);
  }

  if (localization?.id) {
    await api(`/v1/appStoreVersionLocalizations/${localization.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'appStoreVersionLocalizations',
          id: localization.id,
          attributes: {
            marketingUrl: env.APP_STORE_MARKETING_URL || 'https://forg3.nak3deye.com/',
            promotionalText:
              'Secure PDF e-signatures with email-verified recipient access, device verification, and sealed audit records.'
          }
        }
      }
    });
  }

  if (build?.id) {
    await attachBuildBetaDetailIfAvailable(app.id, version.id, build.id);
  }

  const contactFirstName = env.APP_STORE_REVIEW_FIRST_NAME || env.APP_REVIEW_FIRST_NAME || '';
  const contactLastName = env.APP_STORE_REVIEW_LAST_NAME || env.APP_REVIEW_LAST_NAME || '';
  const contactEmail = env.APP_STORE_REVIEW_EMAIL || env.APP_REVIEW_EMAIL || env.SUPPORT_EMAIL || 'st@nak3deye.com';
  const contactPhone = env.APP_STORE_REVIEW_PHONE || env.APP_REVIEW_PHONE || '';

  if (!contactFirstName) missing.push('APP_STORE_REVIEW_FIRST_NAME');
  if (!contactLastName) missing.push('APP_STORE_REVIEW_LAST_NAME');
  if (!contactEmail) missing.push('APP_STORE_REVIEW_EMAIL');
  if (!contactPhone) missing.push('APP_STORE_REVIEW_PHONE');

  if (missing.length) {
    console.log('Configured age rating/localization where possible.');
    console.log('Cannot safely configure final App Review contact fields yet. Missing:');
    for (const item of missing) console.log(`- ${item}`);
    process.exitCode = 2;
    return;
  }

  const configuredReviewDetail = reviewDetail?.id
    ? await updateReviewDetail(reviewDetail.id, {
        contactFirstName,
        contactLastName,
        contactPhone,
        contactEmail
      })
    : await createReviewDetail(version.id, {
        contactFirstName,
        contactLastName,
        contactPhone,
        contactEmail
      });

  console.log(`Configured App Review contact, notes, localization polish, and age rating for ${app.attributes.name} ${version.attributes.versionString}.`);
  console.log(`App Review detail: ${configuredReviewDetail.id}`);
  console.log('Export compliance still must be answered truthfully in App Store Connect unless an encryption declaration is already attached to the build.');
}

async function createReviewDetail(versionId, contact) {
  const response = await api('/v1/appStoreReviewDetails', {
    method: 'POST',
    body: {
      data: {
        type: 'appStoreReviewDetails',
        attributes: reviewDetailAttributes(contact),
        relationships: {
          appStoreVersion: {
            data: {
              type: 'appStoreVersions',
              id: versionId
            }
          }
        }
      }
    }
  });

  return response.data;
}

async function updateReviewDetail(reviewDetailId, contact) {
  const response = await api(`/v1/appStoreReviewDetails/${reviewDetailId}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'appStoreReviewDetails',
        id: reviewDetailId,
        attributes: reviewDetailAttributes(contact)
      }
    }
  });

  return response.data;
}

function reviewDetailAttributes({ contactFirstName, contactLastName, contactPhone, contactEmail }) {
  return {
    contactFirstName,
    contactLastName,
    contactPhone,
    contactEmail,
    demoAccountName: env.APP_STORE_REVIEW_DEMO_ACCOUNT || '',
    demoAccountPassword: env.APP_STORE_REVIEW_DEMO_PASSWORD || '',
    demoAccountRequired: false,
    notes: appReviewNotes()
  };
}

async function configureAgeRating(ageRatingId) {
  const attributes = {
    alcoholTobaccoOrDrugUseOrReferences: 'NONE',
    advertising: false,
    ageAssurance: false,
    contests: 'NONE',
    gambling: false,
    gamblingSimulated: 'NONE',
    gunsOrOtherWeapons: 'NONE',
    healthOrWellnessTopics: false,
    horrorOrFearThemes: 'NONE',
    lootBox: false,
    matureOrSuggestiveThemes: 'NONE',
    medicalOrTreatmentInformation: 'NONE',
    messagingAndChat: false,
    parentalControls: false,
    profanityOrCrudeHumor: 'NONE',
    sexualContentGraphicAndNudity: 'NONE',
    sexualContentOrNudity: 'NONE',
    unrestrictedWebAccess: false,
    userGeneratedContent: true,
    violenceCartoonOrFantasy: 'NONE',
    violenceRealistic: 'NONE',
    violenceRealisticProlongedGraphicOrSadistic: 'NONE'
  };

  await api(`/v1/ageRatingDeclarations/${ageRatingId}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'ageRatingDeclarations',
        id: ageRatingId,
        attributes
      }
    }
  });
}

async function attachBuildBetaDetailIfAvailable(appId, versionId, buildId) {
  const versionBuild = await getRelationship(`/v1/appStoreVersions/${versionId}/build`);
  if (versionBuild?.id === buildId) return;

  await api(`/v1/appStoreVersions/${versionId}/relationships/build`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'builds',
        id: buildId
      }
    }
  });
}

async function submitForReview({ version, reviewDetail, ageRating, build }) {
  const blockers = [];
  if (!reviewDetail?.id) blockers.push('missing App Review detail');
  if (!ageRating?.id) blockers.push('missing age rating declaration');
  if (!build?.id) blockers.push('missing attached build');
  const encryption = build?.id ? await getRelationship(`/v1/builds/${build.id}/appEncryptionDeclaration`) : null;
  const exportComplianceConfirmed = String(env.APP_STORE_EXPORT_COMPLIANCE_CONFIRMED || '').toLowerCase() === 'true';
  if (!encryption?.id && !exportComplianceConfirmed) {
    blockers.push('missing export-compliance confirmation or attached encryption declaration');
  }

  if (blockers.length) {
    console.log('Cannot submit yet:');
    for (const blocker of blockers) console.log(`- ${blocker}`);
    process.exitCode = 2;
    return;
  }

  const existing = await getRelationship(`/v1/appStoreVersions/${version.id}/appStoreVersionSubmission`);
  if (existing?.id) {
    console.log(`Submission already exists: ${existing.id} (${existing.attributes?.state || 'state unknown'}).`);
    return;
  }

  const response = await api('/v1/appStoreVersionSubmissions', {
    method: 'POST',
    body: {
      data: {
        type: 'appStoreVersionSubmissions',
        relationships: {
          appStoreVersion: {
            data: {
              type: 'appStoreVersions',
              id: version.id
            }
          }
        }
      }
    }
  });

  console.log(`Submitted App Store version ${version.attributes.versionString} for review: ${response.data?.id || 'created'}.`);
}

function appReviewNotes() {
  return [
    'Forg3 is a secure e-signature app for PDF documents. Review can sign in with the supplied email test account/code flow.',
    'New devices require device verification before account documents or recipient rooms open.',
    'A paid subscription is required before non-creator accounts can send signature requests. Recipients can sign assigned documents without a paid subscription.',
    'Account deletion is available in Account settings and permanently removes documents, files, devices, sessions, and account history.',
    'Forg3 creates electronic signature stamps and audit certificate pages; it does not claim notarization or CA-backed PAdES signatures unless a production certificate provider is configured.'
  ].join('\n\n');
}

function printStatus({ app, version, localization, reviewDetail, ageRating, submission, build, appInfo, encryption }) {
  console.log(`App: ${app.attributes.name} (${app.id}) bundle=${bundleId}`);
  console.log(`Version: ${version.attributes.versionString} state=${version.attributes.appStoreState}`);
  console.log(`Localization: ${localization?.attributes?.locale || 'missing'} (${localization?.id || 'none'})`);
  console.log(`App info: ${appInfo?.id || 'none'}`);
  console.log(`Build: ${build?.attributes?.version || build?.id || 'none'} (${build?.id || 'none'})`);
  console.log(`Review detail: ${reviewDetail?.id || 'missing'}`);
  if (reviewDetail?.attributes) {
    console.log(`Review contact: email=${maskEmail(reviewDetail.attributes.contactEmail)} phone=${reviewDetail.attributes.contactPhone ? 'present' : 'missing'}`);
    console.log(`Review notes: ${reviewDetail.attributes.notes ? 'present' : 'missing'}`);
    console.log(`Demo account: ${reviewDetail.attributes.demoAccountName ? 'present' : 'not set'}`);
  }
  console.log(`Age rating: ${ageRating?.id || 'missing'}`);
  if (ageRating?.attributes) {
    const enabled = Object.entries(ageRating.attributes)
      .filter(([key, value]) => !['kidsAgeBand'].includes(key) && value && value !== 'NONE' && value !== false)
      .map(([key, value]) => `${key}=${value}`);
    console.log(`Age rating non-default answers: ${enabled.length ? enabled.join(', ') : 'none'}`);
  }
  console.log(`Encryption declaration on attached build: ${encryption?.id || 'missing/unknown'}`);
  console.log(`Submission: ${submission?.id || 'not submitted'}${submission?.attributes?.state ? ` state=${submission.attributes.state}` : ''}`);
}

async function getApp() {
  const response = await api(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  const app = response.data?.[0];
  if (!app) throw new Error(`App Store Connect app not found for bundle ${bundleId}.`);
  return app;
}

async function getAppInfo(appId) {
  return firstOrNull(`/v1/apps/${appId}/appInfos?limit=10`);
}

async function getAgeRating(appInfoId) {
  return getRelationship(`/v1/appInfos/${appInfoId}/ageRatingDeclaration`);
}

async function getVersion(appId) {
  const response = await api(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=10`);
  const version = response.data?.find((candidate) => candidate.attributes?.versionString === versionString) || response.data?.[0];
  if (!version) throw new Error('No iOS App Store version found.');
  return version;
}

async function firstOrNull(pathname) {
  const response = await api(pathname);
  return response.data?.[0] || null;
}

async function getRelationship(pathname) {
  try {
    const response = await api(pathname);
    if (Array.isArray(response.data)) return response.data[0] || null;
    return response.data || null;
  } catch (error) {
    if (error.message.includes('(404)')) return null;
    throw error;
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
    throw new Error(`${options.method || 'GET'} ${pathname} failed (${response.status}): ${JSON.stringify(body).slice(0, 1200)}`);
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

  for (const file of ['.env.production.local', '.env.local', '.env.production', '.env']) {
    const envPath = path.join(rootDir, file);
    if (!fs.existsSync(envPath)) continue;

    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
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

function maskEmail(value) {
  if (!value || !value.includes('@')) return value ? 'present' : 'missing';
  const [name, domain] = value.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}
