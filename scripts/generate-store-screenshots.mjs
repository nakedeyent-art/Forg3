import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, '.deploy', 'store-screenshots');
const runtimeDir = path.join(outDir, 'runtime');
const samplePdfPath = path.join(runtimeDir, 'forg3-sample-packet.pdf');
const port = Number(process.env.STORE_SCREENSHOT_PORT || 4178);
const baseUrl = `http://127.0.0.1:${port}`;
const sender = {
  provider: 'google',
  uid: 'store-sender',
  email: 'sender.demo+forg3@example.com',
  name: 'Forg3 Sender'
};
const prospect = {
  provider: 'apple',
  uid: 'store-new-customer',
  email: 'new.customer+forg3@example.com',
  name: 'New Forg3 Customer'
};
const recipient = {
  provider: 'google',
  uid: 'store-recipient',
  email: 'recipient.demo+forg3@example.com',
  name: 'Pone Example'
};

const devices = {
  iphone69: {
    folder: 'ios-iphone-6-9',
    label: 'iPhone 6.9',
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    platform: 'ios'
  },
  ipad13: {
    folder: 'ios-ipad-13',
    label: 'iPad 13',
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    platform: 'ios'
  },
  androidPhone: {
    folder: 'android-phone',
    label: 'Android phone',
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3,
    platform: 'android'
  },
  androidTablet: {
    folder: 'android-tablet',
    label: 'Android tablet',
    viewport: { width: 800, height: 1280 },
    deviceScaleFactor: 2,
    platform: 'android'
  }
};

const screenshotPlan = [
  {
    name: '01-first-run-signup',
    title: 'First-run signup',
    session: null,
    hash: '#/',
    beforeShot: async (page) => {
      await page.locator('.onboarding-banner').waitFor({ state: 'visible' });
    }
  },
  {
    name: '02-native-sender-plans',
    title: 'Native sender plans',
    session: 'prospect',
    hash: '#/',
    beforeShot: async (page) => {
      await page.locator('.billing-panel').scrollIntoViewIfNeeded();
      await page.locator('.plan-card').first().waitFor({ state: 'visible' });
    }
  },
  {
    name: '03-paid-sender-dashboard',
    title: 'Paid sender dashboard',
    session: 'sender',
    hash: '#/',
    beforeShot: async (page) => {
      await page.locator('.documents-table').scrollIntoViewIfNeeded();
      await page.getByText('Signature queue').waitFor({ state: 'visible' });
    }
  },
  {
    name: '04-send-pdf-packet',
    title: 'Send PDF packet',
    session: 'sender',
    hash: '#/',
    beforeShot: async (page) => {
      await page.locator('.compose-panel').scrollIntoViewIfNeeded();
      await page.locator('input[type="file"]').setInputFiles(samplePdfPath);
      await page.locator('input[placeholder="Client agreement"]').fill('Artist Split Agreement');
      await page.locator('input[placeholder="Customer name"]').fill(recipient.name);
      await page.locator('input[placeholder="customer@example.com"]').fill(recipient.email);
      await page.getByText('Send a PDF for signature').waitFor({ state: 'visible' });
    }
  },
  {
    name: '05-recipient-inbox',
    title: 'Recipient inbox',
    session: 'recipient',
    hash: '#/inbox',
    beforeShot: async (page) => {
      await page.getByText('Assigned to').waitFor({ state: 'visible' });
      await page.getByText('Artist Split Agreement').waitFor({ state: 'visible' });
    }
  },
  {
    name: '06-secure-signing-room',
    title: 'Secure signing room',
    session: 'recipient',
    hash: '',
    routeFromSeed: ({ unsignedDocument }) => `#/inbox/sign/${unsignedDocument.document.id}/${unsignedDocument.signingLinks[0].signerId}`,
    beforeShot: async (page) => {
      await page.getByText('About this request').waitFor({ state: 'visible' });
      await page.locator('.signature-panel').scrollIntoViewIfNeeded();
    }
  },
  {
    name: '07-signed-download',
    title: 'Signed download',
    session: 'recipient',
    hash: '',
    routeFromSeed: ({ completionDocument }) =>
      `#/inbox/sign/${completionDocument.document.id}/${completionDocument.signingLinks[0].signerId}`,
    beforeShot: async (page) => {
      await page.getByText('About this request').waitFor({ state: 'visible' });
      await drawSignature(page);
      await page.locator('input[placeholder="Pone Example"]').fill(recipient.name);
      await page.locator('label.consent-row input[type="checkbox"]').check();
      await page.getByRole('button', { name: /Sign document/i }).click();
      await page.getByText('Document signed').waitFor({ state: 'visible' });
    }
  },
  {
    name: '08-account-security',
    title: 'Account security',
    session: 'sender',
    hash: '#/settings',
    beforeShot: async (page) => {
      await page.getByRole('heading', { name: 'Authenticator app' }).waitFor({ state: 'visible' });
      await page.getByRole('heading', { name: 'Where you are signed in' }).waitFor({ state: 'visible' });
    }
  }
];

