import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = 'https://api.appstoreconnect.apple.com';
const env = loadEnvFiles(['.env', '.env.local', '.env.production', '.env.production.local']);
const stateDir = path.join(rootDir, '.deploy', 'store-review-monitor');
const latestPath = path.join(stateDir, 'latest.json');
const historyPath = path.join(stateDir, 'history.jsonl');
const approvedMarkerPath = path.join(stateDir, 'approved.json');
const force = process.argv.includes('--force');

const appleBundleId = readEnv('APPLE_APP_STORE_BUNDLE_ID') || 'com.forg3.sign';
const appleVersionString = readEnv('APP_STORE_VERSION') || '1.0';
const appleRequiredProductIds = readList(
  'APPLE_STORE_MONITOR_REQUIRED_PRODUCT_IDS',
  ['com.forg3.sign.pro.monthly', 'com.forg3.sign.business.monthly']
);
const googlePackageName = readEnv('GOOGLE_PLAY_PACKAGE_NAME') || 'com.forg3.sign';
const googleRequiredProducts = readGoogleProducts();
const googleMonitorTracks = readList('GOOGLE_PLAY_MONITOR_TRACKS', ['internal', 'alpha', 'beta', 'production']);
const requireGoogleProduction = readBool('GOOGLE_PLAY_MONITOR_REQUIRE_PRODUCTION', true);
const notifyEnabled = readBool('FORG3_STORE_MONITOR_NOTIFY', true);

const appleApprovedStates = new Set([
  'APPROVED',
  'PENDING_APPLE_RELEASE',
  'PENDING_DEVELOPER_RELEASE',
  'PROCESSING_FOR_APP_STORE',
  'READY_FOR_DISTRIBUTION',
  'READY_FOR_SALE'
]);
const appleActionStates = new Set([
  'DEVELOPER_REJECTED',
  'INVALID_BINARY',
  'METADATA_REJECTED',
  'REJECTED',
  'REMOVED_FROM_SALE',
  'DEVELOPER_REMOVED_FROM_SALE',
  'WAITING_FOR_EXPORT_COMPLIANCE'
]);
const appleProductApprovedStates = new Set(['APPROVED', 'READY_FOR_SALE']);
const appleProductActionStates = new Set([
  'DEVELOPER_ACTION_NEEDED',
  'MISSING_METADATA',
  'READY_TO_SUBMIT',
  'REJECTED'
]);
const appleBetaActionStates = new Set([
  'BETA_REJECTED',
  'EXPIRED',
  'INVALID_BINARY',
  'MISSING_EXPORT_COMPLIANCE',
  'PROCESSING_EXCEPTION',
  'REJECTED'
]);
const googleProductionLiveStates = new Set(['completed', 'inProgress']);
const googleTrackActionStates = new Set(['draft', 'halted']);

await main();

async function main() {
  ensureStateDir();

  if (fs.existsSync(approvedMarkerPath) && !force && !readBool('FORG3_STORE_MONITOR_CONTINUE_AFTER_APPROVAL', false)) {
    const approved = JSON.parse(fs.readFileSync(approvedMarkerPath, 'utf8'));
    console.log(`Forg3 store review monitor is complete. Approved at ${approved.checkedAt}.`);
    console.log(`Remove ${path.relative(rootDir, approvedMarkerPath)} or run with --force to check again.`);
    return;
  }

  const result = {
    checkedAt: new Date().toISOString(),
    ok: false,
    approved: false,
    issues: [],
    warnings: [],
    platforms: {}
  };

  await runCheck(result, 'apple', checkApple);
  await runCheck(result, 'google', checkGooglePlay);

  result.approved = Boolean(result.platforms.apple?.approved && result.platforms.google?.approved);
  result.ok = result.issues.length === 0;

  writeJson(latestPath, result);
  appendJsonLine(historyPath, result);
  printResult(result);

  if (result.approved) {
    writeJson(approvedMarkerPath, result);
    notify('Forg3 store review approved', 'Apple and Google Play both report approved or live status.');
  } else if (result.issues.length) {
    notify('Forg3 store review needs action', summarizeIssues(result.issues));
  }

  process.exitCode = result.issues.some((issue) => issue.severity === 'error') ? 1 : result.issues.length ? 2 : 0;
}

