import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const operationalPrefixes = [
  '.github/',
  'android/',
  'config/',
  'ios/',
  'scripts/',
  'server/',
  'src/'
];
const operationalFiles = new Set([
  '.env.example',
  'capacitor.config.ts',
  'package-lock.json',
  'package.json'
]);
const excludedFiles = new Set(['scripts/check-repository-boundary.mjs']);
const disallowedMarkers = [
  { pattern: /\/Users\/[A-Za-z0-9._-]+\//, reason: 'machine-specific absolute path' },
  { pattern: /\bAPPLE_CONNECT_ENV_DIR\b/, reason: 'cross-repository environment loader' },
  { pattern: /\b(?:The Offseason|OffseasonMVP|Daily Edge|DailyEdge|Longevity-Lifestyle-Mobile|Animal Syndicate|hotel-booking-agent)\b/i, reason: 'foreign project name' },
  { pattern: /\b(?:com\.nakedeyent\.livelonger|com\.antigravity\.longevity|com\.nakedeyent\.DailyEdge)\b/i, reason: 'foreign store identifier' }
];

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' }
)
  .split('\n')
  .filter(Boolean)
  .filter(isOperationalFile)
  .filter((file) => !excludedFiles.has(file));

const violations = [];
for (const file of files) {
  const source = readText(file);
  if (source === null) continue;
  for (const marker of disallowedMarkers) {
    if (marker.pattern.test(source)) {
      violations.push(`${file}: ${marker.reason}`);
    }
  }
}

if (violations.length) {
  console.error('Forg3 repository boundary check failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Forg3 repository boundary check passed across ${files.length} operational files.`);

function isOperationalFile(file) {
  return operationalFiles.has(file) || operationalPrefixes.some((prefix) => file.startsWith(prefix));
}

function readText(file) {
  try {
    const buffer = fs.readFileSync(file);
    if (buffer.includes(0)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}
