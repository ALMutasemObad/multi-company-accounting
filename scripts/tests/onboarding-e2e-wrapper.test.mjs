import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { constants } from 'node:os';
import test from 'node:test';
import { inspect } from 'node:util';
import {
  isReadOnlyPlaywrightQuery,
  prepareStartPlanFixture,
  resolveFixtureModules,
  runDbE2e,
  spawnPlaywright,
  validateE2eEnvironment,
} from '../e2e/run-db-e2e.mjs';

// Synthetic credentials are deliberately recognizable in redaction assertions.
// Every execution hook below is injected: these tests never connect to a DB or
// start Playwright, an API server, a migration, or a seed process.
const syntheticUser = 'wrapper-private-user';
const syntheticPassword = 'wrapper-private-password';
const databaseName = 'test_mcap_finance';
const syntheticDatabaseUrl = `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1:3306/${databaseName}`;
const dynamicPlanVersionId = '9007199254740993';

function environment(overrides = {}) {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: syntheticDatabaseUrl,
    E2E_DISPOSABLE_DATABASE: databaseName,
    E2E_BASE_URL: 'http://127.0.0.1:3200',
    ...overrides,
  };
}

function errorText(error) {
  return typeof error === 'string' ? error : inspect(error, { depth: 8 });
}

function assertSanitized(error) {
  const text = errorText(error);
  assert.doesNotMatch(text, /wrapper-private-|mysql:\/\/|postgres:\/\/|private-env-token/u);
  assert.ok(text.length > 0);
}