async function runCheck(result, platform, fn) {
  try {
    result.platforms[platform] = await fn(result);
  } catch (error) {
    addIssue(result, platform, 'Store status check failed.', error instanceof Error ? error.message : String(error), 'error');
    result.platforms[platform] = { ok: false, approved: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkApple(result) {
  const credential = loadAppleCredential();
  const app = await appleApi(credential, `/v1/apps?filter[bundleId]=${encodeURIComponent(appleBundleId)}`);
  const appRecord = app.data?.[0];
  if (!appRecord?.id) {
    throw new Error(`App Store Connect app not found for bundle ${appleBundleId}.`);
  }

  const versionResponse = await appleApi(
    credential,
    `/v1/apps/${appRecord.id}/appStoreVersions?filter[platform]=IOS&limit=20`
  );
  const version =
    versionResponse.data?.find((candidate) => candidate.attributes?.versionString === appleVersionString) ||
    versionResponse.data?.[0];
  if (!version?.id) {
    throw new Error(`No iOS App Store version found for ${appleVersionString}.`);
  }

  const [
    appInfo,
    localization,
    reviewDetail,
    ageRating,
    primaryCategory,
    submission,
    build,
    reviewSubmissions,
    manualAppPrices,
    subscriptionGroup
  ] = await Promise.all([
    firstAppleOrNull(credential, `/v1/apps/${appRecord.id}/appInfos?limit=10`),
    firstAppleOrNull(credential, `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=10`),
    appleRelationshipOrNull(credential, `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`),
    firstAppleAppInfoRelationshipOrNull(credential, appRecord.id, 'ageRatingDeclaration'),
    firstAppleAppInfoRelationshipOrNull(credential, appRecord.id, 'primaryCategory'),
    appleRelationshipOrNull(credential, `/v1/appStoreVersions/${version.id}/appStoreVersionSubmission`),
    appleRelationshipOrNull(credential, `/v1/appStoreVersions/${version.id}/build`),
    listAppleReviewSubmissions(credential, appRecord.id),
    listAppleManualAppPrices(credential, appRecord.id),
    firstAppleOrNull(credential, `/v1/apps/${appRecord.id}/subscriptionGroups?limit=50`)
  ]);

  const [buildDetail, encryption] = build?.id
    ? await Promise.all([
        appleApi(credential, `/v1/builds/${build.id}`),
        appleRelationshipOrNull(credential, `/v1/builds/${build.id}/appEncryptionDeclaration`)
      ])
    : [null, null];
  const [betaDetail, betaReviewSubmission] = build?.id
    ? await Promise.all([
        optionalAppleRelationshipOrNull(credential, `/v1/builds/${build.id}/buildBetaDetail`, result, 'TestFlight build beta detail'),
        optionalAppleRelationshipOrNull(
          credential,
          `/v1/builds/${build.id}/betaAppReviewSubmission`,
          result,
          'TestFlight beta app review submission'
        )
      ])
    : [null, null];
  const subscriptions = subscriptionGroup?.id ? await listAppleSubscriptions(credential, subscriptionGroup.id) : [];
  const productSummaries = await Promise.all(
    subscriptions
      .filter((subscription) => appleRequiredProductIds.includes(subscription.attributes?.productId))
      .map((subscription) => summarizeAppleSubscription(credential, subscription))
  );

  const appState = version.attributes?.appStoreState || 'UNKNOWN';
  const usesNonExemptEncryption = buildDetail?.data?.attributes?.usesNonExemptEncryption;
  const currentManualPrice = manualAppPrices.some((price) => {
    const attributes = price.attributes || {};
    return attributes.manual && attributes.startDate === null && attributes.endDate === null;
  });

  const status = {
    ok: true,
    approved: appleApprovedStates.has(appState),
    app: {
      id: appRecord.id,
      name: appRecord.attributes?.name || '',
      bundleId: appleBundleId,
      contentRightsDeclaration: appRecord.attributes?.contentRightsDeclaration || ''
    },
    version: {
      id: version.id,
      versionString: version.attributes?.versionString || '',
      appStoreState: appState
    },
    build: {
      id: build?.id || '',
      number: build?.attributes?.version || '',
      processingState: buildDetail?.data?.attributes?.processingState || '',
      usesNonExemptEncryption,
      encryptionDeclarationId: encryption?.id || ''
    },
    testFlight: {
      buildBetaDetailId: betaDetail?.id || '',
      internalBuildState: betaDetail?.attributes?.internalBuildState || '',
      externalBuildState: betaDetail?.attributes?.externalBuildState || '',
      betaReviewSubmissionId: betaReviewSubmission?.id || '',
      betaReviewState:
        betaReviewSubmission?.attributes?.betaReviewState ||
        betaReviewSubmission?.attributes?.state ||
        ''
    },
    submission: {
      id: submission?.id || '',
      state: submission?.attributes?.state || ''
    },
    reviewSubmissions: reviewSubmissions.map((reviewSubmission) => ({
      id: reviewSubmission.id,
      state: reviewSubmission.attributes?.state || '',
      submitted: Boolean(reviewSubmission.attributes?.submitted)
    })),
    metadata: {
      localization: localization?.attributes?.locale || '',
      reviewDetail: reviewDetail?.id || '',
      ageRating: ageRating?.id || '',
      primaryCategory: primaryCategory?.id || '',
      currentManualPrice
    },
    products: productSummaries
  };

  if (appleActionStates.has(appState)) {
    addIssue(
      result,
      'apple',
      `App Store version ${status.version.versionString} is ${appState}.`,
      'Open App Store Connect resolution details, fix the flagged metadata/binary issue, and resubmit the review package.'
    );
  }
  if (!build?.id) {
    addIssue(result, 'apple', 'No build is attached to the App Store version.', 'Attach the latest valid iOS build and resubmit.');
  }
  if (buildDetail?.data?.attributes?.processingState && buildDetail.data.attributes.processingState !== 'VALID') {
    addIssue(
      result,
      'apple',
      `Attached iOS build processing state is ${buildDetail.data.attributes.processingState}.`,
      'Wait for processing if pending, or upload a corrected build if processing failed.'
    );
  }
  if (usesNonExemptEncryption !== false && !encryption?.id) {
    addIssue(
      result,
      'apple',
      'Attached iOS build does not have a resolved export-compliance answer.',
      'Set usesNonExemptEncryption=false or attach the correct encryption declaration.'
    );
  }
  for (const [label, state] of Object.entries({
    internalBuildState: status.testFlight.internalBuildState,
    externalBuildState: status.testFlight.externalBuildState,
    betaReviewState: status.testFlight.betaReviewState
  })) {
    if (isAppleBetaActionState(state)) {
      addIssue(
        result,
        'apple',
        `TestFlight ${label} is ${state}.`,
        'Inspect TestFlight build review details, fix the flagged issue, and resubmit the build if needed.'
      );
    }
  }
  if (!reviewDetail?.id) addIssue(result, 'apple', 'App Review detail is missing.', 'Configure review contact, notes, and demo account.');
  if (!ageRating?.id) addIssue(result, 'apple', 'Age rating declaration is missing.', 'Complete the age rating declaration.');
  if (!primaryCategory?.id) addIssue(result, 'apple', 'Primary category is missing.', 'Set the App Store primary category.');
  if (!currentManualPrice) addIssue(result, 'apple', 'Current App Store app price is missing.', 'Configure the app download price.');
  if (!subscriptionGroup?.id) {
    addIssue(result, 'apple', 'Apple subscription group is missing.', 'Create or restore the Forg3 Plans subscription group.');
  }

  for (const productId of appleRequiredProductIds) {
    const product = status.products.find((candidate) => candidate.productId === productId);
    if (!product) {
      addIssue(result, 'apple', `Required Apple subscription is missing: ${productId}.`, 'Create/configure the required subscription.');
      continue;
    }
    if (appleProductActionStates.has(product.state)) {
      addIssue(
        result,
        'apple',
        `Required Apple subscription ${productId} is ${product.state}.`,
        'Fix the subscription metadata/review issue and include it in the next review submission.'
      );
    }
    if (product.priceCount === 0) {
      addIssue(result, 'apple', `Required Apple subscription ${productId} has no prices.`, 'Configure subscription prices.');
    }
    if (!product.reviewScreenshotState || product.reviewScreenshotState === 'missing') {
      addIssue(
        result,
        'apple',
        `Required Apple subscription ${productId} is missing its review screenshot.`,
        'Upload the subscription review screenshot and resubmit.'
      );
    }
  }

  status.approved =
    status.approved &&
    appleRequiredProductIds.every((productId) => {
      const product = status.products.find((candidate) => candidate.productId === productId);
      return product && appleProductApprovedStates.has(product.state);
    });

  return status;
}

async function checkGooglePlay(result) {
  const accessToken = await getGooglePlayAccessToken();
  const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    googlePackageName
  )}`;
  const edit = await googleApi(accessToken, `${baseUrl}/edits`, { method: 'POST', body: {} });
  const editId = edit.id;

  try {
    const [tracks, testers, listings, images, subscriptions] = await Promise.all([
      Promise.all(googleMonitorTracks.map((track) => getGoogleTrack(accessToken, baseUrl, editId, track))),
      Promise.all(['internal', 'alpha', 'beta'].map((track) => getGoogleTesters(accessToken, baseUrl, editId, track))),
      googleApi(accessToken, `${baseUrl}/edits/${encodeURIComponent(editId)}/listings`, { allowEmpty: true }),
      getGoogleListingImages(accessToken, baseUrl, editId),
      googleApi(accessToken, `${baseUrl}/subscriptions`, { allowEmpty: true })
    ]);

    const trackSummaries = tracks.map((track) => ({
      track: track.track,
      releases: (track.releases || []).map((release) => ({
        name: release.name || '',
        status: release.status || '',
        versionCodes: release.versionCodes || [],
        userFraction: release.userFraction ?? null
      }))
    }));
    const production = trackSummaries.find((track) => track.track === 'production');
    const productionLive = Boolean(
      production?.releases?.some((release) => googleProductionLiveStates.has(release.status))
    );
    const internal = trackSummaries.find((track) => track.track === 'internal');
    const productionAccessTestingTracks = trackSummaries.filter(
      (track) => !['internal', 'production'].includes(track.track)
    );
    const productionAccessTestingLive = productionAccessTestingTracks
      .some((track) => track.releases.some((release) => googleProductionLiveStates.has(release.status)));
    const productSummaries = (subscriptions.subscriptions || []).map((subscription) => ({
      productId: subscription.productId,
      basePlans: (subscription.basePlans || []).map((plan) => ({
        basePlanId: plan.basePlanId,
        state: plan.state,
        availableRegions: (plan.regionalConfigs || []).filter((entry) => entry.newSubscriberAvailability).length,
        unavailableRegions: (plan.regionalConfigs || []).filter((entry) => !entry.newSubscriberAvailability).length,
        otherRegionsAvailable: Boolean(plan.otherRegionsConfig?.newSubscriberAvailability)
      }))
    }));
    const listingSummaries = (listings.listings || []).map((listing) => ({
      language: listing.language,
      title: listing.title || '',
      shortDescription: Boolean(listing.shortDescription),
      fullDescription: Boolean(listing.fullDescription)
    }));

    const status = {
      ok: true,
      approved: !requireGoogleProduction || productionLive,
      packageName: googlePackageName,
      tracks: trackSummaries,
      testers: testers.map((entry) => ({
        track: entry.track,
        googleGroups: entry.googleGroups || []
      })),
      listings: listingSummaries,
      images,
      products: productSummaries,
      limitation:
        'The Android Publisher API does not expose every Play Console policy-center notice or closed-test opt-in count.'
    };

    if (!internal?.releases?.length && !productionLive) {
      addIssue(
        result,
        'google',
        'Google Play has no internal or production release visible through the Publishing API.',
        'Upload a signed AAB to a testing track or production track.'
      );
    }
    for (const track of trackSummaries) {
      for (const release of track.releases) {
        if (googleTrackActionStates.has(release.status)) {
          addIssue(
            result,
            'google',
            `Google Play ${track.track} release ${release.name || release.versionCodes.join(',')} is ${release.status}.`,
            'Inspect the Play Console release, fix the blocked rollout, and submit again.'
          );
        }
      }
    }
    if (requireGoogleProduction && !productionLive) {
      if (!productionAccessTestingLive) {
        addIssue(
          result,
          'google',
          'Google Play has no live closed/open testing release visible through the Publishing API.',
          'Move the current signed AAB to a closed testing track, attach eligible testers, enroll at least 12 opted-in testers for 14 days, then apply for production access in Play Console.'
        );
      }
      addIssue(
        result,
        'google',
        'Google Play production track has no live release yet.',
        productionAccessTestingLive
          ? 'Closed/open testing is live. Keep at least 12 testers opted in continuously for 14 days, then apply for production access and submit the production release.'
          : 'When the closed-test/production-access gate is eligible, apply for production access and submit the production release.'
      );
    }

    const enUsListing = listingSummaries.find((listing) => listing.language === 'en-US');
    if (!enUsListing?.title || !enUsListing.shortDescription || !enUsListing.fullDescription) {
      addIssue(
        result,
        'google',
        'Google Play en-US store listing is incomplete.',
        'Complete the title, short description, and full description in Play Console.'
      );
    }

    for (const image of images) {
      if (image.count < image.required) {
        addIssue(
          result,
          'google',
          `Google Play ${image.imageType} count is ${image.count}; expected at least ${image.required}.`,
          'Upload the missing Play listing graphic assets and submit the store listing.'
        );
      }
    }

    for (const required of googleRequiredProducts) {
      const product = productSummaries.find((candidate) => candidate.productId === required.productId);
      const basePlan = product?.basePlans.find((candidate) => candidate.basePlanId === required.basePlanId);
      if (basePlan?.state !== 'ACTIVE') {
        addIssue(
          result,
          'google',
          `Google Play subscription ${required.productId}/${required.basePlanId} is not ACTIVE.`,
          'Activate or fix the required Play Billing subscription base plan.'
        );
      }
    }

    const tracksWithoutApiGroups = status.testers
      .filter((entry) => entry.googleGroups.length === 0)
      .map((entry) => entry.track);
    if (tracksWithoutApiGroups.length) {
      result.warnings.push({
        platform: 'google',
        message: `Google testers API reports no Google Groups for ${tracksWithoutApiGroups.join(
          ', '
        )}; Play Console email lists are UI-only, so verify tester counts there.`
      });
    }

    return status;
  } finally {
    await googleApi(accessToken, `${baseUrl}/edits/${encodeURIComponent(editId)}`, { method: 'DELETE', allowEmpty: true }).catch(
      () => {}
    );
  }
}

async function summarizeAppleSubscription(credential, subscription) {
  const [prices, screenshot] = await Promise.all([
    appleApi(credential, `/v1/subscriptions/${subscription.id}/prices?limit=200`),
    appleApi(credential, `/v1/subscriptions/${subscription.id}/appStoreReviewScreenshot`).catch((error) => {
      if (error.status === 404) return { data: null };
      throw error;
    })
  ]);

  return {
    productId: subscription.attributes?.productId || '',
    state: subscription.attributes?.state || '',
    priceCount: prices.data?.length || 0,
    reviewScreenshotState: screenshot.data?.attributes?.assetDeliveryState?.state || (screenshot.data?.id ? 'uploaded' : 'missing')
  };
}

async function listAppleSubscriptions(credential, groupId) {
  const response = await appleApi(credential, `/v1/subscriptionGroups/${groupId}/subscriptions?limit=50`);
  return response.data || [];
}

async function listAppleReviewSubmissions(credential, appId) {
  const response = await appleApi(credential, `/v1/reviewSubmissions?filter[app]=${appId}&limit=20`);
  return response.data || [];
}

async function listAppleManualAppPrices(credential, appId) {
  try {
    const response = await appleApi(credential, `/v1/appPriceSchedules/${appId}/manualPrices?limit=20&include=appPricePoint`);
    return response.data || [];
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

async function firstAppleAppInfoRelationshipOrNull(credential, appId, relationship) {
  const appInfo = await firstAppleOrNull(credential, `/v1/apps/${appId}/appInfos?limit=10`);
  if (!appInfo?.id) return null;
  return appleRelationshipOrNull(credential, `/v1/appInfos/${appInfo.id}/${relationship}`);
}

async function firstAppleOrNull(credential, pathname) {
  const response = await appleApi(credential, pathname);
  return response.data?.[0] || null;
}

async function appleRelationshipOrNull(credential, pathname) {
  try {
    const response = await appleApi(credential, pathname);
    if (Array.isArray(response.data)) return response.data[0] || null;
    return response.data || null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function optionalAppleRelationshipOrNull(credential, pathname, result, label) {
  try {
    return await appleRelationshipOrNull(credential, pathname);
  } catch (error) {
    result.warnings.push({
      platform: 'apple',
      message: `${label} could not be checked: ${error instanceof Error ? error.message : String(error)}`
    });
    return null;
  }
}

async function appleApi(credential, pathname, options = {}) {
  const maxAttempts = options.maxAttempts || 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${apiBase}${pathname}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${createAppleJwt(credential)}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await parseJsonResponse(response);

    if (response.ok) {
      return body;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      await delay(attempt * 1500);
      continue;
    }

    const error = new Error(
      `${options.method || 'GET'} ${pathname} failed (${response.status}): ${JSON.stringify(body).slice(0, 1200)}`
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }

  throw new Error(`${options.method || 'GET'} ${pathname} failed after ${maxAttempts} attempts.`);
}

function createAppleJwt(credential) {
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

function loadAppleCredential() {
  const issuerId = readEnv('APPLE_APP_STORE_ISSUER_ID');
  const keyId = readEnv('APPLE_APP_STORE_KEY_ID');
  const inlineKey =
    readEnv('APPLE_APP_STORE_PRIVATE_KEY') ||
    (readEnv('APPLE_APP_STORE_PRIVATE_KEY_BASE64')
      ? Buffer.from(readEnv('APPLE_APP_STORE_PRIVATE_KEY_BASE64'), 'base64').toString('utf8')
      : '');
  const keyFile = readEnv('APPLE_APP_STORE_PRIVATE_KEY_FILE') || readEnv('APPLE_APP_STORE_PRIVATE_KEY_PATH') || '';
  const privateKey = inlineKey || (keyFile ? fs.readFileSync(resolveFromRoot(keyFile), 'utf8') : '');

  if (!issuerId || !keyId || !privateKey) {
    throw new Error('Set APPLE_APP_STORE_ISSUER_ID, APPLE_APP_STORE_KEY_ID, and an Apple private key source.');
  }

  return { issuerId, keyId, privateKey };
}

async function getGoogleTrack(accessToken, baseUrl, editId, track) {
  const response = await googleApi(accessToken, `${baseUrl}/edits/${encodeURIComponent(editId)}/tracks/${track}`, {
    allow404: true
  });
  return response ? { track, ...response } : { track, releases: [] };
}

async function getGoogleTesters(accessToken, baseUrl, editId, track) {
  const response = await googleApi(accessToken, `${baseUrl}/edits/${encodeURIComponent(editId)}/testers/${track}`, {
    allow404: true
  });
  return response ? { track, ...response } : { track, googleGroups: [] };
}

async function getGoogleListingImages(accessToken, baseUrl, editId) {
  const expected = [
    { imageType: 'phoneScreenshots', required: Number(readEnv('GOOGLE_PLAY_REQUIRED_PHONE_SCREENSHOTS') || 8) },
    { imageType: 'sevenInchScreenshots', required: Number(readEnv('GOOGLE_PLAY_REQUIRED_7IN_SCREENSHOTS') || 8) },
    { imageType: 'tenInchScreenshots', required: Number(readEnv('GOOGLE_PLAY_REQUIRED_10IN_SCREENSHOTS') || 8) },
    { imageType: 'featureGraphic', required: 1 },
    { imageType: 'icon', required: 1 }
  ];
  const images = [];

  for (const item of expected) {
    const response = await googleApi(
      accessToken,
      `${baseUrl}/edits/${encodeURIComponent(editId)}/listings/en-US/${item.imageType}`,
      { allow404: true, allowEmpty: true }
    );
    images.push({ imageType: item.imageType, count: response?.images?.length || 0, required: item.required });
  }

  return images;
}

async function googleApi(accessToken, url, options = {}) {
  const response = await fetch(String(url), {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 404 && options.allow404) return null;
  if (response.status === 204 && options.allowEmpty) return {};

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Google Play API returned ${response.status}`);
    error.status = response.status;
    error.body = payload;
    throw error;
  }

  return payload;
}

