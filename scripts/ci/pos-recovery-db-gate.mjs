// CI-only gate: disposable N1 database, existing fixtures, exact named-case proof.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const databaseName = 'w1posrecovery';
const expectedFiles = new Map([
  ['pos-recovery-finalization.integration.test.ts', {
    describe: 'POS rejection finalization on an isolated real database',
    titles: [
      'rolls back the real effect row, seals the refusal and prevents replay work',
      'honors a committed rival between rollback and sealing; differentBody=false',
      'honors a committed rival between rollback and sealing; differentBody=true',
      'makes two competing sales wait for a terminal insert and replays its rejection to both',
      'converges three simultaneous refusing commands on one durable terminal row',
      'does not seal an unclassified error and rolls back the real effect',
      'does not begin owner work or reserve a row when the deadline already passed',
      'withholds rejection proof when the deadline is observed after the real terminal commit',
      'rolls back the terminal insert and withholds proof on a failure before its commit',
      'never terminalizes a successful real commit whose acknowledgement is lost',
      'keeps the durable rejection recoverable when its response is lost after real commit',
    ],
  }],
  ['pos.integration.test.ts', {
    describe: 'POS cash-sale vertical slice with MariaDB',
    titles: ['uses persisted selling defaults to post invoice, stock issue, receipt and journals once under concurrent retry'],
  }],
]);

export function verifyPosRecoveryReport(report) {
  assert.equal(report.success, true, 'N1 runner must succeed');
  for (const field of ['numFailedTests', 'numPendingTests', 'numTodoTests', 'numFailedTestSuites']) assert.equal(report[field], 0, `N1 ${field} must be zero`);
  assert.equal(report.numTotalTests, 12, 'N1 must execute all 11 finalization cases and the financial case');
  assert.equal(report.numPassedTests, 12);
  assert.equal(report.testResults?.length, 2, 'N1 must report exactly its two database files');
  const seen = new Set();
  for (const suite of report.testResults) {
    const file = path.basename(suite.name.replaceAll('\\', '/'));
    assert.ok(expectedFiles.has(file) && !seen.has(file), 'Unexpected or duplicate N1 suite');
    seen.add(file);
    const expected = expectedFiles.get(file);
    assert.equal(suite.status, 'passed', 'N1 suite did not pass');
    assert.equal(suite.assertionResults?.length, expected.titles.length, 'N1 suite case count changed');
    assert.ok(suite.assertionResults.every(result => result.status === 'passed'), 'Skipped or failed N1 cases are not acceptance');
    assert.deepEqual(suite.assertionResults.map(result => result.title).sort(), [...expected.titles].sort(), 'N1 must run the exact named cases');
    for (const result of suite.assertionResults) assert.deepEqual(result.ancestorTitles, [expected.describe], 'Unexpected N1 test group');
    assert.equal(new Set(suite.assertionResults.map(result => result.fullName)).size, expected.titles.length, 'N1 case names must be distinct');
  }
  return { finalizationPassed: 11, financialPassed: 1, skipped: 0 };
}

