import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseProbeArguments, runSubscriptionReadProbe, summarizeNumbers, validateProbeOptions } from '../performance/subscription-read-probe.mjs';

async function fixture(t, handle) {
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

const budgets = { requests: 3, intervalMs: 50, durationMs: 2_000, requestTimeoutMs: 500 };

test('probe uses bounded, read-only loopback scenarios and never accepts arbitrary routes or headers', () => {
  assert.equal(validateProbeOptions({ baseUrl: 'http://localhost:3133' }).baseUrl, 'http://127.0.0.1:3133');
  assert.equal(validateProbeOptions({ baseUrl: 'https://[::1]:3133' }).baseUrl, 'https://[::1]:3133');
  for (const baseUrl of ['https://example.test', 'http://169.254.169.254', 'http://127.0.0.1.evil.test', 'file:///tmp/x', 'http://secret:password@127.0.0.1', 'http://127.0.0.1/api', 'http://127.0.0.1?token=private', 'http://127.0.0.1/#secret']) {
    assert.throws(() => validateProbeOptions({ baseUrl }));
  }
  assert.throws(() => validateProbeOptions({ scenario: '/auth/login' }));
  assert.throws(() => validateProbeOptions({ scenario: 'constructor' }));
  assert.throws(() => validateProbeOptions({ headers: { Authorization: 'secret' } }));
  assert.throws(() => validateProbeOptions({ scenario: 'subscription-usage' }));
  assert.throws(() => validateProbeOptions({ sid: 'value\r\nInjected: unsafe' }));
  for (const options of [{ requests: 201 }, { requests: 0 }, { concurrency: 5 }, { intervalMs: 0 }, { durationMs: 60_001 }, { maxResponseBytes: 2_000_000 }, { requests: 1, concurrency: 2 }, { durationMs: 100, requestTimeoutMs: 101 }]) {
    assert.throws(() => validateProbeOptions(options));
  }
});

test('probe CLI rejects duplicate, secret, noninteger, partial and unknown parameters', () => {
  for (const args of [['--sid', 'secret'], ['--base-url'], ['--requests', '1e2'], ['--requests', '1.5'], ['--requests', '2', '--requests', '3']]) {
    assert.throws(() => parseProbeArguments(args));
  }
  const options = parseProbeArguments(['--scenario', 'subscription-usage', '--requests', '3'], { SUBSCRIPTION_PROBE_SID: 'synthetic-private-session-token' });
  assert.equal(options.requests, 3);
  assert.equal(options.sid, 'synthetic-private-session-token');
});

test('probe percentiles use explicit nearest ranks and preserve empty results rather than zero latency', () => {
  assert.deepEqual(summarizeNumbers([]), { count: 0, min: null, mean: null, p50: null, p95: null, p99: null, max: null });
  assert.deepEqual(summarizeNumbers([5, 1, 4, 2, 3]), { count: 5, min: 1, mean: 3, p50: 3, p95: 5, p99: 5, max: 5 });
  assert.throws(() => summarizeNumbers([NaN]));
});

test('public probe omits supplied credentials and stores only aggregate metadata, never bodies or Set-Cookie', async (t) => {
  let calls = 0;
  const baseUrl = await fixture(t, (request, response) => {
    calls += 1;
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/v1/public/subscription-plans?page=1&pageSize=9');
    assert.equal(request.headers.cookie, undefined);
    response.setHeader('Set-Cookie', 'sid=private-response-cookie');
    response.end('private-financial-response-body');
  });
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl, sid: 'synthetic-private-session-token' });
  assert.equal(calls, 3);
  assert.equal(report.completed, true);
  assert.equal(report.successful, 3);
  assert.equal(report.successfulLatencyMs.count, 3);
  assert.equal(report.validation, 'HTTP_STATUS_ONLY');
  assert.equal(report.sloCalibrated, false);
  assert.doesNotMatch(JSON.stringify(report), /private-|sid|token|financial-response/u);
});

test('authenticated probe sends only the supplied session, never CSRF acquisition or writes', async (t) => {
  const baseUrl = await fixture(t, (request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/v1/subscription/usage');
    assert.equal(request.headers.cookie, 'sid=synthetic-private-session-token');
    assert.equal(request.headers['x-csrf-token'], undefined);
    response.end('{}');
  });
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl, scenario: 'subscription-usage', sid: 'synthetic-private-session-token' });
  assert.equal(report.completed, true);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-private/u);
});

for (const [status, stopReason] of [[429, 'PRESSURE'], [503, 'PRESSURE'], [401, 'AUTH_REJECTED'], [403, 'AUTH_REJECTED'], [302, 'HTTP_ERROR'], [500, 'HTTP_ERROR']]) {
  test(`probe stops on ${status} without retry or redirect following`, async (t) => {
    let calls = 0;
    const baseUrl = await fixture(t, (_request, response) => {
      calls += 1; response.writeHead(status, { Location: 'http://example.test/private' }); response.end();
    });
    const report = await runSubscriptionReadProbe({ ...budgets, baseUrl });
    assert.equal(calls, 1);
    assert.equal(report.completed, false);
    assert.equal(report.stopReason, stopReason);
    assert.equal(report.successfulLatencyMs.p95, null);
  });
}