await main();

async function main() {
  ensureCleanDir(runtimeDir);
  ensureDir(outDir);
  fs.rmSync(path.join(outDir, 'failures'), { recursive: true, force: true });
  await createSamplePdf(samplePdfPath);

  const server = await startServer();
  let browser;

  try {
    const seed = await seedScenario();
    console.log('Store screenshot scenario seeded.');
    console.log('Launching isolated Chromium for store screenshots.');
    browser = await launchBrowser();

    for (const device of Object.values(devices)) {
      await captureDeviceSet(browser, device, seed);
    }

    writeManifest(seed);
    console.log(`Store screenshots generated in ${path.relative(rootDir, outDir)}.`);
  } finally {
    await browser?.close().catch(() => undefined);
    server.kill('SIGTERM');
    await waitForExit(server);
  }
}

async function startServer() {
  const env = {
    ...process.env,
    NODE_ENV: '',
    HOST: '127.0.0.1',
    PORT: String(port),
    FORG3_DATA_FILE: path.join(runtimeDir, 'store.json'),
    FORG3_OBJECT_STORE_PATH: path.join(runtimeDir, 'objects'),
    FORG3_OBJECT_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    APP_AUTH_SECRET: crypto.randomBytes(32).toString('hex'),
    DEVICE_TRUST_SECRET: crypto.randomBytes(32).toString('hex'),
    DEV_AUTH_SECRET: crypto.randomBytes(32).toString('hex'),
    PUBLIC_SIGNING_BASE_URL: baseUrl,
    EMAIL_PROVIDER: '',
    FORG3_AUTH_CODE_LIMIT: '100',
    FORG3_AUTH_VERIFY_LIMIT: '200',
    FORG3_CODE_RESEND_COOLDOWN_SECONDS: '5'
  };
  const child = spawn(process.execPath, ['dist-server/server/index.js'], {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  await waitForHealth();
  return child;
}

async function seedScenario() {
  const senderSession = await createDevSession(sender);
  const prospectSession = await createDevSession(prospect);
  const recipientSession = await createDevSession(recipient);

  await trustDevice(senderSession, 'store-sender-device');
  await trustDevice(prospectSession, 'store-prospect-device');
  await trustDevice(recipientSession, 'store-recipient-device');

  await api('POST', '/api/subscription/checkout', {
    planId: 'forg3_business_monthly',
    billingProvider: 'demo'
  }, senderSession.token, 'store-sender-device');

  const unsignedDocument = await createDocument(senderSession, 'Artist Split Agreement', 'artist-split-agreement.pdf');
  const signedDocument = await createDocument(senderSession, 'Completed Signature Packet', 'completed-signature-packet.pdf');

  await signAssignedDocument(recipientSession, signedDocument);

  return {
    sessions: {
      sender: toStoredSession(senderSession),
      prospect: toStoredSession(prospectSession),
      recipient: toStoredSession(recipientSession)
    },
    deviceIds: {
      sender: 'store-sender-device',
      prospect: 'store-prospect-device',
      recipient: 'store-recipient-device'
    },
    unsignedDocument,
    signedDocument
  };
}

async function captureDeviceSet(browser, device, seed) {
  const folder = path.join(outDir, device.folder);
  ensureCleanDir(folder);
  const deviceSeed = {
    ...seed,
    completionDocument: await createDocument(
      { token: seed.sessions.sender.idToken },
      'Downloadable Signed Packet',
      `downloadable-signed-packet-${device.folder}.pdf`
    )
  };

  for (const shot of screenshotPlan) {
    console.log(`${device.label}: capturing ${shot.title}...`);
    const context = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.viewport.width < 700,
      hasTouch: true
    });
    await context.addInitScript(({ platform, session, deviceId }) => {
      globalThis.CapacitorCustomPlatform = { name: platform };
      localStorage.clear();
      if (session) {
        localStorage.setItem('forg3.auth.session.v1', JSON.stringify(session));
      }
      if (deviceId) {
        localStorage.setItem('forg3.auth.device.v1', deviceId);
      }
    }, {
      platform: device.platform,
      session: shot.session ? seed.sessions[shot.session] : null,
      deviceId: shot.session ? seed.deviceIds[shot.session] : null
    });

    const page = await context.newPage();
    const route = shot.routeFromSeed ? shot.routeFromSeed(deviceSeed) : shot.hash;
    await page.goto(`${baseUrl}/${route}`, { waitUntil: 'networkidle' });
    const filePath = path.join(folder, `${shot.name}.png`);
    try {
      await shot.beforeShot(page, deviceSeed);
      await settle(page);
      await page.screenshot({ path: filePath, fullPage: false });
      console.log(`${device.label}: ${shot.title} -> ${path.relative(rootDir, filePath)}`);
    } catch (error) {
      const failurePath = path.join(outDir, 'failures', `${device.folder}-${shot.name}.png`);
      ensureDir(path.dirname(failurePath));
      await page.screenshot({ path: failurePath, fullPage: false }).catch(() => undefined);
      throw new Error(
        `${device.label}: ${shot.title} failed. Failure screenshot: ${path.relative(rootDir, failurePath)}. ${
          error instanceof Error ? error.message : error
        }`
      );
    } finally {
      await context.close();
    }
  }
}

