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
const appStoreCopyright = env.APP_STORE_COPYRIGHT || '2026 NAK3D EYE ENTERPRISES';
const appStoreContentRightsDeclaration =
  env.APP_STORE_CONTENT_RIGHTS_DECLARATION || 'DOES_NOT_USE_THIRD_PARTY_CONTENT';
const appStorePrimaryCategory = env.APP_STORE_PRIMARY_CATEGORY || 'BUSINESS';
const appStoreBaseTerritory = env.APP_STORE_BASE_TERRITORY || 'USA';
const appStoreMarketingUrl = env.APP_STORE_MARKETING_URL || 'https://forg3.nak3deye.com/';
const appStoreSupportUrl = env.APP_STORE_SUPPORT_URL || 'https://forg3.nak3deye.com/#/privacy';
const appStoreTermsUrl = env.APP_STORE_TERMS_URL || 'https://forg3.nak3deye.com/#/terms';
const appStorePrivacyUrl = env.APP_STORE_PRIVACY_URL || 'https://forg3.nak3deye.com/#/privacy';
const appleStandardEulaUrl =
  env.APP_STORE_EULA_URL || 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const launchSubscriptionProductIds = [
  'com.forg3.sign.pro.monthly',
  'com.forg3.sign.business.monthly'
];

await main();

async function main() {
  const app = await getApp();
  const version = await getVersion(app.id);
  const localization = await firstOrNull(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=10`);
  const reviewDetail = await getRelationship(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`);
  const appInfo = await getAppInfo(app.id);
  const ageRating = appInfo?.id ? await getAgeRating(appInfo.id) : null;
  const primaryCategory = appInfo?.id
    ? await getRelationship(`/v1/appInfos/${appInfo.id}/primaryCategory`)
    : null;
  const submission = await getRelationship(`/v1/appStoreVersions/${version.id}/appStoreVersionSubmission`);
  const build = await getRelationship(`/v1/appStoreVersions/${version.id}/build`);
  const buildDetail = build?.id ? await getBuild(build.id) : null;
  const encryption = build?.id
    ? await getRelationship(`/v1/builds/${build.id}/appEncryptionDeclaration`)
    : null;
  const reviewSubmissions = await listReviewSubmissions(app.id);
  const manualAppPrices = await listManualAppPrices(app.id);

  if (mode === 'status') {
    printStatus({
      app,
      version,
      localization,
      reviewDetail,
      ageRating,
      submission,
      build,
      buildDetail,
      appInfo,
      primaryCategory,
      encryption,
      manualAppPrices,
      reviewSubmissions
    });
    return;
  }

  if (mode === 'configure') {
    await configure({ app, version, localization, reviewDetail, ageRating, build });
    return;
  }

  if (mode === 'export-compliance') {
    await configureExportCompliance({ build, buildDetail });
    return;
  }

  if (mode === 'attach-latest-build') {
    await attachLatestValidBuild(app.id, version.id);
    return;
  }

  if (mode === 'metadata') {
    await configureSubmissionMetadata({ app, version, appInfo, primaryCategory, manualAppPrices });
    return;
  }

  if (mode === 'submit') {
    await submitForReview({ version, reviewDetail, ageRating, build, buildDetail });
    return;
  }

  if (mode === 'review-submit') {
    await submitReviewPackage({ app, version, reviewDetail, ageRating, build, buildDetail, reviewSubmissions });
    return;
  }

  throw new Error(`Unknown mode "${mode}". Use status, configure, export-compliance, attach-latest-build, metadata, submit, or review-submit.`);
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
            description: appStoreDescription(),
            marketingUrl: appStoreMarketingUrl,
            supportUrl: appStoreSupportUrl,
            promotionalText:
              'Secure document e-signatures with email-verified recipient access, device verification, and sealed audit records.'
          }
        }
      }
    });
  }

  if (build?.id) {
    await attachBuildBetaDetailIfAvailable(app.id, version.id, build.id);
  }

  const existingReviewAttributes = reviewDetail?.attributes || {};
  const contactFirstName =
    env.APP_STORE_REVIEW_FIRST_NAME || env.APP_REVIEW_FIRST_NAME || existingReviewAttributes.contactFirstName || '';
  const contactLastName =
    env.APP_STORE_REVIEW_LAST_NAME || env.APP_REVIEW_LAST_NAME || existingReviewAttributes.contactLastName || '';
  const contactEmail =
    env.APP_STORE_REVIEW_EMAIL ||
    env.APP_REVIEW_EMAIL ||
    env.SUPPORT_EMAIL ||
    existingReviewAttributes.contactEmail ||
    'st@nak3deye.com';
  const contactPhone = env.APP_STORE_REVIEW_PHONE || env.APP_REVIEW_PHONE || existingReviewAttributes.contactPhone || '';
  const demoAccountName =
    env.APP_STORE_REVIEW_DEMO_ACCOUNT ||
    env.FORG3_REVIEW_ACCESS_EMAIL ||
    existingReviewAttributes.demoAccountName ||
    '';
  const demoAccountPassword =
    env.APP_STORE_REVIEW_DEMO_PASSWORD ||
    env.FORG3_REVIEW_ACCESS_CODE ||
    existingReviewAttributes.demoAccountPassword ||
    '';

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
        contactEmail,
        demoAccountName,
        demoAccountPassword
      })
    : await createReviewDetail(version.id, {
        contactFirstName,
        contactLastName,
        contactPhone,
        contactEmail,
        demoAccountName,
        demoAccountPassword
      });

  console.log(`Configured App Review contact, notes, localization polish, and age rating for ${app.attributes.name} ${version.attributes.versionString}.`);
  console.log(`App Review detail: ${configuredReviewDetail.id}`);
  console.log('Export compliance still must be answered truthfully with `npm run appstore:submission -- export-compliance` or in App Store Connect.');
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

