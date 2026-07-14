import dns from 'node:dns/promises';
import process from 'node:process';

const baseUrl = (process.env.FORG3_MONITOR_URL || 'https://forg3.nak3deye.com').replace(/\/$/, '');
const expectedAddress = process.env.FORG3_EXPECTED_A_RECORD || '';
const timeoutMs = Number(process.env.FORG3_MONITOR_TIMEOUT_MS || 10000);

const result = {
  ok: false,
  baseUrl,
  checkedAt: new Date().toISOString(),
  dns: {
    host: new URL(baseUrl).hostname,
    addresses: [],
    expectedAddress,
    ok: false
  },
  health: {
    ok: false,
    status: 0,
    service: '',
    time: ''
  }
};

try {
  result.dns.addresses = await dns.resolve4(result.dns.host);
  result.dns.ok = expectedAddress ? result.dns.addresses.includes(expectedAddress) : result.dns.addresses.length > 0;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
  clearTimeout(timeout);
  const body = await response.json().catch(() => ({}));

  result.health.status = response.status;
  result.health.service = typeof body.service === 'string' ? body.service : '';
  result.health.time = typeof body.time === 'string' ? body.time : '';
  result.health.ok = response.ok && body.ok === true && result.health.service === 'forg3-sign';
  result.ok = result.dns.ok && result.health.ok;
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