test('probe enforces simultaneous request ceiling and total request budget', async (t) => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const baseUrl = await fixture(t, (_request, response) => {
    active += 1; calls += 1; maximum = Math.max(maximum, active);
    setTimeout(() => { active -= 1; response.end('{}'); }, 30);
  });
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl, requests: 6, concurrency: 2 });
  assert.equal(calls, 6);
  assert.equal(maximum, 2);
  assert.equal(report.attempted, 6);
  assert.equal(report.completed, true);
});

test('probe bounds response size without retaining oversized body content', async (t) => {
  const baseUrl = await fixture(t, (_request, response) => response.end('secret-'.repeat(1_000)));
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl, maxResponseBytes: 10 });
  assert.equal(report.stopReason, 'RESPONSE_LIMIT');
  assert.equal(report.attempted, 1);
  assert.doesNotMatch(JSON.stringify(report), /secret-/u);
});

test('probe bounds header and body stalls without retries', async (t) => {
  for (const bodyStall of [false, true]) {
    const baseUrl = await fixture(t, (_request, response) => { if (bodyStall) { response.writeHead(200); response.write('{}'); } });
    const report = await runSubscriptionReadProbe({ ...budgets, baseUrl, requestTimeoutMs: 50 });
    assert.equal(report.stopReason, 'REQUEST_TIMEOUT');
    assert.equal(report.attempted, 1);
  }
});

test('probe run budget interrupts ongoing reads and stops scheduling new ones', async (t) => {
  const baseUrl = await fixture(t, (_request, response) => setTimeout(() => response.end('{}'), 60));
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl, requests: 20, durationMs: 100, requestTimeoutMs: 100 });
  assert.equal(report.stopReason, 'RUN_DURATION_LIMIT');
  assert.ok(report.attempted < 20);
  assert.equal(report.completed, false);
});

test('already-cancelled probe never sends a request', async (t) => {
  let calls = 0;
  const baseUrl = await fixture(t, (_request, response) => { calls += 1; response.end('{}'); });
  const cancellation = new AbortController();
  cancellation.abort();
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl }, { signal: cancellation.signal });
  assert.equal(calls, 0);
  assert.equal(report.stopReason, 'CANCELLED');
  assert.equal(report.successfulLatencyMs.count, 0);
});

test('cancelling active reads settles all workers and never schedules a replacement', async (t) => {
  let calls = 0;
  const cancellation = new AbortController();
  const baseUrl = await fixture(t, () => { calls += 1; if (calls === 2) cancellation.abort(); });
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl, concurrency: 2 }, { signal: cancellation.signal });
  assert.equal(calls, 2);
  assert.equal(report.attempted, 2);
  assert.equal(report.interrupted, 2);
  assert.equal(report.stopReason, 'CANCELLED');
});

test('pressure interrupts the other worker without retrying either request', async (t) => {
  const responses = [];
  const baseUrl = await fixture(t, (_request, response) => {
    responses.push(response);
    if (responses.length === 2) { responses[0].writeHead(429); responses[0].end(); }
  });
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl, concurrency: 2 });
  assert.equal(responses.length, 2);
  assert.equal(report.attempted, 2);
  assert.equal(report.stopReason, 'PRESSURE');
  assert.equal(report.outcomes.PRESSURE, 1);
  assert.equal(report.interrupted, 1);
});

test('truncated responses are failures and do not contaminate successful latency statistics', async (t) => {
  const baseUrl = await fixture(t, (_request, response) => {
    response.writeHead(200, { 'Content-Length': '100' });
    response.write('{}');
    response.socket.end();
  });
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl });
  assert.equal(report.stopReason, 'NETWORK_ERROR');
  assert.equal(report.attempted, 1);
  assert.equal(report.successfulLatencyMs.count, 0);
});

test('the small sequential probe reuses a connection instead of churning sockets', async (t) => {
  const ports = new Set();
  const baseUrl = await fixture(t, (request, response) => { ports.add(request.socket.remotePort); response.end('{}'); });
  const report = await runSubscriptionReadProbe({ ...budgets, baseUrl });
  assert.equal(report.completed, true);
  assert.equal(ports.size, 1);
});

test('all authenticated list scenarios retain server-side page bounds', async (t) => {
  const expected = new Map([
    ['subscription-catalog', '/api/v1/subscription/catalog?page=1&pageSize=20'],
    ['billing-invoices', '/api/v1/subscription/billing/invoices?page=1&pageSize=10&status=ALL'],
    ['billing-payments', '/api/v1/subscription/billing/payments?page=1&pageSize=10&state=ALL'],
  ]);
  for (const [scenario, pathname] of expected) {
    let calls = 0;
    const baseUrl = await fixture(t, (request, response) => {
      calls += 1;
      assert.equal(request.url, pathname);
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.cookie, 'sid=synthetic-private-session-token');
      response.end('{}');
    });
    const report = await runSubscriptionReadProbe({ ...budgets, baseUrl, requests: 1, scenario, sid: 'synthetic-private-session-token' });
    assert.equal(calls, 1);
    assert.equal(report.completed, true);
  }
});

test('CLI rejects unsafe arguments without printing secrets from the URL or environment', async () => {
  const script = fileURLToPath(new URL('../performance/subscription-read-probe.mjs', import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [script, '--base-url', 'http://private-user:private-password@127.0.0.1'], {
    env: { ...process.env, SUBSCRIPTION_PROBE_SID: 'synthetic-private-session-token' }, timeout: 5_000,
  }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /rejected the configuration/u);
    assert.doesNotMatch(error.stderr, /private-|synthetic|127\.0\.0\.1/u);
    return true;
  });
});
