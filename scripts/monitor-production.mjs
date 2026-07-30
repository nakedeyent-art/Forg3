import dns from 'node:dns/promises';
import process from 'node:process';

const baseUrl = (process.env.FORG3_MONITOR_URL || 'https://forg3.nak3deye.com').replace(/\/$/, '');
const expectedAddress = process.env.FORG3_EXPECTED_A_RECORD || '';
const expectedService = process.env.FORG3_EXPECTED_SERVICE || 'forg3';
const expectedCommit = process.env.FORG3_EXPECTED_COMMIT || process.env.FORG3_EXPECTED_COMMIT_SHA || '';
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
    expectedService,
    service: '',
    version: '',
    commit: '',
    expectedCommit,
    time: ''
  },
  routes: {
    signedCopyDelivery: {
      ok: false,
      status: 0
    }
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
  result.health.version = typeof body.version === 'string' ? body.version : '';
  result.health.commit = typeof body.commit === 'string' ? body.commit : '';
  result.health.time = typeof body.time === 'string' ? body.time : '';
  result.health.ok =
    response.ok &&
    body.ok === true &&
    result.health.service === expectedService &&
    (!expectedCommit || result.health.commit === expectedCommit);

  const routeController = new AbortController();
  const routeTimeout = setTimeout(() => routeController.abort(), timeoutMs);
  const routeResponse = await fetch(`${baseUrl}/api/documents/00000000-0000-4000-8000-000000000000/signed/deliver`, {
    method: 'POST',
    signal: routeController.signal
  });
  clearTimeout(routeTimeout);
  result.routes.signedCopyDelivery.status = routeResponse.status;
  result.routes.signedCopyDelivery.ok = routeResponse.status === 401;
  result.ok = result.dns.ok && result.health.ok && result.routes.signedCopyDelivery.ok;
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