async function createDocument(session, title, fileName) {
  return api('POST', '/api/documents', {
    title,
    fileName,
    fileType: 'application/pdf',
    fileDataUrl: await pdfDataUrl(fileName),
    signers: [{ name: recipient.name, email: recipient.email, role: 'Signer' }],
    signerName: recipient.name,
    signerEmail: recipient.email,
    expiresInHours: 72,
    signatureField: { page: 1, xPercent: 59, yPercent: 72, widthPercent: 30, heightPercent: 9 },
    identityVerificationRequired: false,
    authProvider: 'email'
  }, session.token || session.idToken, 'store-sender-device');
}

async function signAssignedDocument(session, documentResponse) {
  return api('POST', `/api/signer/documents/${documentResponse.document.id}/${documentResponse.signingLinks[0].signerId}/sign`, {
    signatureDataUrl: tinySignaturePng(),
    signerNameConfirmation: recipient.name,
    consentText: `${recipient.name} accepted electronic signature consent for screenshots.`
  }, session.token, 'store-recipient-device');
}

async function createDevSession(account) {
  const response = await api('POST', '/api/dev-auth/session', account, null, `${account.uid}-device`);
  return {
    ...account,
    token: response.token,
    owner: response.owner
  };
}

async function trustDevice(session, deviceId) {
  const start = await api('POST', '/api/auth/mfa/start', {}, session.token, deviceId);

  if (start.trusted) {
    return;
  }

  if (!start.challengeId || !start.devCode) {
    throw new Error(`Device verification did not return a local code for ${session.email}.`);
  }

  await api('POST', '/api/auth/mfa/verify', {
    challengeId: start.challengeId,
    code: start.devCode
  }, session.token, deviceId);
}

