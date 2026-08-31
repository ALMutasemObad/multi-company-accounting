import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const playwrightCli = path.join(root, 'node_modules/@playwright/test/cli.js');
const failureMessage = 'DB E2E preparation failed. Check the local disposable database acknowledgement, migrations and fixture configuration.';
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const maxModules = 256;
const maxDependencies = 4096;
const requiredModules = ['CORE_ACCOUNTING', 'SALES', 'DATA_IMPORT'];
const invalid = () => { throw new Error('DB E2E requires an explicitly acknowledged local disposable test database and local E2E origin.'); };

export function validateE2eEnvironment(environment) {
  if (environment.NODE_ENV?.trim().toLowerCase() === 'production') invalid();
  let databaseUrl;
  let baseURL;
  try {
    if (typeof environment.DATABASE_URL !== 'string' || /[\u0000-\u0020\u007f]/u.test(environment.DATABASE_URL)) invalid();
    if (environment.E2E_BASE_URL !== undefined && (typeof environment.E2E_BASE_URL !== 'string'
      || /[\u0000-\u0020\u007f]/u.test(environment.E2E_BASE_URL))) invalid();
    databaseUrl = new URL(environment.DATABASE_URL);
    baseURL = new URL(environment.E2E_BASE_URL ?? 'http://127.0.0.1:3200');
    for (const credential of [databaseUrl.username, databaseUrl.password]) {
      if (/[\u0000-\u001f\u007f]/u.test(decodeURIComponent(credential))) invalid();
    }
  } catch { invalid(); }
  const databaseName = databaseUrl.pathname.slice(1);
  if (databaseUrl.protocol !== 'mysql:' || !loopbackHosts.has(databaseUrl.hostname)
    || databaseUrl.search || databaseUrl.hash || !databaseUrl.username
    || !/^[a-z][a-z0-9_]{0,63}$/u.test(databaseName)
    || !/^(?:test_[a-z0-9_]+|[a-z0-9_]+_test)$/u.test(databaseName)
    || /(?:^|_)(?:prod|production)(?:_|$)/u.test(databaseName)
    || environment.E2E_DISPOSABLE_DATABASE !== databaseName) invalid();
  if (baseURL.protocol !== 'http:' || !loopbackHosts.has(baseURL.hostname)
    || baseURL.username || baseURL.password || baseURL.pathname !== '/' || baseURL.search || baseURL.hash) invalid();
  // Do not allow a hosts-file alias to redirect the preparation connection.
  if (databaseUrl.hostname === 'localhost') databaseUrl.hostname = '127.0.0.1';
  if (baseURL.hostname === 'localhost') baseURL.hostname = '127.0.0.1';
  return { databaseUrl, baseURL, databaseName };
}

// Match the option arities of the installed Playwright Test CLI, not substrings in
// argv. In particular, a required value consumes even the next "--list" token.
// Unknown options and short boolean bundles fail closed before preparation.
const requiredOptions = new Set([
  '--browser', '--config', '--global-timeout', '--grep', '--grep-invert', '--last-failed-file',
  '--max-failures', '--output', '--project', '--repeat-each', '--reporter', '--retries',
  '--run-agents', '--shard', '--test-list', '--test-list-invert', '--timeout', '--trace',
  '--tsconfig', '--ui-host', '--ui-port', '--update-source-method', '--workers',
]);
const optionalOptions = new Set(['--debug', '--only-changed', '--update-snapshots']);
const booleanOptions = new Set([
  '--fail-on-flaky-tests', '--forbid-only', '--fully-parallel', '--headed', '--ignore-snapshots',
  '--last-failed', '--list', '--no-deps', '--pass-with-no-tests', '--quiet', '--ui', '--help', '--version', '-x',
]);
const shortOptions = new Map([
  ['-c', '--config'], ['-g', '--grep'], ['-G', '--grep-invert'], ['-j', '--workers'],
  ['-u', '--update-snapshots'], ['-h', '--help'], ['-V', '--version'],
]);

