import { spawnSync } from 'node:child_process';

const apiBase = (process.env.VITE_API_BASE_URL || process.env.RELEASE_API_BASE_URL || 'https://forg3.nak3deye.com').replace(/\/$/, '');
const env = {
  ...process.env,
  VITE_API_BASE_URL: apiBase,
  RELEASE_API_BASE_URL: apiBase
};

run('npm', ['run', 'build'], env);
run('npx', ['cap', 'sync'], env);
run('node', ['scripts/verify-mobile-release-assets.mjs'], env);

console.log(`Mobile release build synced for ${apiBase}.`);

function run(command, args, commandEnv) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: commandEnv,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