async function api(method, endpoint, body, token, deviceId) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forg3-Device-Id': deviceId || 'store-screenshot-device',
      'X-Forg3-Device-Name': 'Store screenshot device',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${method} ${endpoint} failed (${response.status}): ${payload.error || response.statusText}`);
  }

  return payload;
}

function toStoredSession(session) {
  return {
    provider: session.provider,
    mode: 'demo',
    uid: session.owner.uid,
    name: session.owner.name,
    email: session.owner.email,
    idToken: session.token,
    expiresAt: Date.now() + 10 * 60 * 60 * 1000
  };
}

async function waitForHealth() {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for screenshot server. ${lastError instanceof Error ? lastError.message : ''}`);
}

async function launchBrowser() {
  return Promise.race([
    chromium.launch({ args: ['--no-sandbox'] }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out launching Playwright Chromium.')), 30_000))
  ]);
}

async function drawSignature(page) {
  const canvas = page.locator('.signature-pad canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();

  if (!box) {
    throw new Error('Signature canvas is not visible.');
  }

  await page.mouse.move(box.x + 24, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.62, { steps: 6 });
  await page.mouse.move(box.x + box.width - 24, box.y + box.height * 0.42, { steps: 6 });
  await page.mouse.up();
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(350);
}

async function createSamplePdf(filePath) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawText('Forg3 Secure E-Signature Packet', {
    x: 54,
    y: 724,
    size: 22,
    font: bold,
    color: rgb(0.05, 0.15, 0.26)
  });
  page.drawText('This sample PDF is generated for store screenshots only.', {
    x: 54,
    y: 688,
    size: 12,
    font: regular,
    color: rgb(0.2, 0.24, 0.3)
  });
  page.drawText('Signer:', { x: 54, y: 600, size: 12, font: bold });
  page.drawText(recipient.name, { x: 126, y: 600, size: 12, font: regular });
  page.drawText('Assigned email:', { x: 54, y: 570, size: 12, font: bold });
  page.drawText(recipient.email, { x: 154, y: 570, size: 12, font: regular });
  page.drawRectangle({
    x: 330,
    y: 145,
    width: 190,
    height: 70,
    borderColor: rgb(0.9, 0.36, 0.08),
    borderWidth: 2
  });
  page.drawText('Signature field', {
    x: 356,
    y: 176,
    size: 12,
    font: bold,
    color: rgb(0.05, 0.15, 0.26)
  });

  const bytes = await pdf.save();
  fs.writeFileSync(filePath, bytes);
}

async function pdfDataUrl(fileName) {
  if (!fs.existsSync(samplePdfPath)) {
    await createSamplePdf(samplePdfPath);
  }
  return `data:application/pdf;base64,${fs.readFileSync(samplePdfPath).toString('base64')}`;
}

function tinySignaturePng() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
}

function writeManifest(seed) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    sources: {
      appleScreenshotSpec: 'https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/',
      googlePlayPreviewAssets: 'https://support.google.com/googleplay/android-developer/answer/9866151'
    },
    output: {
      iosIphone69: path.relative(rootDir, path.join(outDir, devices.iphone69.folder)),
      iosIpad13: path.relative(rootDir, path.join(outDir, devices.ipad13.folder)),
      androidPhone: path.relative(rootDir, path.join(outDir, devices.androidPhone.folder)),
      androidTablet: path.relative(rootDir, path.join(outDir, devices.androidTablet.folder))
    },
    seededDocumentIds: {
      unsigned: seed.unsignedDocument.document.id,
      signed: seed.signedDocument.document.id
    }
  };

  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(resolve, 5_000).unref();
  });
}