function inspectPlaywrightArguments(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) invalid();
  const found = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') break;
    if (!arg.startsWith('-') || arg === '-') continue; // File filters, including help/list/version.
    let option = arg;
    let attachedValue = false;
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      if (equals >= 0) { option = arg.slice(0, equals); attachedValue = true; }
    } else {
      option = shortOptions.get(arg.slice(0, 2)) ?? arg;
      attachedValue = arg.length > 2;
    }
    if (requiredOptions.has(option)) {
      if (!attachedValue && ++index >= args.length) invalid();
    } else if (optionalOptions.has(option)) {
      const next = args[index + 1];
      if (!attachedValue && next !== undefined && (!next.startsWith('-') || /^-\d+(?:\.\d+)?$/u.test(next))) index += 1;
    } else if (!booleanOptions.has(option) || attachedValue) invalid();
    found.add(option);
  }
  // This wrapper is scoped to the original DB gate, including test collection.
  if (found.has('--config')) invalid();
  const query = found.has('--version') ? 'version' : found.has('--help') ? 'help' : found.has('--list') ? 'list' : null;
  // UI and arbitrary reporters may start servers even when --list is present.
  if (query === 'list' && ['--ui', '--ui-host', '--ui-port', '--reporter'].some((option) => found.has(option))) invalid();
  return query;
}

export function isReadOnlyPlaywrightQuery(args) {
  try { return inspectPlaywrightArguments(args) !== null; } catch { return false; }
}

function queryArguments(args) {
  return inspectPlaywrightArguments(args) === 'version' ? ['--version'] : ['test', ...args];
}

const isVersionId = (value) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value)
  && BigInt(value) <= 18446744073709551615n;
const interruptedStatus = (signal) => 128 + (constants.signals[signal?.reason] ?? constants.signals.SIGTERM);
const assertNotInterrupted = (signal) => { if (signal?.aborted) throw new Error('DB E2E interrupted.'); };

export function resolveFixtureModules(modules, dependencies) {
  if (!Array.isArray(modules) || modules.length > maxModules
    || !Array.isArray(dependencies) || dependencies.length > maxDependencies) invalid();
  const byId = new Map();
  const byCode = new Map();
  for (const module of modules) {
    const id = String(module.id);
    if (typeof module.id !== 'bigint' || !isVersionId(id) || byId.has(id) || byCode.has(module.code)) invalid();
    byId.set(id, module);
    byCode.set(module.code, id);
  }
  const edges = new Map();
  for (const dependency of dependencies) {
    const from = String(dependency.moduleId);
    const to = String(dependency.dependsOnModuleId);
    if (typeof dependency.moduleId !== 'bigint' || typeof dependency.dependsOnModuleId !== 'bigint'
      || !byId.has(from) || !byId.has(to)) invalid();
    const targets = edges.get(from) ?? new Set();
    targets.add(to);
    edges.set(from, targets);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (!id || visiting.has(id) || byId.get(id)?.isActive !== true) invalid();
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of edges.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const code of requiredModules) visit(byCode.get(code));
  return [...visited].map(BigInt).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

async function openTestDatabase(configuration) {
  // Loaded only after the environment guard; --list/help/version work without builds or a DB driver.
  const { createDatabase } = await import('../../apps/api/dist/database.js');
  return createDatabase(configuration.databaseUrl.toString(), {
    connectionLimit: 1, minimumIdle: 0, acquireTimeoutMs: 5_000,
    connectTimeoutMs: 5_000, idleTimeoutSeconds: 5,
  });
}

export async function prepareStartPlanFixture(configuration, { openDatabase = openTestDatabase, signal } = {}) {
  assertNotInterrupted(signal);
  const database = await openDatabase(configuration);
  try {
    return await database.$transaction(async (tx) => {
      assertNotInterrupted(signal);
      const rows = await tx.$queryRaw`SELECT DATABASE() AS databaseName, @@port AS port`;
      if (rows.length !== 1 || rows[0].databaseName !== configuration.databaseName
        || String(rows[0].port) !== (configuration.databaseUrl.port || '3306')) invalid();
      const currencies = await tx.currency.findMany({
        where: { scopeKey: 'GLOBAL', code: 'YER', isActive: true }, select: { id: true }, take: 2,
      });
      if (currencies.length !== 1) invalid();
      const modules = await tx.platformModule.findMany({
        select: { id: true, code: true, isActive: true }, orderBy: { id: 'asc' }, take: maxModules + 1,
      });
      const dependencies = await tx.platformModuleDependency.findMany({
        select: { moduleId: true, dependsOnModuleId: true },
        orderBy: [{ moduleId: 'asc' }, { dependsOnModuleId: 'asc' }], take: maxDependencies + 1,
      });
      const moduleIds = resolveFixtureModules(modules, dependencies);
      // Explicit test-only workload allowances and prices, never commercial defaults or a production seed.
      // Use the database clock so publication is not ahead of the company created by that same database.
      const [clock] = await tx.$queryRaw`SELECT CURRENT_TIMESTAMP(3) AS now`;
      if (!(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime())) invalid();
      assertNotInterrupted(signal);
      const plan = await tx.platformPlan.create({ data: { code: `TEST_E2E_START_${randomUUID()}`, isActive: true }, select: { id: true } });
      if (typeof plan.id !== 'bigint' || !isVersionId(plan.id.toString())) invalid();
      assertNotInterrupted(signal);
      const version = await tx.platformPlanVersion.create({ data: {
        planId: plan.id, versionNumber: 1, displayName: 'DB E2E onboarding fixture',
        description: 'Disposable DB E2E only; not a commercial start-plan decision',
        billingCycle: 'MONTHLY', currencyCode: 'YER', selfServicePolicy: 'IMMEDIATE_FREE',
        recurringFee: '0', pricePerAdditionalUser: '0', pricePerAdditionalEmployee: '0', pricePerAdditionalPostedDocument: '0',
        includedUsers: 10, includedEmployees: 10, includedPostedDocuments: 100,
        trialDays: 0, taxRate: '0', paymentTermsDays: 0, publiclyListed: false,
        effectiveFrom: clock.now, publishedAt: clock.now,
        entitlements: { create: moduleIds.map((moduleId) => ({ moduleId, selectionMode: 'INCLUDED', additionalRecurringFee: null })) },
      }, select: { id: true } });
      assertNotInterrupted(signal);
      if (typeof version.id !== 'bigint') invalid();
      const versionId = version.id.toString();
      if (!isVersionId(versionId)) invalid();
      return versionId;
    }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 15_000 });
  } finally {
    // Never start the application while the fixture preparation pool is still open.
    await database.$disconnect();
  }
}

