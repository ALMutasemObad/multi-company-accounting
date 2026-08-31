import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseDocument } from 'yaml';

const root = new URL('../../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

test('release UI gate includes real application journeys and the independent billing recovery harness', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const configuration = await read('playwright.integration.config.ts');
  const workflow = parseDocument(await read('.github/workflows/ci.yml')).toJS();
  const steps = workflow.jobs.verify.steps;
  assert.equal(packageJson.scripts['subscription-qa:test'], 'playwright test --config playwright.integration.config.ts && playwright test --config playwright.track-e.config.ts');
  assert.equal(packageJson.scripts['subscription-qa:typecheck'], 'tsc -p tsconfig.integration.json && tsc -p tsconfig.track-e.json');
  assert.ok(steps.some((step) => step.run === 'npm run subscription-qa:test'));
  assert.ok(steps.some((step) => step.run?.includes('npm run subscription-qa:typecheck')));
  for (const include of ['visual/**/*.spec.ts', 'track-b/**/*.spec.ts', 'track-d/**/*.spec.ts']) assert.ok(configuration.includes(include));
  assert.match(configuration, /retries: 0/u);
  assert.match(configuration, /workers: 1/u);
  assert.match(configuration, /reuseExistingServer: false/u);
  const artifacts = steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@')).map((step) => step.with.path).join('\n');
  assert.ok(artifacts.includes('test-results/subscription-readiness-integration/'));
  assert.ok(artifacts.includes('test-results/track-e/'));
});

test('the local HTTP probe supplements but cannot replace either real database release gate', async () => {
  const workflow = parseDocument(await read('.github/workflows/ci.yml')).toJS();
  const maria = workflow.jobs['hosting-compatibility'];
  const mysql = workflow.jobs.verify;
  assert.match(maria.services.mariadb.image, /^mariadb:10\.11\./u);
  assert.match(mysql.services.mysql.image, /^mysql:8\.4/u);
  for (const job of [maria, mysql]) {
    const commands = job.steps.map((step) => step.run ?? '').join('\n');
    assert.match(commands, /npm run test:db -w @mcap\/api/u);
    assert.match(commands, /npm run e2e/u);
    assert.match(commands, /prisma migrate deploy/u);
    assert.doesNotMatch(commands, /performance:subscription-reads/u);
  }
  assert.ok(workflow.jobs['migration-upgrade-compatibility']);
});