async function getGooglePlayAccessToken() {
  const serviceAccount = readGoogleServiceAccount();
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error('Google Play service account JSON is missing client_email or private_key.');
  }

  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const encodedPayload = base64UrlJson({
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
  if (rawJson) return JSON.parse(rawJson);

  const rawBase64 = readEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64');
  if (rawBase64) return JSON.parse(Buffer.from(rawBase64, 'base64').toString('utf8'));

  const credentialsPath = readEnv('GOOGLE_APPLICATION_CREDENTIALS');
  if (credentialsPath && fs.existsSync(resolveFromRoot(credentialsPath))) {
    return JSON.parse(fs.readFileSync(resolveFromRoot(credentialsPath), 'utf8'));
  }

  return null;
}

function readGoogleProducts() {
  const configured = readEnv('GOOGLE_PLAY_MONITOR_REQUIRED_PRODUCTS');
  if (configured) {
    return configured.split(',').map((entry) => {
      const [productId, basePlanId = 'monthly'] = entry.trim().split('/');
      return { productId, basePlanId };
    });
  }

  return [
    { productId: 'forg3_pro_monthly', basePlanId: 'monthly' },
    { productId: 'forg3_business_monthly', basePlanId: 'monthly' }
  ];
}

function addIssue(result, platform, message, action, severity = 'action') {
  result.issues.push({ platform, severity, message, action });
}

function printResult(result) {
  console.log(`Forg3 store review monitor checked ${result.checkedAt}`);

  const apple = result.platforms.apple;
  if (apple) {
    console.log(
      `Apple: ${apple.version?.versionString || 'unknown'} ${apple.version?.appStoreState || 'unknown'}; build ${
        apple.build?.number || 'none'
      }; TestFlight ${formatTestFlight(apple.testFlight)}; products ${formatProducts(apple.products || [])}`
    );
  }

  const google = result.platforms.google;
  if (google) {
    console.log(`Google: ${formatGoogleTracks(google.tracks || [])}; products ${formatGoogleProducts(google.products || [])}`);
  }

  if (result.issues.length) {
    console.log('Issues/action items:');
    for (const issue of result.issues) {
      console.log(`- [${issue.platform}] ${issue.message} ${issue.action}`);
    }
  } else if (result.approved) {
    console.log('Approved: Apple and Google Play both report approved/live status.');
  } else {
    console.log('No blocking issues found. Review is still pending or in progress.');
  }

  if (result.warnings.length) {
    console.log('Warnings:');
    for (const warning of result.warnings) {
      console.log(`- [${warning.platform}] ${warning.message}`);
    }
  }

  console.log(`Latest JSON: ${path.relative(rootDir, latestPath)}`);
  console.log(`History JSONL: ${path.relative(rootDir, historyPath)}`);
}

function formatProducts(products) {
  if (!products.length) return 'none';
  return products.map((product) => `${product.productId}:${product.state}`).join(', ');
}

function formatTestFlight(testFlight) {
  if (!testFlight?.buildBetaDetailId) return 'not exposed';
  const states = [
    testFlight.internalBuildState ? `internal=${testFlight.internalBuildState}` : '',
    testFlight.externalBuildState ? `external=${testFlight.externalBuildState}` : '',
    testFlight.betaReviewState ? `betaReview=${testFlight.betaReviewState}` : ''
  ].filter(Boolean);
  return states.length ? states.join('/') : 'available';
}

function formatGoogleProducts(products) {
  if (!products.length) return 'none';
  return products
    .map((product) => {
      const plans = product.basePlans.map((plan) => `${plan.basePlanId}:${plan.state}`).join('/');
      return `${product.productId}:${plans}`;
    })
    .join(', ');
}

function formatGoogleTracks(tracks) {
  if (!tracks.length) return 'no tracks';
  return tracks
    .map((track) => {
      const releases = track.releases.length
        ? track.releases.map((release) => `${release.name || release.versionCodes.join(',')}:${release.status}`).join('|')
        : 'empty';
      return `${track.track}=${releases}`;
    })
    .join(', ');
}

function summarizeIssues(issues) {
  const first = issues[0];
  const suffix = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
  return `${first.platform}: ${first.message}${suffix}`.slice(0, 220);
}

function isAppleBetaActionState(state) {
  return Boolean(state && (appleBetaActionStates.has(state) || state.includes('REJECT')));
}

function notify(title, message) {
  if (!notifyEnabled) return;

  spawnSync('/usr/bin/osascript', [
    '-e',
    `display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`
  ]);
}

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonLine(filePath, value) {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnv(key) {
  return process.env[key] || env[key] || '';
}

function readBool(key, fallback) {
  const value = readEnv(key);
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readList(key, fallback) {
  const value = readEnv(key);
  if (!value) return fallback;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function loadEnvFiles(files) {
  const output = {};
  for (const file of files) {
    const envPath = path.join(rootDir, file);
    if (!fs.existsSync(envPath)) continue;

    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      output[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return output;
}

function resolveFromRoot(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(rootDir, inputPath);
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
