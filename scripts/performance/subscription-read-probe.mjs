import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const scenarios = Object.freeze({
  'public-plans': { path: '/api/v1/public/subscription-plans?page=1&pageSize=9', authenticated: false },
  'subscription-usage': { path: '/api/v1/subscription/usage', authenticated: true },
  'subscription-catalog': { path: '/api/v1/subscription/catalog?page=1&pageSize=20', authenticated: true },
  'billing-invoices': { path: '/api/v1/subscription/billing/invoices?page=1&pageSize=10&status=ALL', authenticated: true },
  'billing-payments': { path: '/api/v1/subscription/billing/payments?page=1&pageSize=10&state=ALL', authenticated: true },
});

const bounds = {
  requests: [1, 200, 12], concurrency: [1, 4, 1], intervalMs: [50, 5_000, 150],
  durationMs: [100, 60_000, 10_000], requestTimeoutMs: [50, 10_000, 2_000],
  maxResponseBytes: [1, 1_048_576, 262_144],
};

function boundedInteger(name, value) {
  const [minimum, maximum, fallback] = bounds[name];
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name} budget`);
  return value;
}

export function validateProbeOptions(options = {}) {
  const allowed = new Set(['baseUrl', 'scenario', 'sid', ...Object.keys(bounds)]);
  if (Object.keys(options).some((key) => !allowed.has(key))) throw new Error('Unknown probe option');
  let base;
  try { base = new URL(options.baseUrl ?? 'http://127.0.0.1:3133'); }
  catch { throw new Error('Invalid loopback origin'); }
  if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname)
      || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Only an HTTP(S) loopback origin without credentials, path or query is allowed');
  }
  // Pin localhost to a literal loopback address; never consult a hosts file or follow a DNS change.
  if (base.hostname === 'localhost') base.hostname = '127.0.0.1';
  const scenario = options.scenario ?? 'public-plans';
  if (typeof scenario !== 'string' || !Object.hasOwn(scenarios, scenario)) throw new Error('Unknown read-only scenario');
  const descriptor = scenarios[scenario];
  if (options.sid !== undefined && (typeof options.sid !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/u.test(options.sid))) {
    throw new Error('Invalid session token format');
  }
  if (descriptor.authenticated && !options.sid) throw new Error('This scenario requires SUBSCRIPTION_PROBE_SID');
  const budgets = Object.fromEntries(Object.keys(bounds).map((key) => [key, boundedInteger(key, options[key])]));
  if (budgets.concurrency > budgets.requests) throw new Error('Concurrency cannot exceed the request budget');
  if (budgets.requestTimeoutMs > budgets.durationMs) throw new Error('Request timeout cannot exceed the run duration');
  return { baseUrl: base.origin, scenario, ...budgets, ...(descriptor.authenticated ? { sid: options.sid } : {}) };
}

export function summarizeNumbers(values) {
  if (!values.length) return { count: 0, min: null, mean: null, p50: null, p95: null, p99: null, max: null };
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid measurement');
  const sorted = [...values].sort((left, right) => left - right);
  const round = (value) => Math.round(value * 1_000) / 1_000;
  const percentile = (fraction) => round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]);
  return {
    count: sorted.length, min: round(sorted[0]), mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: round(sorted.at(-1)),
  };
}

function waitInterval(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
  });
}

function sampleRead(options, agent, signal) {
  const descriptor = scenarios[options.scenario];
  const target = new URL(descriptor.path, options.baseUrl);
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const started = performance.now();
    let done = false;
    let bytes = 0;
    let status = null;
    let timeToHeadersMs = null;
    let response;
    let timer;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (outcome !== 'HTTP_SUCCESS') { response?.destroy(); request.destroy(); }
      resolve({ outcome, status, bytes, elapsedMs: performance.now() - started, timeToHeadersMs });
    };
    const abort = () => finish('INTERRUPTED');
    const request = transport.request(target, {
      method: 'GET', agent,
      headers: {
        Accept: 'application/json', 'User-Agent': 'subscription-read-probe/1',
        ...(descriptor.authenticated ? { Cookie: `sid=${options.sid}` } : {}),
      },
    }, (incoming) => {
      response = incoming;
      status = incoming.statusCode ?? null;
      timeToHeadersMs = performance.now() - started;
      if (status === 429 || status === 503) { finish('PRESSURE'); return; }
      if (status === 401 || status === 403) { finish('AUTH_REJECTED'); return; }
      // Redirects are failures. Never follow a URL, acquire CSRF, or replay a request.
      if (status === null || status < 200 || status >= 300) { finish('HTTP_ERROR'); return; }
      incoming.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > options.maxResponseBytes) finish('RESPONSE_LIMIT');
      });
      incoming.on('end', () => finish('HTTP_SUCCESS'));
      incoming.on('error', () => finish('NETWORK_ERROR'));
      incoming.on('aborted', () => finish('NETWORK_ERROR'));
    });
    request.on('error', () => finish(signal.aborted ? 'INTERRUPTED' : 'NETWORK_ERROR'));
    timer = setTimeout(() => finish('REQUEST_TIMEOUT'), options.requestTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else request.end();
  });
}

/** Bounded HTTP read measurements only, never business correctness or a calibrated SLO. */
export async function runSubscriptionReadProbe(input = {}, { signal: externalSignal } = {}) {
  const options = validateProbeOptions(input);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const cancellation = new AbortController();
  const Agent = options.baseUrl.startsWith('https:') ? https.Agent : http.Agent;
  const agent = new Agent({ keepAlive: true, maxSockets: options.concurrency, maxTotalSockets: options.concurrency });
  let stopReason = null;
  let started = 0;
  const samples = [];
  const stop = (reason) => {
    if (stopReason !== null) return;
    stopReason = reason;
    cancellation.abort();
  };
  const externalAbort = () => stop('CANCELLED');
  externalSignal?.addEventListener('abort', externalAbort, { once: true });
  if (externalSignal?.aborted) externalAbort();
  const deadline = setTimeout(() => stop('RUN_DURATION_LIMIT'), options.durationMs);
  try {
    await Promise.all(Array.from({ length: options.concurrency }, async () => {
      while (!cancellation.signal.aborted && started < options.requests) {
        started += 1;
        const sample = await sampleRead(options, agent, cancellation.signal);
        samples.push(sample);
        if (sample.outcome !== 'HTTP_SUCCESS') stop(sample.outcome);
        if (started < options.requests && !cancellation.signal.aborted) await waitInterval(options.intervalMs, cancellation.signal);
      }
    }));
  } finally {
    clearTimeout(deadline);
    externalSignal?.removeEventListener('abort', externalAbort);
    agent.destroy();
  }
  const elapsedMs = performance.now() - start;
  const successful = samples.filter((sample) => sample.outcome === 'HTTP_SUCCESS');
  const statuses = {};
  const outcomes = {};
  for (const sample of samples) {
    statuses[sample.status ?? 'NO_RESPONSE'] = (statuses[sample.status ?? 'NO_RESPONSE'] ?? 0) + 1;
    outcomes[sample.outcome] = (outcomes[sample.outcome] ?? 0) + 1;
  }
  return {
    schemaVersion: 1, scenario: options.scenario, origin: options.baseUrl, startedAt,
    scope: 'LOOPBACK_HTTP_READ_ONLY', validation: 'HTTP_STATUS_ONLY', sloCalibrated: false,
    budgets: Object.fromEntries(Object.keys(bounds).map((key) => [key, options[key]])),
    stopReason: stopReason ?? 'REQUEST_BUDGET_COMPLETED',
    completed: successful.length === options.requests,
    attempted: started, successful: successful.length, interrupted: outcomes.INTERRUPTED ?? 0,
    elapsedMs: Math.round(elapsedMs * 1_000) / 1_000,
    completedReadsPerSecond: elapsedMs > 0 ? Math.round(successful.length * 1_000_000 / elapsedMs) / 1_000 : 0,
    receivedBytes: samples.reduce((sum, sample) => sum + sample.bytes, 0), statuses, outcomes,
    successfulLatencyMs: summarizeNumbers(successful.map((sample) => sample.elapsedMs)),
    successfulTimeToHeadersMs: summarizeNumbers(successful.map((sample) => sample.timeToHeadersMs)),
  };
}

export function parseProbeArguments(args, environment = {}) {
  const keys = {
    '--base-url': 'baseUrl', '--scenario': 'scenario', '--requests': 'requests', '--concurrency': 'concurrency',
    '--interval-ms': 'intervalMs', '--duration-ms': 'durationMs', '--request-timeout-ms': 'requestTimeoutMs',
    '--max-response-bytes': 'maxResponseBytes',
  };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = Object.hasOwn(keys, args[index]) ? keys[args[index]] : undefined;
    const value = args[index + 1];
    if (!key || value === undefined || Object.hasOwn(options, key)) throw new Error('Unknown, duplicate or incomplete probe argument');
    if (Object.hasOwn(bounds, key)) {
      if (!/^[0-9]+$/u.test(value)) throw new Error('Budget arguments must be integers');
      options[key] = Number(value);
    } else options[key] = value;
  }
  if (environment.SUBSCRIPTION_PROBE_SID) options.sid = environment.SUBSCRIPTION_PROBE_SID;
  return validateProbeOptions(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).includes('--help')) {
    console.log('Read-only loopback probe. Options: --base-url --scenario --requests --concurrency --interval-ms --duration-ms --request-timeout-ms --max-response-bytes. Authenticated scenarios use SUBSCRIPTION_PROBE_SID only; never pass credentials on the command line.');
  } else {
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    try {
      const report = await runSubscriptionReadProbe(parseProbeArguments(process.argv.slice(2), process.env), { signal: controller.signal });
      console.log(JSON.stringify(report, null, 2));
      if (!report.completed) process.exitCode = 1;
    } catch {
      // Validation/network errors must never echo a supplied origin, token or response body.
      console.error('Subscription read probe rejected the configuration or could not complete safely. See --help.');
      process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', interrupt);
    }
  }
}
