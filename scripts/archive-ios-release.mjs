import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspacePath = path.join(rootDir, 'ios', 'App', 'App.xcworkspace');
const exportOptionsPath = path.join(rootDir, 'ios', 'App', 'ExportOptions-AppStore.plist');
const scheme = 'Forg3';
const archiveRoot = path.resolve(
  process.env.XCODE_ARCHIVES_ROOT || path.join(os.homedir(), 'Library', 'Developer', 'Xcode', 'Archives')
);
const upload = process.argv.includes('--upload');
const statusOnly = process.argv.includes('--status');

if (statusOnly) {
  printCanonicalStatus();
  process.exit(0);
}

assertExists(workspacePath, 'iOS workspace');
assertExists(exportOptionsPath, 'App Store export options');

const settings = readBuildSettings();
const appName = settings.PRODUCT_NAME || 'Forg3';
const version = requireSetting(settings, 'MARKETING_VERSION');
const build = requireSetting(settings, 'CURRENT_PROJECT_VERSION');
const bundleId = requireSetting(settings, 'PRODUCT_BUNDLE_IDENTIFIER');

if (bundleId !== 'com.forg3.sign') {
  throw new Error(`Refusing to archive unexpected bundle identifier ${bundleId}.`);
}

const dayDir = path.join(archiveRoot, localDateFolder(new Date()));
const archivePath = path.join(dayDir, `${appName} ${version} (${build}).xcarchive`);
const exportDir = path.join(archiveRoot, 'Forg3 Exports', version, build);
const derivedDataPath = path.join(rootDir, '.deploy', 'mobile', 'derived-data', `${appName}-${version}-${build}`);

if (fs.existsSync(archivePath)) {
  throw new Error(`Archive already exists: ${archivePath}. Bump CURRENT_PROJECT_VERSION before building again.`);
}
if (fs.existsSync(exportDir)) {
  throw new Error(`Export directory already exists: ${exportDir}. Bump CURRENT_PROJECT_VERSION before building again.`);
}

run('npm', ['run', 'build:mobile:release'], { env: process.env });

fs.mkdirSync(dayDir, { recursive: true });
fs.mkdirSync(path.dirname(exportDir), { recursive: true });
fs.mkdirSync(derivedDataPath, { recursive: true });

run('xcodebuild', [
  '-workspace', workspacePath,
  '-scheme', scheme,
  '-configuration', 'Release',
  '-destination', 'generic/platform=iOS',
  '-derivedDataPath', derivedDataPath,
  '-archivePath', archivePath,
  '-allowProvisioningUpdates',
  'clean',
  'archive'
]);

normalizeOrganizerName(archivePath, appName);
run('/usr/bin/xattr', ['-cr', archivePath]);
verifyArchive(archivePath, { bundleId, version, build });

run('xcodebuild', [
  '-exportArchive',
  '-archivePath', archivePath,
  '-exportPath', exportDir,
  '-exportOptionsPlist', exportOptionsPath,
  '-allowProvisioningUpdates'
]);

const ipaPath = findIpa(exportDir);
const manifest = {
  appName,
  bundleId,
  version,
  build,
  archivePath,
  ipaPath,
  createdAt: new Date().toISOString(),
  uploaded: false
};

if (upload) {
  const uploadOptionsPath = path.join(exportDir, 'ExportOptions-Upload.plist');
  fs.copyFileSync(exportOptionsPath, uploadOptionsPath);
  run('/usr/bin/plutil', ['-replace', 'destination', '-string', 'upload', uploadOptionsPath]);
  run('xcodebuild', [
    '-exportArchive',
    '-archivePath', archivePath,
    '-exportPath', path.join(exportDir, 'upload-result'),
    '-exportOptionsPlist', uploadOptionsPath,
    '-allowProvisioningUpdates'
  ]);
  manifest.uploaded = true;
  manifest.uploadedAt = new Date().toISOString();
}