export function spawnPlaywright({ args, environment, signal }, spawnProcess = spawn) {
  assertNotInterrupted(signal);
  const query = inspectPlaywrightArguments(args);
  if (query === 'list' && (environment.PWTEST_WATCH || environment.PW_TEST_REPORTER)) invalid();
  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [playwrightCli, ...queryArguments(args)], {
      cwd: root,
      // The root CI config has an HTML reporter; an inherited setting must not open its server in list mode.
      env: query === 'list' ? { ...environment, PLAYWRIGHT_HTML_OPEN: 'never' } : environment,
      shell: false, windowsHide: true, stdio: 'inherit',
    });
    let finished = false;
    const forwardSignal = () => {
      if (finished) return;
      try { child.kill(signal.reason === 'SIGINT' ? 'SIGINT' : 'SIGTERM'); }
      catch { cleanup(); reject(new Error('DB E2E runner interruption failed.')); }
    };
    const cleanup = () => { finished = true; signal?.removeEventListener('abort', forwardSignal); };
    signal?.addEventListener('abort', forwardSignal, { once: true });
    child.once('error', () => { cleanup(); reject(new Error('DB E2E runner could not start.')); });
    child.once('close', (code, childSignal) => {
      cleanup();
      resolve(signal?.aborted ? interruptedStatus(signal)
        : childSignal ? 128 + (constants.signals[childSignal] ?? 1) : Number.isInteger(code) ? code : 1);
    });
    if (signal?.aborted) forwardSignal();
  });
}

export async function runDbE2e({ args = [], environment = process.env,
  prepareFixture = prepareStartPlanFixture, spawnChild = spawnPlaywright,
  reportError = (message) => console.error(message), signal } = {}) {
  try {
    assertNotInterrupted(signal);
    const query = inspectPlaywrightArguments(args);
    // Watch mode precedes the list runner; an injected reporter can also execute arbitrary startup code.
    if (query === 'list' && (environment.PWTEST_WATCH || environment.PW_TEST_REPORTER)) invalid();
    if (query !== null) return await spawnChild({ args, environment, signal });
    const configuration = validateE2eEnvironment(environment);
    const versionId = await prepareFixture(configuration, { signal });
    if (!isVersionId(versionId)) invalid();
    assertNotInterrupted(signal);
    return await spawnChild({ args, signal, environment: {
      ...environment, DATABASE_URL: configuration.databaseUrl.toString(), E2E_BASE_URL: configuration.baseURL.origin,
      PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID: versionId,
    } });
  } catch {
    if (signal?.aborted) return interruptedStatus(signal);
    // Driver/URL/parser/spawn exceptions can contain credentials. Never print their message, cause or stack.
    reportError(failureMessage);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const interrupt = () => controller.abort('SIGINT');
  const terminate = () => controller.abort('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try { process.exitCode = await runDbE2e({ args: process.argv.slice(2), signal: controller.signal }); }
  finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
}
