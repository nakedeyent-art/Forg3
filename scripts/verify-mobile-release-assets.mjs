import fs from 'node:fs';
import path from 'node:path';

const expectedApiBase = (process.env.RELEASE_API_BASE_URL || process.env.VITE_API_BASE_URL || 'https://forg3.nak3deye.com').replace(/\/$/, '');
const staleMarkers = ['sign.nak3deye.com', 'sslip.io', '150-136-152-51', '150.136.152.51'];
const bundles = [
  { label: 'web dist', dir: 'dist/assets' },
  { label: 'iOS Capacitor', dir: 'ios/App/App/public/assets' },
  { label: 'Android Capacitor', dir: 'android/app/src/main/assets/public/assets' }
];

const failures = [];

for (const bundle of bundles) {
  const files = findFiles(bundle.dir, (file) => file.endsWith('.js'));
  if (!files.length) {
    failures.push(`${bundle.label}: no JavaScript bundle files found under ${bundle.dir}`);
    continue;
  }

  const combined = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

  if (!combined.includes(expectedApiBase)) {
    failures.push(`${bundle.label}: expected API base ${expectedApiBase} is missing`);
  }

  if (/=\s*""\.replace\(\/\\\/\$\/,\s*""\)/.test(combined) || /=\s*""\.replace\(\/\\\/\$\//.test(combined)) {
    failures.push(`${bundle.label}: compiled bundle still contains an empty VITE_API_BASE_URL replacement`);
  }

  for (const marker of staleMarkers) {
    if (combined.includes(marker)) {
      failures.push(`${bundle.label}: stale endpoint marker found: ${marker}`);
    }
  }
}

assertFileContains('capacitor.config.ts', ["appId: 'com.forg3.sign'", "appName: 'Forg3'"]);
assertFileContains('android/app/src/main/res/values/strings.xml', ['<string name="app_name">Forg3</string>']);
assertFileContains('ios/App/App/Info.plist', ['<string>Forg3</string>']);

const androidVariables = readText('android/variables.gradle');
const targetSdk = Number(androidVariables.match(/targetSdkVersion\s*=\s*(\d+)/)?.[1] || 0);
if (targetSdk < 35) {
  failures.push(`Android targetSdkVersion is ${targetSdk || 'missing'}; Google Play currently requires 35 or higher for new mobile app submissions.`);
}

if (failures.length) {
  console.error('Mobile release asset verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Mobile release assets verified for ${expectedApiBase}.`);

function findFiles(dir, predicate) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...findFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function assertFileContains(file, expectedStrings) {
  const text = readText(file);
  if (!text) {
    failures.push(`${file}: file is missing`);
    return;
  }

  for (const expected of expectedStrings) {
    if (!text.includes(expected)) {
      failures.push(`${file}: expected "${expected}"`);
    }
  }
}
