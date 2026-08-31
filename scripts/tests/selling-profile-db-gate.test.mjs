import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseDocument } from 'yaml';
import {
  prepareUpgrade, r2Migration, validateEnvironment, verifyEngine, verifyTestReport, verifyUpgradedSentinel,
} from '../ci/selling-profile-db-gate.mjs';

const environment = {
  RUN_R2_DB_TESTS: 'true',
  DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3306/test_mcap_finance',
  R2_DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3306/test_mcap_finance',
  R2_DB_MIGRATION_MODE: 'fresh', EXPECTED_DATABASE_VERSION_PREFIX: '8.4.',
  R2_DB_GATE_ARTIFACT_DIR: 'tmp/ci/r2-db-gate',
};

test('R2 gate requires explicit opt-in, a dedicated loopback URL, matching migration target and mode', () => {
  assert.equal(validateEnvironment(environment).mode, 'fresh');
  for (const overrides of [
    { RUN_R2_DB_TESTS: 'false' }, { RUN_R2_DB_TESTS: undefined }, { R2_DATABASE_URL: undefined },
    { R2_DB_MIGRATION_MODE: undefined }, { R2_DB_MIGRATION_MODE: 'prod' },
    { EXPECTED_DATABASE_VERSION_PREFIX: undefined }, { R2_DB_GATE_ARTIFACT_DIR: undefined },
    { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3306/test_other' },
  ]) assert.throws(() => validateEnvironment({ ...environment, ...overrides }));
  for (const url of [
    'not a URL', 'postgres://fixture:fixture@127.0.0.1/test_fixture',
    'mysql://fixture:fixture@127.0.0.1/mcap_finance_test', 'mysql://fixture:fixture@127.0.0.1/test_',
    'mysql://fixture:fixture@127.0.0.1/test_fixture%2fproduction',
    'mysql://fixture:fixture@127.0.0.1/test_fixture?socket=/private/database.sock',
    'mysql://fixture:fixture@hosting.example/test_fixture',
  ]) assert.throws(() => validateEnvironment({ ...environment, DATABASE_URL: url, R2_DATABASE_URL: url }));
});

test('the CLI refuses missing opt-in before any driver connection or fixture work', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../ci/selling-profile-db-gate.mjs', import.meta.url)), 'run'],
    { env: { ...environment, RUN_R2_DB_TESTS: 'false' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be explicitly enabled/);
  assert.doesNotMatch(result.stderr, /mysql:\/\//);
});

test('engine firewall accepts only supported releases and the exact CI matrix family', async () => {
  for (const [version, prefix] of [['10.11.11-MariaDB-ubu2204', '10.11.11-MariaDB'], ['8.4.11', '8.4.']]) {
    assert.equal(await verifyEngine({ query: async () => [{ version }] }, prefix), version);
  }
  for (const [version, prefix] of [['10.4.32-MariaDB', '10.4.'], ['8.0.41', '8.0.'], ['8.4.11', '10.11.11-MariaDB']]) {
    await assert.rejects(verifyEngine({ query: async () => [{ version }] }, prefix));
  }
});

const sentinel = { id: '91', company_id: '7', unit_of_measure_id: '90', code: 'R2-UPGRADE-SENTINEL',
  name_ar: 'R2 upgrade sentinel', version: '0', is_active: '1' };
function fakeDatabase(options = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM _prisma_migrations')) return options.migrations ?? [
        { migration_name: '20260824200000_inventory_item_catalog', finished_at: new Date(), rolled_back_at: null },
      ];
      if (sql.includes('information_schema.tables')) return [{ count: options.tableCount ?? 0n }];
      if (sql.includes('FROM companies')) return options.emptyCompany ? [] : [{ id: 7n }];
      if (sql.startsWith('INSERT INTO units_of_measure')) return { insertId: 90n };
      if (sql.startsWith('INSERT INTO inventory_items')) {
        if (options.failInsert) throw new Error('fixture insert failed');
        return { insertId: 91n };
      }
      if (sql.includes('FROM inventory_items')) return options.itemMissing ? [] : [options.sentinel ?? sentinel];
      if (sql.includes('FROM sales_item_selling_profiles')) return [{ count: options.profileCount ?? 0n }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async beginTransaction() { calls.push({ sql: 'BEGIN' }); },
    async commit() { calls.push({ sql: 'COMMIT' }); },
    async rollback() { calls.push({ sql: 'ROLLBACK' }); },
  };
}

test('upgrade fixture proves baseline history and absent R2 table before writing a real Inventory row', async () => {
  const connection = fakeDatabase();
  const receipt = await prepareUpgrade(connection, '1');
  assert.deepEqual(receipt, { migration: r2Migration, baselineMigrationCount: 1, r2TableAbsentBeforeMigration: true, sentinel });
  const queries = connection.calls.map((call) => call.sql);
  const tableCheck = queries.findIndex((sql) => sql.includes('information_schema.tables'));
  const insert = queries.findIndex((sql) => sql.startsWith('INSERT INTO inventory_items'));
  assert.ok(tableCheck >= 0 && insert > tableCheck);
  assert.equal(queries.at(-1), 'COMMIT');
  const itemWrite = connection.calls[insert];
  assert.deepEqual(itemWrite.values, [7n, 90n, 'R2-UPGRADE-SENTINEL', 'R2 upgrade sentinel']);
  assert.ok(itemWrite.sql.includes('VALUES (?, ?, ?, ?,'), 'fixture values must remain parameterized');
});

test('sentinel preparation fails closed before writes on wrong, partial, empty or already advanced baselines', async () => {
  for (const options of [
    { tableCount: 1n }, { emptyCompany: true }, { migrations: [] },
    { migrations: [{ migration_name: r2Migration, finished_at: new Date(), rolled_back_at: null }] },
    { migrations: [{ migration_name: '20260824200000_inventory_item_catalog', finished_at: null, rolled_back_at: null }] },
  ]) {
    const connection = fakeDatabase(options);
    await assert.rejects(prepareUpgrade(connection, '1'));
    assert.ok(!connection.calls.some((call) => call.sql.startsWith('INSERT')));
  }
  await assert.rejects(prepareUpgrade(fakeDatabase(), undefined));
});

test('a failed sentinel insert rolls back both fixture rows', async () => {
  const connection = fakeDatabase({ failInsert: true });
  await assert.rejects(prepareUpgrade(connection, '1'), /fixture insert failed/);
  assert.equal(connection.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!connection.calls.some((call) => call.sql === 'COMMIT'));
});

test('after upgrade the exact Inventory snapshot survives without an invented selling price', async () => {
  const receipt = await prepareUpgrade(fakeDatabase(), '1');
  await verifyUpgradedSentinel(fakeDatabase(), receipt, '91', '1');
  for (const options of [{ itemMissing: true }, { profileCount: 1n }, { sentinel: { ...sentinel, company_id: '8' } }]) {
    await assert.rejects(verifyUpgradedSentinel(fakeDatabase(options), receipt, '91', '1'));
  }
  await assert.rejects(verifyUpgradedSentinel(fakeDatabase(), receipt, undefined, '1'));
  await assert.rejects(verifyUpgradedSentinel(fakeDatabase(), receipt, '92', '1'));
  await assert.rejects(verifyUpgradedSentinel(fakeDatabase(), { ...receipt, r2TableAbsentBeforeMigration: false }, '91', '1'));
});

function passingReport() {
  return { success: true, numTotalTests: 6, numPassedTests: 6, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [{ name: '/repo/apps/api/tests/selling-profile.integration.test.ts', status: 'passed',
      assertionResults: Array.from({ length: 6 }, () => ({ status: 'passed' })) }] };
}

test('a successful runner exit is insufficient: all six actual DB assertions must pass without skips', () => {
  assert.equal(verifyTestReport(passingReport()), 6);
  for (const change of [
    (report) => { report.success = false; },
    (report) => { report.numPendingTests = 6; },
    (report) => { report.numTodoTests = 1; },
    (report) => { report.numFailedTests = 1; },
    (report) => { report.testResults = []; },
    (report) => { report.testResults[0].status = 'failed'; },
    (report) => { report.testResults[0].name = 'some-other.test.ts'; },
    (report) => { report.testResults[0].assertionResults = []; },
    (report) => { report.testResults[0].assertionResults.pop(); },
    (report) => { report.testResults[0].assertionResults[0].status = 'pending'; },
    (report) => { report.numPassedTests = 0; },
  ]) { const report = passingReport(); change(report); assert.throws(() => verifyTestReport(report)); }
});

const workflow = parseDocument(await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')).toJS();
const upgradeScript = await readFile(new URL('../ci/database-upgrade-compatibility.sh', import.meta.url), 'utf8');

test('fresh MariaDB/MySQL and both populated upgrade jobs wire explicit R2 opt-in to disposable service databases', () => {
  for (const [id, mode] of [['hosting-compatibility', 'fresh'], ['verify', 'fresh'], ['migration-upgrade-compatibility', 'upgrade']]) {
    const job = workflow.jobs[id];
    assert.equal(job.env.RUN_R2_DB_TESTS, 'true');
    assert.equal(job.env.R2_DB_MIGRATION_MODE, mode);
    // The runner context is unavailable in jobs.<job_id>.env. Resolve it only
    // after the runner has started, before the DB preflight or evidence writer.
    assert.equal(job.env.R2_DB_GATE_ARTIFACT_DIR, undefined);
    assert.doesNotMatch(JSON.stringify(job.env), /\$\{\{\s*runner\./);
    assert.equal(job.steps[0].run, 'echo "R2_DB_GATE_ARTIFACT_DIR=$RUNNER_TEMP/r2-db-gate" >> "$GITHUB_ENV"');
    assert.equal(job.env.DATABASE_URL, job.env.R2_DATABASE_URL);
    assert.equal(new URL(job.env.R2_DATABASE_URL).pathname, '/test_mcap_finance');
    assert.equal(Object.values(job.services)[0].env.MYSQL_DATABASE, 'test_mcap_finance');
    assert.ok(job.steps.some((step) => step.uses?.startsWith('actions/upload-artifact@') && step.if === 'always()' && step.with.path.includes('r2-db-gate')));
    if (mode === 'fresh') {
      const migrationIndex = job.steps.findIndex((step) => step.run?.includes('prisma migrate deploy'));
      const gateIndex = job.steps.findIndex((step) => step.run === 'node scripts/ci/selling-profile-db-gate.mjs run');
      assert.ok(migrationIndex >= 0 && gateIndex > migrationIndex);
      assert.equal(job.steps[gateIndex]['continue-on-error'], undefined);
    }
  }
  assert.match(workflow.jobs['hosting-compatibility'].services.mariadb.image, /^mariadb:10\.11\./);
  assert.match(workflow.jobs.verify.services.mysql.image, /^mysql:8\.4\./);
  assert.deepEqual(workflow.jobs['migration-upgrade-compatibility'].strategy.matrix.include.map((entry) => entry.engine_name), ['MariaDB 10.11', 'MySQL 8.4']);
  assert.deepEqual(workflow.jobs['deploy-staging'].needs, ['hosting-compatibility', 'migration-upgrade-compatibility', 'verify']);
});

test('upgrade captures sentinel after baseline fixtures and verifies it immediately after candidate migrations', () => {
  const preflight = upgradeScript.indexOf('selling-profile-db-gate.mjs" preflight-upgrade');
  const firstMigration = upgradeScript.indexOf('"$baseline_prisma" migrate deploy');
  const baselineSeed = upgradeScript.indexOf('"$baseline_tsx" prisma/demo-seed.ts');
  const prepare = upgradeScript.indexOf('selling-profile-db-gate.mjs" prepare-upgrade');
  const migration = upgradeScript.indexOf('"$prisma" migrate deploy');
  const gate = upgradeScript.indexOf('selling-profile-db-gate.mjs" run');
  const previousTests = upgradeScript.indexOf('"$baseline_vitest" run');
  assert.ok(preflight > 0 && firstMigration > preflight && baselineSeed > firstMigration);
  assert.ok(prepare > baselineSeed && migration > prepare && gate > migration && previousTests > gate);
  assert.match(upgradeScript, /export R2_UPGRADE_SENTINEL_ITEM_ID/);
  assert.match(upgradeScript, /R2_UPGRADE_SENTINEL_ITEM_ID=%s\\n[\s\S]*GITHUB_ENV/);
  assert.doesNotMatch(upgradeScript, /selling-profile-db-gate[^\n]*\|\| true/);
});

test('the R2 currency fixture obeys the real GLOBAL scope CHECK and can be reused without modifying a row', async () => {
  const source = await readFile(new URL('../../apps/api/tests/selling-profile.integration.test.ts', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../../apps/api/prisma/migrations/20260821200000_company_owned_currencies/migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /`scope` = 'GLOBAL' AND `scope_key` = 'GLOBAL'/);
  assert.match(source, /currency\.upsert\(\{ where: \{ scopeKey_code: \{ scopeKey: "GLOBAL", code: "XTS" \} \}/);
  assert.match(source, /scope: "GLOBAL", scopeKey: "GLOBAL" \}, update: \{\}/);
  assert.doesNotMatch(source, /scopeKey: fixtureId/);
});

test('grocery frontend HTTP-harness gate is typed, runs after Chromium installation and retains failure artifacts', () => {
  const steps = workflow.jobs.verify.steps;
  assert.ok(steps.some((step) => step.run?.includes('node node_modules/typescript/bin/tsc -p tsconfig.grocery-integration.json --noEmit')));
  const install = steps.findIndex((step) => step.run?.includes('install --with-deps chromium'));
  const run = steps.findIndex((step) => step.run === 'node node_modules/@playwright/test/cli.js test --config playwright.grocery-integration.config.ts');
  assert.ok(install >= 0 && run > install);
  assert.match(steps[run].name, /HTTP harness/);
  assert.equal(steps[run]['continue-on-error'], undefined);
  assert.ok(steps.some((step) => step.uses?.startsWith('actions/upload-artifact@') && step.with.path.includes('tmp/agent/grocery-integration-results/')));
});