function reviewDetailAttributes({
  contactFirstName,
  contactLastName,
  contactPhone,
  contactEmail,
  demoAccountName = '',
  demoAccountPassword = ''
}) {
  return {
    contactFirstName,
    contactLastName,
    contactPhone,
    contactEmail,
    demoAccountName,
    demoAccountPassword,
    demoAccountRequired: Boolean(demoAccountName || demoAccountPassword),
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
    socialMedia: false,
    socialMediaAgeRestricted: false,
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

async function attachLatestValidBuild(appId, versionId) {
  const buildNumber = env.APP_STORE_BUILD_NUMBER || env.IOS_BUILD_NUMBER || '';
  const params = new URLSearchParams({
    'filter[app]': appId,
    'filter[processingState]': 'VALID',
    limit: '10',
    sort: '-uploadedDate'
  });
  if (buildNumber) {
    params.set('filter[version]', buildNumber);
  }

  const response = await api(`/v1/builds?${params}`);
  const latestBuild = response.data?.[0];
  if (!latestBuild?.id) {
    throw new Error(buildNumber
      ? `No valid App Store Connect build found for build number ${buildNumber}.`
      : 'No valid App Store Connect builds found.');
  }

  await attachBuildBetaDetailIfAvailable(appId, versionId, latestBuild.id);
  console.log(`Attached build ${latestBuild.attributes?.version || latestBuild.id} to App Store version ${versionString}.`);
}

async function configureExportCompliance({ build, buildDetail }) {
  if (!build?.id) {
    throw new Error('No build is attached to the App Store version.');
  }

  if (buildDetail?.attributes?.usesNonExemptEncryption === false) {
    console.log(`Build ${build.attributes?.version || build.id} already declares no non-exempt encryption.`);
    return;
  }

  const response = await api(`/v1/builds/${build.id}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'builds',
        id: build.id,
        attributes: {
          usesNonExemptEncryption: false
        }
      }
    }
  });

  console.log(`Configured export compliance for build ${response.data?.attributes?.version || build.id}: usesNonExemptEncryption=false.`);
}

async function configureSubmissionMetadata({ app, version, appInfo, primaryCategory, manualAppPrices }) {
  if (!appInfo?.id) {
    throw new Error('No App Info record exists for this app.');
  }

  if (app.attributes?.contentRightsDeclaration !== appStoreContentRightsDeclaration) {
    await api(`/v1/apps/${app.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'apps',
          id: app.id,
          attributes: {
            contentRightsDeclaration: appStoreContentRightsDeclaration
          }
        }
      }
    });
    console.log(`Set content rights declaration to ${appStoreContentRightsDeclaration}.`);
  } else {
    console.log(`Content rights declaration already set to ${appStoreContentRightsDeclaration}.`);
  }

  if (version.attributes?.copyright !== appStoreCopyright) {
    await api(`/v1/appStoreVersions/${version.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'appStoreVersions',
          id: version.id,
          attributes: {
            copyright: appStoreCopyright
          }
        }
      }
    });
    console.log(`Set copyright to ${appStoreCopyright}.`);
  } else {
    console.log(`Copyright already set to ${appStoreCopyright}.`);
  }

  if (version.attributes?.usesIdfa !== false) {
    await api(`/v1/appStoreVersions/${version.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'appStoreVersions',
          id: version.id,
          attributes: {
            usesIdfa: false
          }
        }
      }
    });
    console.log('Set Advertising Identifier usage to false.');
  } else {
    console.log('Advertising Identifier usage already set to false.');
  }

  if (primaryCategory?.id !== appStorePrimaryCategory) {
    await api(`/v1/appInfos/${appInfo.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'appInfos',
          id: appInfo.id,
          relationships: {
            primaryCategory: {
              data: {
                type: 'appCategories',
                id: appStorePrimaryCategory
              }
            }
          }
        }
      }
    });
    console.log(`Set primary category to ${appStorePrimaryCategory}.`);
  } else {
    console.log(`Primary category already set to ${appStorePrimaryCategory}.`);
  }

  await ensureFreeAppPricing(app.id, manualAppPrices);
}

async function submitForReview({ version, reviewDetail, ageRating, build, buildDetail }) {
  const blockers = [];
  if (!reviewDetail?.id) blockers.push('missing App Review detail');
  if (!ageRating?.id) blockers.push('missing age rating declaration');
  if (!build?.id) blockers.push('missing attached build');
  const encryption = build?.id ? await getRelationship(`/v1/builds/${build.id}/appEncryptionDeclaration`) : null;
  const exportComplianceConfirmed = String(env.APP_STORE_EXPORT_COMPLIANCE_CONFIRMED || '').toLowerCase() === 'true';
  const usesNonExemptEncryption = buildDetail?.attributes?.usesNonExemptEncryption;
  if (usesNonExemptEncryption !== false && !encryption?.id && !exportComplianceConfirmed) {
    blockers.push('missing export-compliance confirmation, attached encryption declaration, or usesNonExemptEncryption=false on the attached build');
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

async function submitReviewPackage({ app, version, reviewDetail, ageRating, build, buildDetail, reviewSubmissions }) {
  const blockers = [];
  if (!reviewDetail?.id) blockers.push('missing App Review detail');
  if (!ageRating?.id) blockers.push('missing age rating declaration');
  if (!build?.id) blockers.push('missing attached build');
  if (buildDetail?.attributes?.usesNonExemptEncryption !== false) {
    blockers.push('attached build does not declare usesNonExemptEncryption=false');
  }
  const reviewableVersionStates = new Set(['PREPARE_FOR_SUBMISSION', 'REJECTED']);
  if (!reviewableVersionStates.has(version.attributes?.appStoreState)) {
    blockers.push(
      `App Store version is ${version.attributes?.appStoreState || 'state unknown'}, not PREPARE_FOR_SUBMISSION or REJECTED`
    );
  }

  if (blockers.length) {
    console.log('Cannot create review submission package yet:');
    for (const blocker of blockers) console.log(`- ${blocker}`);
    process.exitCode = 2;
    return;
  }

  const activeReviewSubmission = selectReusableReviewSubmission(reviewSubmissions);

  let reviewSubmission = activeReviewSubmission || await createReviewSubmission(app.id);
  console.log(`Review submission: ${reviewSubmission.id}${activeReviewSubmission ? ' (existing draft)' : ' (created)'}`);

  await pruneReviewSubmissionItems(
    reviewSubmission.id,
    'appStoreVersion',
    'appStoreVersions',
    new Set()
  );
  try {
    await createReviewSubmissionItem(reviewSubmission.id, 'appStoreVersion', 'appStoreVersions', version.id);
  } catch (error) {
    const existingReviewSubmissionId = findConflictingReviewSubmissionId(error);
    if (!existingReviewSubmissionId || existingReviewSubmissionId === reviewSubmission.id) throw error;

    reviewSubmission = await getReviewSubmission(existingReviewSubmissionId);
    console.log(`Switching to existing review submission ${reviewSubmission.id} for app version ${version.id}.`);
    await pruneReviewSubmissionItems(
      reviewSubmission.id,
      'appStoreVersion',
      'appStoreVersions',
      new Set()
    );
    await createReviewSubmissionItem(reviewSubmission.id, 'appStoreVersion', 'appStoreVersions', version.id);
  }
  console.log(`Included app version ${version.attributes.versionString}.`);

  const group = await getSubscriptionGroup(app.id);
  const groupVersion = await getLatestVersionOrCreate({
    relationshipPath: `/v1/subscriptionGroups/${group.id}/versions?limit=20`,
    createPath: '/v1/subscriptionGroupVersions',
    createType: 'subscriptionGroupVersions',
    relationshipName: 'subscriptionGroup',
    relatedType: 'subscriptionGroups',
    relatedId: group.id
  });

  const subscriptions = await listSubscriptions(group.id);
  const subscriptionVersions = [];
  for (const productId of launchSubscriptionProductIds) {
    const subscription = subscriptions.find((candidate) => candidate.attributes?.productId === productId);
    if (!subscription) {
      throw new Error(`Subscription product not found in App Store Connect: ${productId}`);
    }

    const subscriptionVersion = await getLatestVersionOrCreate({
      relationshipPath: `/v1/subscriptions/${subscription.id}/versions?limit=20`,
      createPath: '/v1/subscriptionVersions',
      createType: 'subscriptionVersions',
      relationshipName: 'subscription',
      relatedType: 'subscriptions',
      relatedId: subscription.id
    });
    subscriptionVersions.push({ productId, version: subscriptionVersion });
  }

  await pruneReviewSubmissionItems(
    reviewSubmission.id,
    'subscriptionGroupVersion',
    'subscriptionGroupVersions',
    new Set([groupVersion.id])
  );
  await pruneReviewSubmissionItems(
    reviewSubmission.id,
    'subscriptionVersion',
    'subscriptionVersions',
    new Set(subscriptionVersions.map((entry) => entry.version.id))
  );

  await createReviewSubmissionItem(reviewSubmission.id, 'subscriptionGroupVersion', 'subscriptionGroupVersions', groupVersion.id);
  console.log(`Included subscription group ${group.attributes?.referenceName || group.id}.`);

  for (const { productId, version: subscriptionVersion } of subscriptionVersions) {
    await createReviewSubmissionItem(reviewSubmission.id, 'subscriptionVersion', 'subscriptionVersions', subscriptionVersion.id);
    console.log(`Included ${productId}.`);
  }

  await api(`/v1/reviewSubmissions/${reviewSubmission.id}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'reviewSubmissions',
        id: reviewSubmission.id,
        attributes: {
          submitted: true
        }
      }
    }
  });

  console.log(`Submitted review package ${reviewSubmission.id} for App Review.`);
}