async function main(environment) {
  assert.equal(environment.CI, 'true', 'N1 database creation is CI-only');
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'N1 requires the disposable Actions service');
  assert.equal(environment.RUN_DB_TESTS, 'true', 'General DB opt-in is required');
  assert.equal(environment.RUN_POS_RECOVERY_FINALIZATION_DB_TESTS, 'true', 'N1 DB opt-in is required');
  assert.equal(environment.POS_RECOVERY_TEST_DATABASE, databaseName, 'N1 database acknowledgement differs');
  assert.equal(environment.POS_RECOVERY_CI_DATABASE_ACK, `CREATE:${databaseName}`, 'Explicit creation acknowledgement is required');
  assert.ok(environment.CI_ROOT_DATABASE_PASSWORD, 'CI root credential is required');
  assert.ok(environment.SEED_ADMIN_PASSWORD, 'Existing seeded admin fixture is required');
  const source = new URL(environment.DATABASE_URL);
  assert.equal(source.protocol, 'mysql:');
  assert.equal(source.hostname, '127.0.0.1');
  assert.equal(source.port, '3306');
  assert.equal(source.pathname, '/test_mcap_finance', 'N1 must start from the existing disposable CI service');
  assert.equal(source.search + source.hash, '', 'No database URL overrides are allowed');
  assert.equal(decodeURIComponent(source.username), 'mcap_test', 'Use the existing CI test identity');
  const version = environment.POS_RECOVERY_EXPECTED_ENGINE_VERSION;
  assert.ok(['10.11.11-MariaDB', '8.4.11'].includes(version), 'N1 requires one of the two pinned engines');
  const versionPattern = version === '8.4.11' ? /^8\.4\.11(?:[-.]|$)/ : /^10\.11\.11-MariaDB(?:[-.]|$)/;
  assert.ok(environment.RUNNER_TEMP && environment.POS_RECOVERY_DB_GATE_ARTIFACT_DIR, 'CI evidence paths are required');
  const artifacts = path.resolve(environment.POS_RECOVERY_DB_GATE_ARTIFACT_DIR);
  const relative = path.relative(path.resolve(environment.RUNNER_TEMP), artifacts);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Evidence must remain inside RUNNER_TEMP');
  await mkdir(artifacts, { recursive: true });
  const runDirectory = await mkdtemp(path.join(artifacts, 'run-'));
  const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
  const adapterRequire = createRequire(apiRequire.resolve('@prisma/adapter-mariadb'));
  const { createConnection } = adapterRequire('mariadb');
  const connectionOptions = { host: '127.0.0.1', port: 3306, connectTimeout: 10_000, socketTimeout: 30_000 };
  const identity = { user: 'mcap_test', password: decodeURIComponent(source.password) };
  async function inspect(options, expectedDatabase, expectedUser) {
    const connection = await createConnection({ ...connectionOptions, ...options });
    try {
      const [row] = await connection.query('SELECT DATABASE() AS databaseName, CURRENT_USER() AS principal, VERSION() AS version');
      assert.equal(row.databaseName, expectedDatabase, 'Connection selected the wrong database');
      assert.ok(row.principal.startsWith(`${expectedUser}@`), 'Unexpected database identity');
      assert.match(row.version, versionPattern, 'Database engine differs from its pinned CI image');
      return row.version;
    } finally { await connection.end(); }
  }
  const engine = await inspect({ ...identity, database: 'test_mcap_finance' }, 'test_mcap_finance', 'mcap_test');
  const admin = await createConnection({ ...connectionOptions, user: 'root', password: environment.CI_ROOT_DATABASE_PASSWORD });
  try {
    const [row] = await admin.query('SELECT VERSION() AS version');
    assert.equal(row.version, engine, 'Admin must connect to the same pinned service');
    // No IF NOT EXISTS, DROP, reset, user replacement, or grant outside this new database.
    await admin.query('CREATE DATABASE `w1posrecovery` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await admin.query("GRANT ALL PRIVILEGES ON `w1posrecovery`.* TO 'mcap_test'@'%'");
  } finally { await admin.end(); }
  const isolatedUrl = new URL(source); isolatedUrl.pathname = `/${databaseName}`;
  assert.equal(await inspect({ ...identity, database: databaseName }, databaseName, 'mcap_test'), engine);
  const childEnvironment = { ...environment, DATABASE_URL: isolatedUrl.href, NODE_OPTIONS: '--max-old-space-size=768',
    NODE_DISABLE_COMPILE_CACHE: '1', NODE_COMPILE_CACHE: undefined, GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB' };
  function run(program, args, timeout = 180_000) {
    const result = spawnSync(program, args, { cwd: root, env: childEnvironment, stdio: 'inherit', timeout });
    assert.equal(result.error, undefined, 'N1 child process failed or timed out');
    assert.equal(result.status, 0, 'N1 child process did not pass');
  }
  // Reuse the current schema, generated client and existing deterministic company fixtures.
  run('npm', ['exec', '-w', '@mcap/api', '--', 'prisma', 'migrate', 'deploy']);
  run('npm', ['exec', '-w', '@mcap/api', '--', 'prisma', 'migrate', 'status']);
  run('npm', ['run', 'prisma:seed', '-w', '@mcap/api']);
  const reportPath = path.join(runDirectory, 'vitest.json');
  await writeFile(path.join(runDirectory, 'database-identity.json'), `${JSON.stringify({ engine, databaseName, testIdentityVerified: true, createdFresh: true })}\n`);
  run(process.execPath, ['--max-old-space-size=768', 'node_modules/vitest/vitest.mjs', 'run', '--config', 'pos-recovery-db-vitest.config.ts',
    '--configLoader', 'runner', '--maxWorkers=1', '--no-file-parallelism', '--retry=0', '--reporter=default', '--reporter=json', `--outputFile=${reportPath}`], 420_000);
  const counts = verifyPosRecoveryReport(JSON.parse(await readFile(reportPath, 'utf8')));
  assert.equal(await inspect({ ...identity, database: databaseName }, databaseName, 'mcap_test'), engine);
  const sourceHashes = Object.fromEntries(await Promise.all(['apps/api/prisma/schema.prisma', ...[...expectedFiles.keys()].map(file => `apps/api/tests/${file}`)]
    .map(async file => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
  await writeFile(path.join(runDirectory, 'evidence.json'), `${JSON.stringify({ status: 'passed', engine, databaseName, ...counts, sourceHashes }, null, 2)}\n`);
  console.log(`N1 database gate passed: 11 finalization + 1 financial, zero skipped (${engine})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.env).catch(() => { console.error('N1 database gate failed; no acceptance recorded'); process.exitCode = 1; });
}
