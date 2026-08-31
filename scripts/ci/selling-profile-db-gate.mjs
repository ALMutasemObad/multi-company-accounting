import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const r2Migration = '20260831110000_sales_item_selling_profiles';
const root = fileURLToPath(new URL('../../', import.meta.url));
const apiDirectory = path.join(root, 'apps/api');
const sentinelName = 'R2 upgrade sentinel';

export function validateEnvironment(environment) {
  assert.equal(environment.RUN_R2_DB_TESTS, 'true', 'R2 database tests must be explicitly enabled');
  assert.ok(environment.R2_DATABASE_URL, 'R2_DATABASE_URL is required; no DATABASE_URL fallback');
  let url;
  try { url = new URL(environment.R2_DATABASE_URL); } catch { throw new Error('Invalid R2_DATABASE_URL'); }
  assert.equal(url.protocol, 'mysql:', 'R2 requires a MySQL protocol URL');
  assert.match(url.pathname, /^\/(?:test_|r2_test_)[a-z0-9_]+$/i, 'R2 requires a dedicated test_ or r2_test_ database');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'R2 CI may only connect to a loopback service');
  assert.equal(url.search + url.hash, '', 'R2 CI does not allow connection overrides in URL parameters');
  assert.equal(environment.DATABASE_URL, environment.R2_DATABASE_URL, 'CI migrations and R2 must target the same disposable database');
  assert.ok(['fresh', 'upgrade'].includes(environment.R2_DB_MIGRATION_MODE), 'R2 migration mode is required');
  assert.ok(environment.EXPECTED_DATABASE_VERSION_PREFIX, 'An explicit expected engine version is required');
  assert.ok(environment.R2_DB_GATE_ARTIFACT_DIR, 'R2 database evidence directory is required');
  return { url, mode: environment.R2_DB_MIGRATION_MODE, artifactDirectory: path.resolve(environment.R2_DB_GATE_ARTIFACT_DIR) };
}

export async function verifyEngine(connection, expectedPrefix) {
  const [engine] = await connection.query('SELECT VERSION() AS version');
  assert.match(engine?.version ?? '', /^(?:10\.11\..*MariaDB|8\.4\.)/i, 'R2 requires MariaDB 10.11 or MySQL 8.4');
  assert.ok(engine.version.startsWith(expectedPrefix), 'R2 engine does not match the CI matrix');
  return engine.version;
}

const readSentinel = async (connection, itemId) => {
  const [item] = await connection.query(
    'SELECT id, company_id, unit_of_measure_id, code, name_ar, version, is_active FROM inventory_items WHERE id = ?',
    [itemId],
  );
  assert.ok(item, 'R2 upgrade sentinel is missing');
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, String(value)]));
};