function appReviewNotes() {
  return [
    'Forg3 is a secure e-signature app for PDF, Word, Excel, PowerPoint, and text documents. Review should sign in with the supplied email test account/code flow. Native Google/Apple provider buttons are hidden in this iOS build until those native provider bridges are enabled and real-device tested.',
    'To locate In-App Purchases: launch Forg3, sign in with the supplied review email/code account, complete device verification with the supplied code if prompted, tap Plans in the top bar, then review the Subscription section. Tap Forg3 Pro or Forg3 Business; the button opens the App Store sandbox purchase sheet.',
    `Terms of Use (EULA) is included in the App Store description: ${appleStandardEulaUrl}`,
    'The submitted Apple subscription product identifiers are com.forg3.sign.pro.monthly for Forg3 Pro and com.forg3.sign.business.monthly for Forg3 Business.',
    'New devices require device verification before account documents or recipient rooms open.',
    'A paid subscription is required before non-creator accounts can send signature requests. Recipients can sign assigned documents without a paid subscription.',
    'Account deletion is available in Account settings and permanently removes documents, files, devices, sessions, and account history.',
    'Forg3 creates electronic signature stamps and audit certificate pages; it does not claim notarization or CA-backed PAdES signatures unless a production certificate provider is configured.'
  ].join('\n\n');
}

