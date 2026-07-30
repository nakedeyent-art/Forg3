import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.env.FORG3_STORE_MONITOR_LAUNCHD_LABEL || 'com.forg3.store-review-monitor';
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const logsDir = path.join(os.homedir(), 'Library', 'Logs');
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const nodePath = firstExisting(['/opt/homebrew/bin/node', '/usr/local/bin/node', process.execPath]);
const launchPath =
  process.env.FORG3_STORE_MONITOR_PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const scriptPath = path.join(rootDir, 'scripts', 'monitor-store-review.mjs');
const uid = process.getuid?.();
const domain = uid === undefined ? 'gui' : `gui/${uid}`;

if (!fs.existsSync(scriptPath)) {
  throw new Error(`Monitor script not found: ${scriptPath}`);
}

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });
fs.writeFileSync(plistPath, buildPlist());

runLaunchctl(['bootout', domain, plistPath], { allowFailure: true });
runLaunchctl(['bootstrap', domain, plistPath]);
runLaunchctl(['enable', `${domain}/${label}`], { allowFailure: true });

console.log(`Installed ${label}`);
console.log(`Plist: ${plistPath}`);
console.log(`Schedule: daily at 06:00, 12:00, and 18:00 local time`);
console.log(`Logs: ${path.join(logsDir, 'Forg3StoreReviewMonitor.out.log')}`);

function buildPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(rootDir)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(scriptPath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(launchPath)}</string>
    <key>FORG3_STORE_MONITOR_NOTIFY</key>
    <string>1</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Hour</key>
      <integer>6</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
    <dict>
      <key>Hour</key>
      <integer>12</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
    <dict>
      <key>Hour</key>
      <integer>18</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
  </array>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logsDir, 'Forg3StoreReviewMonitor.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logsDir, 'Forg3StoreReviewMonitor.err.log'))}</string>
</dict>
</plist>
`;
}

function runLaunchctl(args, options = {}) {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`launchctl ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function firstExisting(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[candidates.length - 1];
}