// CI fixture only: no operational writer, user data, schema reset, or broad cleanup.
export async function prepareUpgrade(connection, expectedBaselineCount) {
  assert.match(expectedBaselineCount ?? '', /^[1-9][0-9]*$/, 'The pinned baseline migration count is required');
  const migrations = await connection.query('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations');
  assert.equal(migrations.length, Number(expectedBaselineCount), 'Upgrade must start from the pinned populated baseline');
  assert.ok(migrations.every((migration) => migration.finished_at && !migration.rolled_back_at && migration.migration_name < r2Migration),
    'The sentinel must precede R2, with every baseline migration complete');
  const [table] = await connection.query(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    ['sales_item_selling_profiles'],
  );
  assert.equal(String(table?.count), '0', 'Refusing to create a sentinel after the R2 table exists');
  const [company] = await connection.query('SELECT id FROM companies ORDER BY id LIMIT 1');
  assert.ok(company, 'The production baseline must be populated before creating the sentinel');
  await connection.beginTransaction();
  try {
    const unit = await connection.query(
      'INSERT INTO units_of_measure (company_id, code, name_ar, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))',
      [company.id, 'R2_SENTINEL', sentinelName],
    );
    const item = await connection.query(
      'INSERT INTO inventory_items (company_id, unit_of_measure_id, code, name_ar, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))',
      // Fixed CI-only fixture outside the baseline sequence's range; it must
      // still obey the public item-code contract consumed by the old app.
      [company.id, unit.insertId, 'ITM-900000000001', sentinelName],
    );
    const sentinel = await readSentinel(connection, item.insertId);
    await connection.commit();
    return { migration: r2Migration, baselineMigrationCount: migrations.length, r2TableAbsentBeforeMigration: true, sentinel };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

export async function verifyUpgradedSentinel(connection, receipt, itemId, expectedBaselineCount) {
  assert.match(itemId ?? '', /^[1-9][0-9]*$/, 'Upgrade requires the pre-migration sentinel ID');
  assert.equal(receipt.migration, r2Migration);
  assert.equal(receipt.baselineMigrationCount, Number(expectedBaselineCount));
  assert.equal(receipt.r2TableAbsentBeforeMigration, true);
  assert.equal(receipt.sentinel?.id, itemId);
  assert.equal(receipt.sentinel.name_ar, sentinelName);
  assert.deepEqual(await readSentinel(connection, itemId), receipt.sentinel, 'The pre-migration Inventory row changed during upgrade');
  const [profiles] = await connection.query(
    'SELECT COUNT(*) AS count FROM sales_item_selling_profiles WHERE company_id = ? AND inventory_item_id = ?',
    [receipt.sentinel.company_id, itemId],
  );
  assert.equal(String(profiles?.count), '0', 'Upgrade must not invent a price for an existing item');
}

export function verifyTestReport(report) {
  assert.equal(report.success, true, 'The R2 test runner did not report success');
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 0, 'Skipped R2 database tests are not success');
  assert.equal(report.numTodoTests, 0, 'Todo R2 database tests are not success');
  assert.equal(report.testResults?.length, 1, 'Run only the R2 database integration file');
  const [suite] = report.testResults;
  assert.match(suite.name, /(?:^|[/\\])selling-profile\.integration\.test\.ts$/);
  assert.equal(suite.status, 'passed');
  const assertions = suite.assertionResults;
  assert.ok(assertions?.length >= 6, 'At least all six R2 database tests must execute');
  assert.ok(assertions.every((result) => result.status === 'passed'), 'Every R2 database assertion must pass, without skip');
  assert.equal(report.numTotalTests, assertions.length);
  assert.equal(report.numPassedTests, assertions.length);
  return assertions.length;
}

async function main(environment, action) {
  assert.ok(['preflight-upgrade', 'prepare-upgrade', 'run'].includes(action), 'Usage: selling-profile-db-gate.mjs preflight-upgrade|prepare-upgrade|run');
  const configuration = validateEnvironment(environment);
  if (action !== 'run') assert.equal(configuration.mode, 'upgrade');
  await mkdir(configuration.artifactDirectory, { recursive: true });
  const receiptPath = path.join(configuration.artifactDirectory, 'upgrade-sentinel.json');
  // Use the existing adapter's locked MariaDB driver; no new dependency or Prisma generation.
  const apiRequire = createRequire(path.join(apiDirectory, 'package.json'));
  const adapterRequire = createRequire(apiRequire.resolve('@prisma/adapter-mariadb'));
  const { createConnection } = adapterRequire('mariadb');
  const connection = await createConnection({
    host: configuration.url.hostname === '[::1]' ? '::1' : configuration.url.hostname,
    port: Number(configuration.url.port || '3306'),
    user: decodeURIComponent(configuration.url.username),
    password: decodeURIComponent(configuration.url.password),
    database: configuration.url.pathname.slice(1),
    connectTimeout: 10_000, socketTimeout: 30_000,
  });
  let engine;
  try {
    engine = await verifyEngine(connection, environment.EXPECTED_DATABASE_VERSION_PREFIX);
    if (action === 'preflight-upgrade') {
      console.log('R2 upgrade target and supported engine verified before baseline mutations');
      return;
    }
    if (action === 'prepare-upgrade') {
      const receipt = await prepareUpgrade(connection, environment.PRODUCTION_BASELINE_MIGRATION_COUNT);
      await writeFile(receiptPath, `${JSON.stringify({ ...receipt, engine }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      process.stdout.write(receipt.sentinel.id);
      return;
    }
    const applied = await connection.query(
      'SELECT migration_name FROM _prisma_migrations WHERE migration_name = ? AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
      [r2Migration],
    );
    assert.equal(applied.length, 1, 'R2 migration must be deployed before the database suite');
    if (configuration.mode === 'upgrade') {
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      assert.equal(receipt.engine, engine, 'Sentinel proof must belong to the same engine run');
      await verifyUpgradedSentinel(connection, receipt, environment.R2_UPGRADE_SENTINEL_ITEM_ID, environment.PRODUCTION_BASELINE_MIGRATION_COUNT);
    }
  } finally {
    await connection.end();
  }
  // A fresh report directory prevents an old passing report from masking a skipped/failed run.
  const runDirectory = await mkdtemp(path.join(configuration.artifactDirectory, 'run-'));
  const reportPath = path.join(runDirectory, 'vitest.json');
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/selling-profile.integration.test.ts',
    '--no-file-parallelism', '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile=${reportPath}`,
  ], { cwd: apiDirectory, env: environment, stdio: 'inherit', timeout: 180_000 });
  assert.equal(result.error, undefined, 'The R2 database runner failed or timed out');
  assert.equal(result.status, 0, 'The R2 database suite failed');
  const passedTests = verifyTestReport(JSON.parse(await readFile(reportPath, 'utf8')));
  const evidence = { status: 'passed', mode: configuration.mode, engine, passedTests, skippedTests: 0,
    upgradeSentinelVerified: configuration.mode === 'upgrade', migration: r2Migration };
  await writeFile(path.join(runDirectory, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`R2 database gate: ${passedTests} passed, zero skipped (${configuration.mode}, ${engine})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.env, process.argv[2]).catch((error) => {
    // Never emit URLs or credentials from assertion values or driver error objects.
    const message = String(error.message).split('\n')[0].replace(/mysql:\/\/\S+/gi, '[redacted database URL]');
    console.error(`R2 database gate failed: ${message}`);
    process.exitCode = 1;
  });
}