const invalidEnvironments = [
  ['absent database URL', { DATABASE_URL: undefined }],
  ['empty database URL', { DATABASE_URL: '' }],
  ['malformed database URL', { DATABASE_URL: 'wrapper-private-password not a URL' }],
  ['non-MySQL database URL', { DATABASE_URL: `postgres://${syntheticUser}:${syntheticPassword}@127.0.0.1/${databaseName}` }],
  ['remote database', { DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@database.example/${databaseName}` }],
  ['loopback-looking remote hostname', { DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1.example/${databaseName}` }],
  ['wildcard database address', { DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@0.0.0.0/${databaseName}` }],
  ['absent database name', { DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1/` }],
  ['multiple database path segments', { DATABASE_URL: `${syntheticDatabaseUrl}/another` }],
  ['encoded database path separator', { DATABASE_URL: `${syntheticDatabaseUrl}%2Fanother` }],
  ['encoded database name', { DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1/%74est_mcap_finance` }],
  ['database URL fragment', { DATABASE_URL: `${syntheticDatabaseUrl}#wrapper-private-password` }],
  ['database socket override', { DATABASE_URL: `${syntheticDatabaseUrl}?socket=/tmp/private.sock` }],
  ['database connection query override', { DATABASE_URL: `${syntheticDatabaseUrl}?connection_limit=99` }],
  ['control character in database URL', { DATABASE_URL: `${syntheticDatabaseUrl}\n` }],
  ['encoded control character in database credentials', { DATABASE_URL: `mysql://wrapper-private-user%0A:${syntheticPassword}@127.0.0.1/${databaseName}` }],
  ['missing disposable acknowledgement', { E2E_DISPOSABLE_DATABASE: undefined }],
  ['empty disposable acknowledgement', { E2E_DISPOSABLE_DATABASE: '' }],
  ['different acknowledged database', { E2E_DISPOSABLE_DATABASE: 'test_another_database' }],
  ['padded disposable acknowledgement', { E2E_DISPOSABLE_DATABASE: ` ${databaseName} ` }],
  ['ordinary development database even with acknowledgement', {
    DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1/mcap_finance`,
    E2E_DISPOSABLE_DATABASE: 'mcap_finance',
  }],
  ['uppercase database name', {
    DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1/Test_mcap_finance`,
    E2E_DISPOSABLE_DATABASE: 'Test_mcap_finance',
  }],
  ['production token inside an otherwise test-shaped database name', {
    DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1/test_production_finance`,
    E2E_DISPOSABLE_DATABASE: 'test_production_finance',
  }],
  ['prod token inside an otherwise test-shaped database name', {
    DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1/test_prod_finance`,
    E2E_DISPOSABLE_DATABASE: 'test_prod_finance',
  }],
  ['database name longer than 64 characters', {
    DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1/test_${'a'.repeat(60)}`,
    E2E_DISPOSABLE_DATABASE: `test_${'a'.repeat(60)}`,
  }],
  ['production environment on loopback', { NODE_ENV: 'production' }],
  ['CI without disposable acknowledgement', { CI: 'true', E2E_DISPOSABLE_DATABASE: undefined }],
  ['remote E2E endpoint', { E2E_BASE_URL: 'https://accounting.example' }],
  ['HTTPS loopback endpoint unsupported by the HTTP-only application server', { E2E_BASE_URL: 'https://127.0.0.1:3200' }],
  ['empty E2E endpoint', { E2E_BASE_URL: '' }],
  ['loopback-looking remote E2E endpoint', { E2E_BASE_URL: 'http://localhost.example:3200' }],
  ['wildcard E2E address', { E2E_BASE_URL: 'http://0.0.0.0:3200' }],
  ['non-HTTP E2E endpoint', { E2E_BASE_URL: 'file:///tmp/test_mcap_finance' }],
  ['E2E endpoint credentials', { E2E_BASE_URL: `http://${syntheticUser}:${syntheticPassword}@127.0.0.1:3200` }],
  ['E2E endpoint path', { E2E_BASE_URL: 'http://127.0.0.1:3200/private' }],
  ['E2E endpoint query', { E2E_BASE_URL: 'http://127.0.0.1:3200?token=private-env-token' }],
  ['E2E endpoint fragment', { E2E_BASE_URL: 'http://127.0.0.1:3200#private-env-token' }],
  ['control character in E2E endpoint', { E2E_BASE_URL: 'http://127.0.0.1:3200\n' }],
];

test('the E2E environment requires an explicitly acknowledged test database and defaults to a local HTTP origin', () => {
  const input = Object.freeze(environment({ E2E_BASE_URL: undefined }));
  const config = validateE2eEnvironment(input);

  assert.ok(config.databaseUrl instanceof URL);
  assert.equal(config.databaseUrl.protocol, 'mysql:');
  assert.equal(config.databaseUrl.hostname, '127.0.0.1');
  assert.equal(config.databaseName, databaseName);
  assert.ok(config.baseURL instanceof URL);
  assert.equal(config.baseURL.origin, 'http://127.0.0.1:3200');
  assert.equal(input.E2E_BASE_URL, undefined);
});

for (const name of ['test_mcap_finance', 'mcap_finance_test', 'test_w1_onboarding_20260831', `test_${'a'.repeat(59)}`]) {
  test(`acknowledged disposable name ${name} is accepted`, () => {
    const config = validateE2eEnvironment(environment({
      DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@127.0.0.1/${name}`,
      E2E_DISPOSABLE_DATABASE: name,
    }));
    assert.equal(config.databaseName, name);
  });
}

for (const host of ['localhost', '127.0.0.1', '[::1]']) {
  test(`explicit loopback host ${host} is accepted only with the matching database acknowledgement`, () => {
    const config = validateE2eEnvironment(environment({
      DATABASE_URL: `mysql://${syntheticUser}:${syntheticPassword}@${host}:3306/${databaseName}`,
      E2E_BASE_URL: `http://${host}:3200`,
    }));
    assert.equal(config.databaseName, databaseName);
    assert.equal(config.databaseUrl.hostname, host === 'localhost' ? '127.0.0.1' : host);
    assert.equal(config.baseURL.hostname, host === 'localhost' ? '127.0.0.1' : host);
  });
}

for (const [label, overrides] of invalidEnvironments) {
  test(`environment guard rejects ${label} without leaking configuration`, () => {
    assert.throws(() => validateE2eEnvironment(environment(overrides)), (error) => {
      assertSanitized(error);
      return true;
    });
  });

  test(`wrapper rejects ${label} before preparation or child execution`, async () => {
    let preparations = 0;
    let children = 0;
    const errors = [];
    const status = await runDbE2e({
      args: [],
      environment: environment(overrides),
      prepareFixture: async () => { preparations += 1; return dynamicPlanVersionId; },
      spawnChild: async () => { children += 1; return 0; },
      reportError: (error) => errors.push(error),
    });

    assert.equal(status, 1);
    assert.equal(preparations, 0);
    assert.equal(children, 0);
    assert.equal(errors.length, 1);
    assertSanitized(errors[0]);
  });
}

for (const args of [
  ['--list'], ['--help'], ['-h'], ['--version'], ['-V'],
  ['--list', '--project=chromium'],
  ['tests/e2e/onboarding-and-first-document.spec.ts', '--list'],
  ['--help', '--headed'], ['--help', '--ui'],
  ['--debug', '--list'], ['--only-changed', '--list'],
  ['--grep', '--list', '--list'],
  ['--project', '--help', '--list'],
]) {
  test(`${args.join(' ')} is read-only and bypasses both environment validation and fixture preparation`, async () => {
    assert.equal(isReadOnlyPlaywrightQuery(args), true);
    const input = Object.freeze({
      NODE_ENV: 'production',
      DATABASE_URL: 'wrapper-private-password invalid URL',
      E2E_BASE_URL: 'https://remote.example',
      UNRELATED_MARKER: 'read-only-environment',
    });
    const original = { ...input };
    let preparations = 0;
    let children = 0;
    const errors = [];
    const status = await runDbE2e({
      args,
      environment: input,
      prepareFixture: async () => { preparations += 1; throw new Error('must not prepare a read-only query'); },
      spawnChild: async (child) => {
        children += 1;
        assert.deepEqual(child.args, args);
        assert.deepEqual(child.environment, original);
        return 23;
      },
      reportError: (error) => errors.push(error),
    });

    assert.equal(status, 23);
    assert.equal(preparations, 0);
    assert.equal(children, 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(input, original);
  });
}

test('ordinary runs and lookalike query arguments cannot skip the environment guard', () => {
  for (const args of [
    [], ['tests/e2e/onboarding-and-first-document.spec.ts'], ['--project=chromium'],
    ['--ui'], ['--headed'], ['--listing'], ['--list=false'], ['--helpful'],
    ['--', '--list'], ['--', '--help'], ['list'], ['help'], ['version'],
    ['--grep', '--list'], ['--project', '--help'], ['-g--list'], ['--grep=--list'],
  ]) {
    assert.equal(isReadOnlyPlaywrightQuery(args), false, JSON.stringify(args));
  }
});

for (const args of [
  ['--list=false'], ['--help=x'], ['--version=x'], ['-hV'], ['-xV'], ['--unknown'],
  ['--grep'], ['--project'], ['--config', 'playwright.http-fixture.config.ts'],
  ['--list', '--config=playwright.http-fixture.config.ts'],
  ['--help', '-cplaywright.http-fixture.config.ts'],
  ['--list', '--ui'], ['--list', '--ui-host', '127.0.0.1'], ['--ui-port=3000', '--list'],
  ['--list', '--reporter=html'], ['--list', '--reporter', './custom-reporter.mjs'],
]) {
  test(`ambiguous query syntax ${args.join(' ')} is rejected before fixture preparation or child execution`, async () => {
    assert.equal(isReadOnlyPlaywrightQuery(args), false);
    let preparations = 0;
    let children = 0;
    const errors = [];
    const status = await runDbE2e({
      args,
      environment: environment(),
      prepareFixture: async () => { preparations += 1; return dynamicPlanVersionId; },
      spawnChild: async () => { children += 1; return 0; },
      reportError: (error) => errors.push(error),
    });

    assert.equal(status, 1);
    assert.equal(preparations, 0);
    assert.equal(children, 0);
    assert.equal(errors.length, 1);
    assertSanitized(errors[0]);
  });
}

for (const args of [
  ['--grep', '--list'], ['--project', '--help'], ['--reporter', '--version'],
  ['-g--list'], ['--grep=--list'], ['--', '--list'], ['--', '--help'],
  ['list'], ['help'], ['version'],
]) {
  test(`file filters or consumed option values ${args.join(' ')} cannot bypass fixture preparation`, async () => {
    let preparations = 0;
    let children = 0;
    const errors = [];
    const status = await runDbE2e({
      args,
      environment: environment(),
      prepareFixture: async () => { preparations += 1; return dynamicPlanVersionId; },
      spawnChild: async (child) => {
        children += 1;
        assert.equal(preparations, 1);
        assert.deepEqual(child.args, args);
        assert.equal(child.environment.PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID, dynamicPlanVersionId);
        return 0;
      },
      reportError: (error) => errors.push(error),
    });

    assert.equal(status, 0);
    assert.equal(preparations, 1);
    assert.equal(children, 1);
    assert.deepEqual(errors, []);
  });
}

for (const watch of ['1', '0', 'false']) {
  test(`truthy PWTEST_WATCH=${watch} cannot turn --list into an interactive run`, async () => {
    let preparations = 0;
    let children = 0;
    const errors = [];
    const status = await runDbE2e({
      args: ['--list'],
      environment: environment({ PWTEST_WATCH: watch }),
      prepareFixture: async () => { preparations += 1; return dynamicPlanVersionId; },
      spawnChild: async () => { children += 1; return 0; },
      reportError: (error) => errors.push(error),
    });

    assert.equal(status, 1);
    assert.equal(preparations, 0);
    assert.equal(children, 0);
    assert.equal(errors.length, 1);
    assertSanitized(errors[0]);
  });
}

test('PW_TEST_REPORTER cannot inject a custom reporter into --list before preparation or child execution', async () => {
  let preparations = 0;
  let children = 0;
  const errors = [];
  const status = await runDbE2e({
    args: ['--list'],
    environment: environment({ PW_TEST_REPORTER: './custom-reporter.mjs' }),
    prepareFixture: async () => { preparations += 1; return dynamicPlanVersionId; },
    spawnChild: async () => { children += 1; return 0; },
    reportError: (error) => errors.push(error),
  });

  assert.equal(status, 1);
  assert.equal(preparations, 0);
  assert.equal(children, 0);
  assert.equal(errors.length, 1);
  assertSanitized(errors[0]);
});

for (const invalidId of ['', '0', '-1', '01', '1.5', '1e2', ' 1 ', '18446744073709551616', undefined, null, 1, 1n]) {
  test(`the child is never started with invalid prepared identifier ${String(invalidId)} (${typeof invalidId})`, async () => {
    let children = 0;
    const errors = [];
    const status = await runDbE2e({
      environment: environment({ PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID: '111' }),
      prepareFixture: async () => invalidId,
      spawnChild: async () => { children += 1; return 0; },
      reportError: (error) => errors.push(error),
    });

    assert.equal(status, 1);
    assert.equal(children, 0);
    assert.equal(errors.length, 1);
    assertSanitized(errors[0]);
  });
}

test('the highest unsigned BIGINT identifier remains an exact string in the child environment', async () => {
  const maximumId = '18446744073709551615';
  const errors = [];
  const status = await runDbE2e({
    environment: environment(),
    prepareFixture: async () => maximumId,
    spawnChild: async (child) => {
      assert.equal(child.environment.PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID, maximumId);
      return 0;
    },
    reportError: (error) => errors.push(error),
  });

  assert.equal(status, 0);
  assert.deepEqual(errors, []);
});

test('fixture preparation must finish before the child receives the exact generated BIGINT identifier', async () => {
  const input = Object.freeze(environment({
    PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID: '111',
    UNRELATED_MARKER: 'preserved',
  }));
  const original = { ...input };
  const args = ['tests/e2e/onboarding-and-first-document.spec.ts', '--workers=1'];
  const events = [];
  let signalPreparationStarted;
  let finishPreparation;
  const preparationStarted = new Promise((resolve) => { signalPreparationStarted = resolve; });
  const preparationMayFinish = new Promise((resolve) => { finishPreparation = resolve; });
  const errors = [];

  const pending = runDbE2e({
    args,
    environment: input,
    prepareFixture: async (config) => {
      events.push('prepare-start');
      assert.equal(config.databaseName, databaseName);
      assert.equal(config.databaseUrl.href, syntheticDatabaseUrl);
      signalPreparationStarted();
      await preparationMayFinish;
      // Preparation owns and closes its connection before resolving this hook.
      events.push('prepare-closed');
      return dynamicPlanVersionId;
    },
    spawnChild: async (child) => {
      events.push('spawn');
      assert.deepEqual(child.args, args);
      assert.equal(child.environment.PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID, dynamicPlanVersionId);
      assert.equal(typeof child.environment.PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID, 'string');
      assert.equal(child.environment.DATABASE_URL, syntheticDatabaseUrl);
      assert.equal(child.environment.E2E_DISPOSABLE_DATABASE, databaseName);
      assert.equal(child.environment.UNRELATED_MARKER, 'preserved');
      return 17;
    },
    reportError: (error) => errors.push(error),
  });

  await Promise.race([
    preparationStarted,
    pending.then(() => { throw new Error('wrapper completed before entering preparation'); }),
  ]);
  assert.deepEqual(events, ['prepare-start']);
  finishPreparation();
  assert.equal(await pending, 17);
  assert.deepEqual(events, ['prepare-start', 'prepare-closed', 'spawn']);
  assert.deepEqual(errors, []);
  assert.deepEqual(input, original);
});

test('fixture failure returns a sanitized failure and never runs Playwright or retries preparation', async () => {
  let preparations = 0;
  let children = 0;
  const errors = [];
  const status = await runDbE2e({
    environment: environment({ PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID: '111' }),
    prepareFixture: async () => {
      preparations += 1;
      throw new Error(`fixture failed for ${syntheticDatabaseUrl}`, { cause: new Error('private-env-token') });
    },
    spawnChild: async () => { children += 1; return 0; },
    reportError: (error) => errors.push(error),
  });

  assert.equal(status, 1);
  assert.equal(preparations, 1);
  assert.equal(children, 0);
  assert.equal(errors.length, 1);
  assertSanitized(errors[0]);
});

test('child execution failure is sanitized and does not prepare or spawn again', async () => {
  let preparations = 0;
  let children = 0;
  const errors = [];
  const status = await runDbE2e({
    environment: environment(),
    prepareFixture: async () => { preparations += 1; return dynamicPlanVersionId; },
    spawnChild: async () => {
      children += 1;
      throw new Error(`spawn failed with ${syntheticDatabaseUrl}`);
    },
    reportError: (error) => errors.push(error),
  });

  assert.equal(status, 1);
  assert.equal(preparations, 1);
  assert.equal(children, 1);
  assert.equal(errors.length, 1);
  assertSanitized(errors[0]);
});

const fixtureModules = [
  { id: 4n, code: 'DATA_IMPORT', isActive: true },
  { id: 2n, code: 'TAX', isActive: true },
  { id: 5n, code: 'UNRELATED_OPTIONAL', isActive: true },
  { id: 3n, code: 'SALES', isActive: true },
  { id: 1n, code: 'CORE_ACCOUNTING', isActive: true },
];
const fixtureDependencies = [
  { moduleId: 4n, dependsOnModuleId: 3n },
  { moduleId: 3n, dependsOnModuleId: 2n },
  { moduleId: 2n, dependsOnModuleId: 1n },
];

test('fixture modules include the three journey modules and only their active transitive dependencies', () => {
  assert.deepEqual(resolveFixtureModules(fixtureModules, fixtureDependencies), [1n, 2n, 3n, 4n]);
  assert.deepEqual(resolveFixtureModules(
    fixtureModules.map((module) => module.id === 5n ? { ...module, isActive: false } : module),
    fixtureDependencies,
  ), [1n, 2n, 3n, 4n]);
});

const invalidCatalogs = [
  ['missing required journey module', fixtureModules.filter((module) => module.code !== 'DATA_IMPORT'), []],
  ['inactive required module', fixtureModules.map((module) => module.code === 'SALES' ? { ...module, isActive: false } : module), fixtureDependencies],
  ['inactive transitive dependency', fixtureModules.map((module) => module.code === 'TAX' ? { ...module, isActive: false } : module), fixtureDependencies],
  ['missing dependency endpoint', fixtureModules, [...fixtureDependencies, { moduleId: 3n, dependsOnModuleId: 99n }]],
  ['missing dependency source', fixtureModules, [...fixtureDependencies, { moduleId: 99n, dependsOnModuleId: 1n }]],
  ['reachable dependency cycle', fixtureModules, [...fixtureDependencies, { moduleId: 1n, dependsOnModuleId: 3n }]],
  ['self dependency cycle', fixtureModules, [...fixtureDependencies, { moduleId: 1n, dependsOnModuleId: 1n }]],
  ['duplicate module identifier', [...fixtureModules, { id: 1n, code: 'DUPLICATE_ID', isActive: true }], fixtureDependencies],
  ['duplicate module code', [...fixtureModules, { id: 6n, code: 'SALES', isActive: true }], fixtureDependencies],
  ['invalid module identifier', [...fixtureModules, { id: 0n, code: 'INVALID_ID', isActive: true }], fixtureDependencies],
  ['too many modules', [
    ...fixtureModules,
    ...Array.from({ length: 252 }, (_, index) => ({ id: BigInt(index + 100), code: `EXTRA_${index}`, isActive: true })),
  ], fixtureDependencies],
  ['too many dependencies', fixtureModules, Array.from({ length: 4097 }, () => ({ moduleId: 3n, dependsOnModuleId: 1n }))],
];

for (const [label, modules, dependencies] of invalidCatalogs) {
  test(`fixture dependency closure fails closed for ${label}`, () => {
    assert.throws(() => resolveFixtureModules(modules, dependencies), (error) => {
      assertSanitized(error);
      return true;
    });
  });
}

function databaseFixture(overrides = {}) {
  const events = [];
  const writes = [];
  const reads = [];
  const state = { transactions: 0, commits: 0, rollbacks: 0, disconnects: 0, options: undefined };
  const now = new Date('2026-08-31T09:00:00.000Z');
  const tx = {
    $queryRaw: async (strings) => {
      const query = strings.join('');
      if (query.includes('DATABASE()')) {
        events.push('identity');
        return overrides.identityRows ?? [{ databaseName, port: 3306n }];
      }
      assert.match(query, /CURRENT_TIMESTAMP/u);
      events.push('clock');
      return overrides.clockRows ?? [{ now }];
    },
    currency: {
      findMany: async (query) => {
        reads.push(['currency', query]);
        return overrides.currencies ?? [{ id: 1n }];
      },
    },
    platformModule: {
      findMany: async (query) => {
        reads.push(['modules', query]);
        return overrides.modules ?? fixtureModules;
      },
    },
    platformModuleDependency: {
      findMany: async (query) => {
        reads.push(['dependencies', query]);
        return overrides.dependencies ?? fixtureDependencies;
      },
    },
    platformPlan: {
      create: async (query) => {
        events.push('plan-create');
        writes.push(['plan', query]);
        if (overrides.failAt === 'plan') throw new Error(`fixture write failed with ${syntheticDatabaseUrl}`);
        return { id: 101n };
      },
    },
    platformPlanVersion: {
      create: async (query) => {
        events.push('version-create');
        writes.push(['version', query]);
        if (overrides.failAt === 'version') throw new Error(`fixture write failed with ${syntheticDatabaseUrl}`);
        return { id: overrides.versionId ?? BigInt(dynamicPlanVersionId) };
      },
    },
  };
  const database = {
    $transaction: async (body, options) => {
      state.transactions += 1;
      state.options = options;
      events.push('transaction-start');
      try {
        const result = await body(tx);
        state.commits += 1;
        events.push('transaction-commit');
        return result;
      } catch (error) {
        // This fake observes callback rejection, not physical database rollback.
        // The DB E2E acceptance gate must still prove rollback on both engines.
        state.rollbacks += 1;
        events.push('transaction-reject');
        throw error;
      }
    },
    $disconnect: async () => {
      state.disconnects += 1;
      events.push('disconnect');
      if (overrides.failAt === 'disconnect') throw new Error(`disconnect failed with ${syntheticDatabaseUrl}`);
    },
  };
  return { database, events, writes, reads, state, now };
}

for (const identityRows of [
  [],
  [{ databaseName: 'test_another_database', port: 3306 }],
  [{ databaseName: 'mcap_finance', port: 3306 }],
  [{ databaseName, port: 3317 }],
  [{ databaseName, port: null }],
  [{ databaseName, port: 3306 }, { databaseName, port: 3306 }],
]) {
  test(`fixture preparation rejects database identity ${JSON.stringify(identityRows)} before writes`, async () => {
    const fixture = databaseFixture({ identityRows });
    const config = validateE2eEnvironment(environment());
    await assert.rejects(prepareStartPlanFixture(config, {
      openDatabase: async () => fixture.database,
    }));

    assert.deepEqual(fixture.writes, []);
    assert.deepEqual(fixture.reads, []);
    assert.equal(fixture.state.commits, 0);
    assert.equal(fixture.state.rollbacks, 1);
    assert.equal(fixture.state.disconnects, 1);
    assert.deepEqual(fixture.events, ['transaction-start', 'identity', 'transaction-reject', 'disconnect']);
  });
}

test('fixture preparation creates an unlisted explicit zero-price YER version in a bounded serializable transaction', async () => {
  const fixture = databaseFixture();
  const config = validateE2eEnvironment(environment());
  let connections = 0;
  const id = await prepareStartPlanFixture(config, {
    openDatabase: async (received) => {
      connections += 1;
      assert.equal(received, config);
      return fixture.database;
    },
  });

  assert.equal(connections, 1);
  assert.equal(id, dynamicPlanVersionId);
  assert.deepEqual(fixture.state.options, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 });
  assert.equal(fixture.state.commits, 1);
  assert.equal(fixture.state.rollbacks, 0);
  assert.equal(fixture.state.disconnects, 1);
  assert.equal(fixture.events.at(-1), 'disconnect');
  assert.equal(fixture.writes.length, 2);
  const plan = fixture.writes.find(([kind]) => kind === 'plan')[1].data;
  const version = fixture.writes.find(([kind]) => kind === 'version')[1].data;
  assert.match(plan.code, /^TEST_E2E_START_[0-9a-f-]{36}$/u);
  assert.equal(plan.isActive, true);
  assert.equal(version.planId, 101n);
  assert.equal(version.currencyCode, 'YER');
  assert.equal(version.selfServicePolicy, 'IMMEDIATE_FREE');
  assert.equal(version.publiclyListed, false);
  assert.equal(version.trialDays, 0);
  assert.equal(version.recurringFee, '0');
  assert.equal(version.pricePerAdditionalUser, '0');
  assert.equal(version.pricePerAdditionalEmployee, '0');
  assert.equal(version.pricePerAdditionalPostedDocument, '0');
  assert.equal(version.includedUsers, 10);
  assert.equal(version.includedEmployees, 10);
  assert.equal(version.includedPostedDocuments, 100);
  assert.equal(version.effectiveFrom, fixture.now);
  assert.equal(version.publishedAt, fixture.now);
  assert.deepEqual(version.entitlements.create.map(({ moduleId }) => moduleId), [1n, 2n, 3n, 4n]);
  assert.ok(version.entitlements.create.every(({ selectionMode }) => selectionMode === 'INCLUDED'));
  assert.deepEqual(fixture.reads.find(([kind]) => kind === 'currency')[1], {
    where: { scopeKey: 'GLOBAL', code: 'YER', isActive: true }, select: { id: true }, take: 2,
  });
  assert.equal(fixture.reads.find(([kind]) => kind === 'modules')[1].take, 257);
  assert.equal(fixture.reads.find(([kind]) => kind === 'dependencies')[1].take, 4097);
});

for (const [label, overrides] of [
  ['absent active YER currency', { currencies: [] }],
  ['ambiguous active YER currency', { currencies: [{ id: 1n }, { id: 2n }] }],
  ['inactive transitive module', { modules: fixtureModules.map((module) => module.id === 2n ? { ...module, isActive: false } : module) }],
  ['cyclic dependencies', { dependencies: [...fixtureDependencies, { moduleId: 1n, dependsOnModuleId: 3n }] }],
  ['missing database clock', { clockRows: [] }],
  ['invalid database clock', { clockRows: [{ now: new Date('invalid') }] }],
]) {
  test(`fixture preparation rejects ${label} before writing and closes its connection`, async () => {
    const fixture = databaseFixture(overrides);
    await assert.rejects(prepareStartPlanFixture(validateE2eEnvironment(environment()), {
      openDatabase: async () => fixture.database,
    }));

    assert.deepEqual(fixture.writes, []);
    assert.equal(fixture.state.commits, 0);
    assert.equal(fixture.state.rollbacks, 1);
    assert.equal(fixture.state.disconnects, 1);
  });
}

for (const failAt of ['plan', 'version']) {
  test(`fixture ${failAt} write failure rejects the transaction, disconnects, and cannot launch the child`, async () => {
    const fixture = databaseFixture({ failAt });
    let children = 0;
    const errors = [];
    const status = await runDbE2e({
      environment: environment(),
      prepareFixture: (config, options) => prepareStartPlanFixture(config, {
        ...options, openDatabase: async () => fixture.database,
      }),
      spawnChild: async () => { children += 1; return 0; },
      reportError: (error) => errors.push(error),
    });

    assert.equal(status, 1);
    assert.equal(children, 0);
    assert.equal(fixture.state.transactions, 1);
    assert.equal(fixture.state.commits, 0);
    assert.equal(fixture.state.rollbacks, 1);
    assert.equal(fixture.state.disconnects, 1);
    assert.equal(fixture.events.at(-1), 'disconnect');
    assert.equal(errors.length, 1);
    assertSanitized(errors[0]);
  });
}

test('the real preparation helper closes its connection before runDbE2e launches the child', async () => {
  const fixture = databaseFixture();
  const errors = [];
  const status = await runDbE2e({
    environment: environment(),
    prepareFixture: (config, options) => prepareStartPlanFixture(config, {
      ...options, openDatabase: async () => fixture.database,
    }),
    spawnChild: async (child) => {
      assert.equal(fixture.state.disconnects, 1);
      assert.equal(fixture.events.at(-1), 'disconnect');
      assert.equal(child.environment.PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID, dynamicPlanVersionId);
      fixture.events.push('spawn');
      return 0;
    },
    reportError: (error) => errors.push(error),
  });

  assert.equal(status, 0);
  assert.equal(fixture.events.at(-1), 'spawn');
  assert.deepEqual(errors, []);
});

test('disconnect failure prevents child execution even after a committed fixture and stays sanitized', async () => {
  const fixture = databaseFixture({ failAt: 'disconnect' });
  let children = 0;
  const errors = [];
  const status = await runDbE2e({
    environment: environment(),
    prepareFixture: (config, options) => prepareStartPlanFixture(config, {
      ...options, openDatabase: async () => fixture.database,
    }),
    spawnChild: async () => { children += 1; return 0; },
    reportError: (error) => errors.push(error),
  });

  assert.equal(status, 1);
  assert.equal(children, 0);
  assert.equal(fixture.state.commits, 1);
  assert.equal(fixture.state.disconnects, 1);
  assert.equal(errors.length, 1);
  assertSanitized(errors[0]);
});

test('database opening failure is sanitized without starting a child or retrying the connection', async () => {
  let connections = 0;
  let children = 0;
  const errors = [];
  const status = await runDbE2e({
    environment: environment(),
    prepareFixture: (config, options) => prepareStartPlanFixture(config, {
      ...options,
      openDatabase: async () => {
        connections += 1;
        throw new Error(`connection refused for ${syntheticDatabaseUrl}`);
      },
    }),
    spawnChild: async () => { children += 1; return 0; },
    reportError: (error) => errors.push(error),
  });

  assert.equal(status, 1);
  assert.equal(connections, 1);
  assert.equal(children, 0);
  assert.equal(errors.length, 1);
  assertSanitized(errors[0]);
});

for (const reason of ['SIGINT', 'SIGTERM']) {
  test(`an already cancelled ${reason} run never prepares a fixture or starts a child`, async () => {
    const controller = new AbortController();
    controller.abort(reason);
    let preparations = 0;
    let children = 0;
    const errors = [];
    const status = await runDbE2e({
      environment: environment(),
      signal: controller.signal,
      prepareFixture: async () => { preparations += 1; return dynamicPlanVersionId; },
      spawnChild: async () => { children += 1; return 0; },
      reportError: (error) => errors.push(error),
    });

    assert.equal(status, 128 + constants.signals[reason]);
    assert.equal(preparations, 0);
    assert.equal(children, 0);
    assert.deepEqual(errors, []);
  });
}

test('cancellation after fixture preparation prevents child execution', async () => {
  const controller = new AbortController();
  let children = 0;
  const errors = [];
  const status = await runDbE2e({
    environment: environment(),
    signal: controller.signal,
    prepareFixture: async (_config, options) => {
      assert.equal(options.signal, controller.signal);
      controller.abort('SIGTERM');
      return dynamicPlanVersionId;
    },
    spawnChild: async () => { children += 1; return 0; },
    reportError: (error) => errors.push(error),
  });

  assert.equal(status, 128 + constants.signals.SIGTERM);
  assert.equal(children, 0);
  assert.deepEqual(errors, []);
});

test('preparation cancellation is checked before opening the database', async () => {
  const controller = new AbortController();
  controller.abort('SIGINT');
  let connections = 0;
  await assert.rejects(prepareStartPlanFixture(validateE2eEnvironment(environment()), {
    signal: controller.signal,
    openDatabase: async () => { connections += 1; return databaseFixture().database; },
  }));
  assert.equal(connections, 0);
});

function childFixture() {
  // An event-only child fake verifies forwarding and status mapping. It is not
  // evidence of Windows process-tree or grandchild cleanup by a real process.
  const child = new EventEmitter();
  const invocations = [];
  const kills = [];
  child.kill = (signal) => { kills.push(signal); return true; };
  const spawnProcess = (executable, args, options) => {
    invocations.push({ executable, args, options });
    return child;
  };
  return { child, invocations, kills, spawnProcess };
}

test('Playwright is spawned directly without a shell, with a hidden Windows process and the prepared environment', async () => {
  const fixture = childFixture();
  const input = environment({ PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID: dynamicPlanVersionId });
  const pending = spawnPlaywright({ args: ['--workers=1'], environment: input }, fixture.spawnProcess);

  assert.equal(fixture.invocations.length, 1);
  const invocation = fixture.invocations[0];
  assert.equal(invocation.executable, process.execPath);
  assert.match(invocation.args[0].replaceAll('\\', '/'), /\/node_modules\/@playwright\/test\/cli\.js$/u);
  assert.deepEqual(invocation.args.slice(1), ['test', '--workers=1']);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.env, input);
  assert.equal(invocation.options.stdio, 'inherit');
  fixture.child.emit('close', 29, null);
  assert.equal(await pending, 29);
  assert.deepEqual(fixture.kills, []);
});

for (const [args, expected] of [
  [['--version'], ['--version']],
  [['-V'], ['--version']],
  [['--help'], ['test', '--help']],
  [['-h'], ['test', '-h']],
  [['--list', '--project=chromium'], ['test', '--list', '--project=chromium']],
  [['--grep', '--list', '--list'], ['test', '--grep', '--list', '--list']],
]) {
  test(`read-only query ${args.join(' ')} is forwarded as a Playwright query`, async () => {
    const fixture = childFixture();
    const pending = spawnPlaywright({ args, environment: {} }, fixture.spawnProcess);
    assert.deepEqual(fixture.invocations[0].args.slice(1), expected);
    fixture.child.emit('close', 0, null);
    assert.equal(await pending, 0);
  });
}

for (const reason of ['SIGINT', 'SIGTERM']) {
  test(`Playwright forwards ${reason} only to its owned child and preserves the signal exit status`, async () => {
    const fixture = childFixture();
    const controller = new AbortController();
    const pending = spawnPlaywright({
      args: [], environment: environment(), signal: controller.signal,
    }, fixture.spawnProcess);

    controller.abort(reason);
    assert.deepEqual(fixture.kills, [reason]);
    fixture.child.emit('close', null, reason);
    assert.equal(await pending, 128 + constants.signals[reason]);
  });

  test(`parent ${reason} remains an interrupted exit even when the child closes gracefully with code zero`, async () => {
    const fixture = childFixture();
    const controller = new AbortController();
    const pending = spawnPlaywright({
      args: [], environment: environment(), signal: controller.signal,
    }, fixture.spawnProcess);

    controller.abort(reason);
    fixture.child.emit('close', 0, null);
    assert.equal(await pending, 128 + constants.signals[reason]);
    assert.deepEqual(fixture.kills, [reason]);
  });
}

test('the spawn helper independently refuses watch mode combined with --list before creating a process', () => {
  const fixture = childFixture();
  assert.throws(() => spawnPlaywright({
    args: ['--list'], environment: environment({ PWTEST_WATCH: '1' }),
  }, fixture.spawnProcess));
  assert.equal(fixture.invocations.length, 0);
});

test('the spawn helper independently refuses PW_TEST_REPORTER with --list before creating a process', () => {
  const fixture = childFixture();
  assert.throws(() => spawnPlaywright({
    args: ['--list'], environment: environment({ PW_TEST_REPORTER: './custom-reporter.mjs' }),
  }, fixture.spawnProcess));
  assert.equal(fixture.invocations.length, 0);
});

test('actual list spawning disables automatic HTML report opening without mutating its input environment', async () => {
  const fixture = childFixture();
  const input = Object.freeze(environment({
    CI: 'true',
    PLAYWRIGHT_HTML_OPEN: 'always',
    UNRELATED_MARKER: 'preserved',
  }));
  const original = { ...input };
  const pending = spawnPlaywright({ args: ['--list'], environment: input }, fixture.spawnProcess);

  assert.equal(fixture.invocations.length, 1);
  const childEnvironment = fixture.invocations[0].options.env;
  assert.notEqual(childEnvironment, input);
  assert.equal(childEnvironment.PLAYWRIGHT_HTML_OPEN, 'never');
  assert.equal(childEnvironment.CI, 'true');
  assert.equal(childEnvironment.UNRELATED_MARKER, 'preserved');
  assert.deepEqual(input, original);
  fixture.child.emit('close', 0, null);
  assert.equal(await pending, 0);
  assert.deepEqual(input, original);
});

test('a completed Playwright child is never signalled by a later cancellation', async () => {
  const fixture = childFixture();
  const controller = new AbortController();
  const pending = spawnPlaywright({
    args: [], environment: environment(), signal: controller.signal,
  }, fixture.spawnProcess);
  fixture.child.emit('close', 0, null);
  assert.equal(await pending, 0);
  controller.abort('SIGTERM');
  assert.deepEqual(fixture.kills, []);
});

test('a Playwright spawn error is sanitized before it reaches the wrapper reporter', async () => {
  const fixture = childFixture();
  const pending = spawnPlaywright({ args: [], environment: environment() }, fixture.spawnProcess);
  fixture.child.emit('error', new Error(`cannot spawn with ${syntheticDatabaseUrl}`));
  await assert.rejects(pending, (error) => {
    assertSanitized(error);
    return true;
  });
});