writeManifest(manifest);
console.log(`Archive: ${archivePath}`);
console.log(`IPA: ${ipaPath}`);
console.log(upload ? 'Upload command completed.' : 'Archive and export completed without uploading.');

function readBuildSettings() {
  const result = run('xcodebuild', [
    '-showBuildSettings',
    '-workspace', workspacePath,
    '-scheme', scheme,
    '-configuration', 'Release'
  ], { capture: true });
  const settings = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) settings[match[1]] = match[2].trim();
  }
  return settings;
}

function verifyArchive(candidate, expected) {
  assertExists(path.join(candidate, 'Info.plist'), 'archive Info.plist');
  const actual = {
    bundleId: readPlist(candidate, ':ApplicationProperties:CFBundleIdentifier'),
    version: readPlist(candidate, ':ApplicationProperties:CFBundleShortVersionString'),
    build: readPlist(candidate, ':ApplicationProperties:CFBundleVersion')
  };
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      throw new Error(`Archive ${key} is ${actual[key]}, expected ${expected[key]}.`);
    }
  }
}

function normalizeOrganizerName(archivePath, appName) {
  const infoPath = path.join(archivePath, 'Info.plist');
  run('/usr/libexec/PlistBuddy', ['-c', `Set :Name ${appName}`, infoPath]);
  run('/usr/libexec/PlistBuddy', ['-c', `Set :SchemeName ${appName}`, infoPath]);
}

function readPlist(archivePath, key) {
  return run('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, path.join(archivePath, 'Info.plist')], {
    capture: true
  }).stdout.trim();
}

function findIpa(directory) {
  const ipa = fs.readdirSync(directory)
    .find((name) => name.toLowerCase().endsWith('.ipa'));
  if (!ipa) throw new Error(`No IPA was exported to ${directory}.`);
  return path.join(directory, ipa);
}

function writeManifest(record) {
  const recordsDir = path.join(archiveRoot, 'Forg3 Release Records');
  const manifestPath = path.join(recordsDir, 'local-artifacts.json');
  fs.mkdirSync(recordsDir, { recursive: true });
  let records = [];
  if (fs.existsSync(manifestPath)) {
    records = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
  records = records.filter((entry) => !(entry.version === record.version && entry.build === record.build));
  records.push(record);
  records.sort((a, b) => Number(a.build) - Number(b.build));
  fs.writeFileSync(manifestPath, `${JSON.stringify(records, null, 2)}\n`);
}

function printCanonicalStatus() {
  const archives = [];
  if (fs.existsSync(archiveRoot)) {
    for (const dayName of fs.readdirSync(archiveRoot)) {
      const dayPath = path.join(archiveRoot, dayName);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayName) || !fs.statSync(dayPath).isDirectory()) continue;
      for (const name of fs.readdirSync(dayPath)) {
        if (!name.endsWith('.xcarchive')) continue;
        const candidate = path.join(dayPath, name);
        try {
          if (readPlist(candidate, ':ApplicationProperties:CFBundleIdentifier') !== 'com.forg3.sign') continue;
          archives.push({
            version: readPlist(candidate, ':ApplicationProperties:CFBundleShortVersionString'),
            build: readPlist(candidate, ':ApplicationProperties:CFBundleVersion'),
            path: candidate
          });
        } catch {
          // Ignore malformed or unrelated archives.
        }
      }
    }
  }
  archives.sort((a, b) => Number(a.build) - Number(b.build));
  if (!archives.length) {
    console.log(`No Forg3 archives found under ${archiveRoot}.`);
    return;
  }
  for (const archive of archives) {
    console.log(`Forg3 ${archive.version} (${archive.build})  ${archive.path}`);
  }
}

function localDateFolder(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function requireSetting(settings, key) {
  const value = settings[key];
  if (!value) throw new Error(`Xcode build setting ${key} is missing.`);
  return value;
}

function assertExists(candidate, label) {
  if (!fs.existsSync(candidate)) throw new Error(`${label} not found: ${candidate}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`${command} exited with status ${result.status}.${detail}`);
  }
  return result;
}
