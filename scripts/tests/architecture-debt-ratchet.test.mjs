import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateRegister, normalizeRepositoryPath } from '../architecture-debt-ratchet.mjs';

const debtPath = 'apps/api/src/fiscal/financial-close-service.ts';
const exceptionPath = 'apps/api/src/accounts/default-chart-template.ts';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function fixture(source = 'code: "3300"\ncode: "3300"\n') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'architecture-debt-ratchet-'));
  await mkdir(path.join(root, path.dirname(debtPath)), { recursive: true });
  await mkdir(path.join(root, path.dirname(exceptionPath)), { recursive: true });
  await writeFile(path.join(root, debtPath), source);
  await writeFile(path.join(root, exceptionPath), "{ key: 'retained-earnings', code: '3300' }\n");
  return root;
}

function register(overrides = {}) {
  return {
    schemaVersion: 1,
    entries: [{
      id: 'ADR-023-test', owner: 'Core Accounting', removalSlice: 'ADM-5C', rationale: 'test',
      paths: [debtPath], matcher: { type: 'literal', value: 'code: "3300"' },
      baseline: { occurrences: 2, locations: [{ path: debtPath, line: 1, column: 1 }, { path: debtPath, line: 2, column: 1 }] },
      expiry: '2026-12-31',
      exceptions: [{ path: exceptionPath, matcher: { type: 'literal', value: "code: '3300'" }, rationale: 'semantic default' }],
      ...overrides,
    }],
  };
}

test('accepts the registered baseline and semantic default-chart exception', async () => {
  const root = await fixture();
  const result = await evaluateRegister({ root, register: register(), now: new Date('2026-09-15T00:00:00Z') });
  assert.equal(result[0].occurrences, 2);
});

test('rejects an increased occurrence count', async () => {
  const root = await fixture('code: "3300"\ncode: "3300"\ncode: "3300"\n');
  await assert.rejects(() => evaluateRegister({ root, register: register(), now: new Date('2026-09-15T00:00:00Z') }), /count increased/);
});

test('requires lowering the baseline when an occurrence is removed', async () => {
  const root = await fixture('code: "3300"\n');
  await assert.rejects(() => evaluateRegister({ root, register: register(), now: new Date('2026-09-15T00:00:00Z') }), /lower the baseline/);
});

test('rejects relocated occurrences and expired entries', async () => {
  const root = await fixture('\ncode: "3300"\ncode: "3300"\n');
  await assert.rejects(() => evaluateRegister({ root, register: register(), now: new Date('2026-09-15T00:00:00Z') }), /location changed/);
  await assert.rejects(() => evaluateRegister({ root, register: register({ expiry: '2026-01-01' }), now: new Date('2026-09-15T00:00:00Z') }), /expired/);
});

test('validates paths, ownership and Windows path normalization', async () => {
  const root = await fixture();
  assert.equal(normalizeRepositoryPath('apps\\api\\src\\fiscal\\financial-close-service.ts'), debtPath);
  const windowsRegister = register({
    paths: [debtPath.replaceAll('/', '\\')],
    baseline: { occurrences: 2, locations: [{ path: debtPath.replaceAll('/', '\\'), line: 1, column: 1 }, { path: debtPath.replaceAll('/', '\\'), line: 2, column: 1 }] },
  });
  await evaluateRegister({ root, register: windowsRegister, now: new Date('2026-09-15T00:00:00Z') });
  await assert.rejects(() => evaluateRegister({ root, register: register({ owner: '', paths: ['apps\\api\\src\\fiscal\\financial-close-service.ts'] }), now: new Date('2026-09-15T00:00:00Z') }), /missing owner/);
  await assert.rejects(() => evaluateRegister({ root, register: register({ paths: ['apps/**/financial-close-service.ts'] }), now: new Date('2026-09-15T00:00:00Z') }), /non-glob/);
});

test('rejects every entry missing required ownership, removal, matching, baseline or expiry metadata', async (context) => {
  const root = await fixture();
  for (const field of ['owner', 'removalSlice', 'rationale', 'paths', 'matcher', 'baseline', 'expiry']) {
    await context.test(field, async () => {
      const incomplete = register();
      delete incomplete.entries[0][field];
      await assert.rejects(
        () => evaluateRegister({ root, register: incomplete, now: new Date('2026-09-15T00:00:00Z') }),
        new RegExp(`missing ${field}`),
      );
    });
  }
});

test('accepts an empty debt register after every debt is removed and rejects impossible calendar dates', async () => {
  const root = await fixture();
  await assert.doesNotReject(() => evaluateRegister({ root, register: { schemaVersion: 1, entries: [] }, now: new Date('2026-09-15T00:00:00Z') }));
  await assert.rejects(() => evaluateRegister({ root, register: register({ expiry: '2026-02-31' }), now: new Date('2026-01-01T00:00:00Z') }), /expiry must be an ISO date/);
});

test('exposes package scripts and runs each dependency-free architecture guard once before npm install', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['architecture-debt:check'], 'node scripts/architecture-debt-ratchet.mjs');
  assert.equal(packageJson.scripts['architecture-debt:test'], 'node --test scripts/tests/architecture-debt-ratchet.test.mjs');

  const workflow = await readFile(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
  const boundaryStep = 'run: node scripts/architecture-boundaries.mjs';
  const debtStep = 'run: node scripts/architecture-debt-ratchet.mjs';
  const npmInstall = 'run: npm install --global npm@12.0.2';
  const verify = workflow.slice(workflow.indexOf('\n  verify:'), workflow.indexOf('\n  deploy-staging:'));
  assert.equal(verify.split(boundaryStep).length - 1, 1);
  assert.equal(verify.split(debtStep).length - 1, 1);
  assert.ok(verify.indexOf(boundaryStep) < verify.indexOf(debtStep));
  assert.ok(verify.indexOf(debtStep) < verify.indexOf(npmInstall));
});