function appStoreDescription() {
  return [
    'Forg3 is a secure e-signature app for sending PDF, Word, Excel, PowerPoint, text, RTF, and CSV documents to assigned recipients by email. Senders upload a document, choose the recipient, and Forg3 delivers an email link that only the addressed recipient can open after email and device verification.',
    'Completed signing packets are sealed into downloadable records with signature metadata, document hashes, timestamps, and an audit certificate page. Paid sender plans unlock signature requests while recipients can review and sign assigned documents without a paid sender subscription.',
    'Auto-renewable subscriptions are available for Forg3 Pro Monthly and Forg3 Business Monthly. Payment is charged to your Apple ID account at confirmation of purchase. Subscriptions renew automatically unless canceled at least 24 hours before the end of the current period. You can manage or cancel subscriptions in your App Store account settings.',
    `Terms of Use (EULA): ${appleStandardEulaUrl}`,
    `Forg3 Terms: ${appStoreTermsUrl}`,
    `Privacy Policy: ${appStorePrivacyUrl}`
  ].join('\n\n');
}

function printStatus({
  app,
  version,
  localization,
  reviewDetail,
  ageRating,
  submission,
  build,
  buildDetail,
  appInfo,
  primaryCategory,
  encryption,
  manualAppPrices,
  reviewSubmissions
}) {
  console.log(`App: ${app.attributes.name} (${app.id}) bundle=${bundleId}`);
  console.log(`Version: ${version.attributes.versionString} state=${version.attributes.appStoreState}`);
  console.log(`Localization: ${localization?.attributes?.locale || 'missing'} (${localization?.id || 'none'})`);
  console.log(`App info: ${appInfo?.id || 'none'}`);
  console.log(`Content rights declaration: ${app.attributes.contentRightsDeclaration || 'missing'}`);
  console.log(`Primary category: ${primaryCategory?.id || 'missing'}`);
  console.log(`Copyright: ${version.attributes.copyright || 'missing'}`);
  console.log(`App pricing: ${formatAppPricing(manualAppPrices)}`);
  console.log(`Build: ${build?.attributes?.version || build?.id || 'none'} (${build?.id || 'none'})`);
  const usesNonExemptEncryption = buildDetail?.attributes?.usesNonExemptEncryption;
  console.log(`Build uses non-exempt encryption: ${usesNonExemptEncryption === undefined ? 'missing/unknown' : usesNonExemptEncryption}`);
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
  console.log(`Encryption declaration on attached build: ${encryption?.id || (usesNonExemptEncryption === false ? 'none required' : 'missing/unknown')}`);
  console.log(`Submission: ${submission?.id || 'not submitted'}${submission?.attributes?.state ? ` state=${submission.attributes.state}` : ''}`);
  console.log(`Review submissions: ${reviewSubmissions.length ? reviewSubmissions.map(formatReviewSubmission).join(', ') : 'none'}`);
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

async function getSubscriptionGroup(appId) {
  const response = await api(`/v1/apps/${appId}/subscriptionGroups?limit=50`);
  const group = response.data?.find((candidate) => candidate.attributes?.referenceName === 'Forg3 Plans') || response.data?.[0];

  if (!group) {
    throw new Error('No App Store subscription group found.');
  }

  return group;
}

async function listSubscriptions(groupId) {
  const response = await api(`/v1/subscriptionGroups/${groupId}/subscriptions?limit=50`);
  return response.data || [];
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

async function getBuild(buildId) {
  const response = await api(`/v1/builds/${buildId}`);
  return response.data || null;
}

async function listManualAppPrices(appId) {
  try {
    const response = await api(`/v1/appPriceSchedules/${appId}/manualPrices?limit=20&include=appPricePoint`);
    return response.data || [];
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

async function listReviewSubmissions(appId) {
  const response = await api(`/v1/reviewSubmissions?filter[app]=${appId}&limit=20`);
  return response.data || [];
}

function selectReusableReviewSubmission(reviewSubmissions) {
  const statePriority = new Map([
    ['UNRESOLVED_ISSUES', 0],
    ['READY_FOR_REVIEW', 1]
  ]);

  return reviewSubmissions
    .filter((candidate) => {
      const attributes = candidate.attributes || {};
      return statePriority.has(attributes.state) && !attributes.submitted && !attributes.canceled;
    })
    .sort((a, b) => {
      const aPriority = statePriority.get(a.attributes?.state) ?? 99;
      const bPriority = statePriority.get(b.attributes?.state) ?? 99;
      return aPriority - bPriority;
    })[0] || null;
}

async function getReviewSubmission(reviewSubmissionId) {
  const response = await api(`/v1/reviewSubmissions/${reviewSubmissionId}`);
  return response.data;
}

async function createReviewSubmission(appId) {
  const response = await api('/v1/reviewSubmissions', {
    method: 'POST',
    body: {
      data: {
        type: 'reviewSubmissions',
        attributes: {
          platform: 'IOS'
        },
        relationships: {
          app: {
            data: {
              type: 'apps',
              id: appId
            }
          }
        }
      }
    }
  });

  return response.data;
}

async function ensureFreeAppPricing(appId, manualAppPrices) {
  const hasCurrentManualPrice = manualAppPrices.some((price) => {
    const attributes = price.attributes || {};
    return attributes.manual && attributes.startDate === null && attributes.endDate === null;
  });

  if (hasCurrentManualPrice) {
    console.log('App pricing already has a current manual price.');
    return;
  }

  const pricePoint = await getFreeAppPricePoint(appId, appStoreBaseTerritory);
  const localPriceId = '${free-current-price}';
  await api('/v1/appPriceSchedules', {
    method: 'POST',
    body: {
      data: {
        type: 'appPriceSchedules',
        relationships: {
          app: {
            data: {
              type: 'apps',
              id: appId
            }
          },
          baseTerritory: {
            data: {
              type: 'territories',
              id: appStoreBaseTerritory
            }
          },
          manualPrices: {
            data: [
              {
                type: 'appPrices',
                id: localPriceId
              }
            ]
          }
        }
      },
      included: [
        {
          type: 'appPrices',
          id: localPriceId,
          relationships: {
            appPricePoint: {
              data: {
                type: 'appPricePoints',
                id: pricePoint.id
              }
            }
          }
        }
      ]
    }
  });

  console.log(`Configured app download pricing as free in ${appStoreBaseTerritory}.`);
}

async function getFreeAppPricePoint(appId, territoryId) {
  const response = await api(`/v1/apps/${appId}/appPricePoints?filter[territory]=${territoryId}&limit=200`);
  const pricePoint = (response.data || []).find((candidate) => Number(candidate.attributes?.customerPrice) === 0);
  if (!pricePoint) {
    throw new Error(`No free app price point found for territory ${territoryId}.`);
  }

  return pricePoint;
}

async function getLatestVersionOrCreate({ relationshipPath, createPath, createType, relationshipName, relatedType, relatedId }) {
  const existing = await api(relationshipPath);
  const usable = (existing.data || []).find((version) => version.attributes?.state === 'PREPARE_FOR_SUBMISSION');
  if (usable) return usable;

  try {
    const response = await api(createPath, {
      method: 'POST',
      body: {
        data: {
          type: createType,
          relationships: {
            [relationshipName]: {
              data: {
                type: relatedType,
                id: relatedId
              }
            }
          }
        }
      }
    });

    return response.data;
  } catch (error) {
    const alreadyExists = error.status === 409 &&
      error.body?.errors?.some((entry) => entry.code === 'STATE_ERROR.ALREADY_EXISTS');
    if (alreadyExists && existing.data?.[0]) {
      return existing.data[0];
    }
    throw error;
  }
}

async function pruneReviewSubmissionItems(reviewSubmissionId, relationshipName, relatedType, keepIds) {
  const response = await api(
    `/v1/reviewSubmissions/${reviewSubmissionId}/items?limit=50&include=appStoreVersion,subscriptionVersion,subscriptionGroupVersion`
  );

  for (const item of response.data || []) {
    const related = item.relationships?.[relationshipName]?.data;
    if (related?.type !== relatedType || keepIds.has(related.id)) continue;

    await api(`/v1/reviewSubmissionItems/${item.id}`, { method: 'DELETE' });
    console.log(`Removed stale review item: ${relatedType}/${related.id}`);
  }
}

async function createReviewSubmissionItem(reviewSubmissionId, relationshipName, relatedType, relatedId) {
  if (await reviewSubmissionHasItem(reviewSubmissionId, relationshipName, relatedType, relatedId)) {
    console.log(`Review item already present: ${relatedType}/${relatedId}`);
    return;
  }

  try {
    await api('/v1/reviewSubmissionItems', {
      method: 'POST',
      body: {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: {
              data: {
                type: 'reviewSubmissions',
                id: reviewSubmissionId
              }
            },
            [relationshipName]: {
              data: {
                type: relatedType,
                id: relatedId
              }
            }
          }
        }
      }
    });
  } catch (error) {
    if (
      error.status === 409 &&
      await reviewSubmissionHasItem(reviewSubmissionId, relationshipName, relatedType, relatedId)
    ) {
      console.log(`Review item already present: ${relatedType}/${relatedId}`);
      return;
    }
    throw error;
  }
}

async function reviewSubmissionHasItem(reviewSubmissionId, relationshipName, relatedType, relatedId) {
  const response = await api(
    `/v1/reviewSubmissions/${reviewSubmissionId}/items?limit=50&include=appStoreVersion,subscriptionVersion,subscriptionGroupVersion`
  );

  return (response.data || []).some((item) => {
    const related = item.relationships?.[relationshipName]?.data;
    return related?.type === relatedType && related?.id === relatedId;
  });
}

function findConflictingReviewSubmissionId(error) {
  if (error?.status !== 409 || !error.body) return null;

  const match = JSON.stringify(error.body).match(/reviewSubmission with id ([0-9a-f-]+)/i);
  return match?.[1] || null;
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
    const error = new Error(
      `${options.method || 'GET'} ${pathname} failed (${response.status}): ${JSON.stringify(body).slice(0, 3000)}`
    );
    error.status = response.status;
    error.body = body;
    error.pathname = pathname;
    error.method = options.method || 'GET';
    throw error;
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

function formatReviewSubmission(reviewSubmission) {
  const attributes = reviewSubmission.attributes || {};
  return `${reviewSubmission.id}:${attributes.state || 'state?'}:submitted=${attributes.submitted ? 'true' : 'false'}`;
}

function formatAppPricing(manualAppPrices) {
  if (!manualAppPrices.length) return 'missing';
  const current = manualAppPrices.find((price) => {
    const attributes = price.attributes || {};
    return attributes.manual && attributes.startDate === null && attributes.endDate === null;
  });
  if (!current) return `${manualAppPrices.length} manual price(s), no current price`;
  const pricePointId = current.relationships?.appPricePoint?.data?.id || 'unknown price point';
  return `current manual price (${pricePointId})`;
}
