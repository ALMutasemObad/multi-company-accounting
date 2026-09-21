import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkBoundaries, extractImports, matches, validateManifest } from '../architecture-boundaries.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(repository, 'scripts/architecture-boundaries.mjs');
const policy = JSON.parse(await readFile(path.join(repository, 'architecture-boundaries.json'), 'utf8'));
// Keep generated fixtures outside the repository so parallel repository scanners
// cannot observe a fixture between its creation and cleanup.
const fixtureParent = path.resolve(process.env.RUNNER_TEMP || tmpdir());

async function fixture(t, files = {}, manifest = structuredClone(policy)) {
  const root = await mkdtemp(path.join(fixtureParent, 'mcap-architecture-boundary-'));
  t.after(async () => {
    assert.equal(path.dirname(root), fixtureParent);
    assert.ok(path.basename(root).startsWith('mcap-architecture-boundary-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'apps/api/src'), { recursive: true });
  await writeFile(path.join(root, 'architecture-boundaries.json'), JSON.stringify(manifest));
  for (const [name, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), source);
  }
  return { root, manifest };
}

const api = (name) => `apps/api/src/${name}`;

test('policy declares eight distinct contexts, with existing and reserved paths', () => {
  validateManifest(policy);
  assert.deepEqual(policy.contexts.map((context) => context.id), [
    'general-projects', 'professional-projects', 'service-catalog', 'hr', 'attendance', 'payroll', 'branch-pos', 'account-lifecycle',
  ]);
  assert.equal(policy.contexts.find((c) => c.id === 'professional-projects').paths[0], api('projects/**'));
  assert.ok(policy.contexts.find((c) => c.id === 'account-lifecycle').paths.includes(api('accounts/core-account-usage-query-adapter.ts')));
});

test('Reporting reaches Accounts lifecycle contracts only through declared type-only adapters', async (t) => {
  const setup = await fixture(t, {
    [api('accounts/account-usage-query-port.ts')]: 'export interface AccountUsageQueryPort {}',
    [api('accounts/core-account-usage-query-adapter.ts')]: `import type { AccountUsageQueryPort } from './account-usage-query-port.js';`,
    [api('accounts/account-reference-lock-port.ts')]: 'export interface AccountReferenceLockPort {}',
    [api('reports/reporting-account-usage-adapter.ts')]: `import type { AccountUsageQueryPort } from '../accounts/account-usage-query-port.js';`,
    [api('reports/cash-flow-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
  });
  assert.equal((await checkBoundaries(setup)).ok, true);

  await writeFile(path.join(setup.root, api('reports/cash-flow-service.ts')), `import { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`);
  assert.equal((await checkBoundaries(setup)).diagnostics[0].code, 'CROSS_CONTEXT_IMPORT');

  await writeFile(path.join(setup.root, api('reports/cash-flow-service.ts')), '');
  await writeFile(path.join(setup.root, api('accounts/account-usage-guard.ts')), `import type { Report } from '../reports/report-service.js';`);
  const reverse = await checkBoundaries(setup);
  assert.equal(reverse.diagnostics[0].code, 'FORBIDDEN_IMPORT');
  assert.equal(reverse.diagnostics[0].rule, 'accounts-must-not-import-reporting');
});

test('Sales implements the Accounts usage contract through its declared type-only adapter', async (t) => {
  const setup = await fixture(t, {
    [api('accounts/account-usage-query-port.ts')]: 'export interface AccountUsageQueryPort {}',
    [api('accounts/account-reference-lock-port.ts')]: 'export interface AccountReferenceLockPort {}',
    [api('sales/sales-account-usage-query-adapter.ts')]: `import type { AccountUsageQueryPort } from '../accounts/account-usage-query-port.js';`,
    [api('sales/customer-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
    [api('sales/selling-profile-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
    [api('sales/sales-invoice-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
  });
  assert.equal((await checkBoundaries(setup)).ok, true);

  await writeFile(path.join(setup.root, api('sales/customer-service.ts')), `import { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`);
  const runtime = await checkBoundaries(setup);
  assert.equal(runtime.diagnostics[0].code, 'CROSS_CONTEXT_IMPORT');
  assert.equal(runtime.diagnostics[0].file, api('sales/customer-service.ts'));
});

test('Purchases implements Accounts lifecycle contracts through declared type-only ports', async (t) => {
  const setup = await fixture(t, {
    [api('accounts/account-usage-query-port.ts')]: 'export interface AccountUsageQueryPort {}',
    [api('accounts/account-reference-lock-port.ts')]: 'export interface AccountReferenceLockPort {}',
    [api('purchases/purchases-account-usage-query-adapter.ts')]: `import type { AccountUsageQueryPort } from '../accounts/account-usage-query-port.js';`,
    [api('purchases/purchase-invoice-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
    [api('suppliers/supplier-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
  });
  assert.equal((await checkBoundaries(setup)).ok, true);

  await writeFile(path.join(setup.root, api('suppliers/supplier-service.ts')), `import { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`);
  const runtime = await checkBoundaries(setup);
  assert.equal(runtime.diagnostics[0].code, 'CROSS_CONTEXT_IMPORT');
  assert.equal(runtime.diagnostics[0].file, api('suppliers/supplier-service.ts'));
});

test('Tax implements Accounts lifecycle contracts through declared type-only ports', async (t) => {
  const setup = await fixture(t, {
    [api('accounts/account-usage-query-port.ts')]: 'export interface AccountUsageQueryPort {}',
    [api('accounts/account-reference-lock-port.ts')]: 'export interface AccountReferenceLockPort {}',
    [api('tax/tax-account-usage-query-adapter.ts')]: `import type { AccountUsageQueryPort } from '../accounts/account-usage-query-port.js';`,
    [api('tax/tax-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
  });
  assert.equal((await checkBoundaries(setup)).ok, true);

  await writeFile(path.join(setup.root, api('tax/tax-service.ts')), `import { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`);
  const runtime = await checkBoundaries(setup);
  assert.equal(runtime.diagnostics[0].code, 'CROSS_CONTEXT_IMPORT');
  assert.equal(runtime.diagnostics[0].file, api('tax/tax-service.ts'));
});

test('Treasury implements Accounts lifecycle contracts through declared type-only ports', async (t) => {
  const setup = await fixture(t, {
    [api('accounts/account-usage-query-port.ts')]: 'export interface AccountUsageQueryPort {}',
    [api('accounts/account-reference-lock-port.ts')]: 'export interface AccountReferenceLockPort {}',
    [api('treasury/treasury-account-usage-query-adapter.ts')]: `import type { AccountUsageQueryPort } from '../accounts/account-usage-query-port.js';`,
    [api('treasury/treasury-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
    [api('receipts/receipt-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
    [api('payments/payment-service.ts')]: `import type { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`,
  });
  assert.equal((await checkBoundaries(setup)).ok, true);

  await writeFile(path.join(setup.root, api('receipts/receipt-service.ts')), `import { AccountReferenceLockPort } from '../accounts/account-reference-lock-port.js';`);
  const runtime = await checkBoundaries(setup);
  assert.equal(runtime.diagnostics[0].code, 'CROSS_CONTEXT_IMPORT');
  assert.equal(runtime.diagnostics[0].file, api('receipts/receipt-service.ts'));
});

test('empty source root and absent reserved modules are valid', async (t) => {
  const result = await checkBoundaries(await fixture(t));
  assert.equal(result.ok, true);
  assert.equal(result.scannedFiles, 0);
  assert.ok(Object.values(result.contextFiles).every((count) => count === 0));
});

test('same-context, third-party, shared infrastructure and ordinary relative imports pass', async (t) => {
  const result = await checkBoundaries(await fixture(t, {
    [api('general-projects/service.ts')]: `
      import type { Project } from './domain.js';
      import { reserve } from '../platform/reserve.js';
      import { Prisma } from '@prisma/client';
      import crypto from 'node:crypto';
      import './not-created-yet.js';
    `,
    [api('general-projects/domain.ts')]: 'export type Project = {};',
    [api('platform/reserve.ts')]: 'export const reserve = () => {};',
  }));
  assert.equal(result.ok, true);
  assert.equal(result.importCount, 5);
  assert.equal(result.relativeImportCount, 3);
  assert.equal(result.contextFiles['general-projects'], 2);
});

for (const [from, to] of [
  ['general-projects', 'projects'], ['projects', 'general-projects'],
  ['general-projects', 'service-catalog'], ['service-catalog', 'projects'],
  ['hr', 'attendance'], ['attendance', 'hr'], ['payroll', 'attendance'],
  ['attendance', 'payroll'], ['pos', 'hr'], ['branches', 'general-projects'],
  ['sales', 'service-catalog'], ['new-context', 'hr'],
]) {
  test(`rejects direct ${from} -> ${to} internals even when the target does not exist`, async (t) => {
    const result = await checkBoundaries(await fixture(t, {
      [api(`${from}/service.ts`)]: `import type { Foreign } from '../${to}/internal-service.js';`,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, 'CROSS_CONTEXT_IMPORT');
    assert.equal(result.diagnostics[0].targetExists, false);
  });
}

test('declared provider adapters may import consumer-owned types, never the service', async (t) => {
  const setup = await fixture(t, {
    [api('hr/professional-employee-adapter.ts')]: `import type { ProfessionalEmployeePort } from '../projects/project-reference-ports.js';`,
    [api('users/hr-identity-adapter.ts')]: `import type { HrIdentityPort } from '../hr/hr-identity-port';`,
    [api('platform/prisma-pos-recovery-query-adapter.ts')]: `import type { PosRecoveryQueryPort } from '../pos/recovery-types.js';`,
  });
  assert.equal((await checkBoundaries(setup)).ok, true);
  await writeFile(path.join(setup.root, api('hr/professional-employee-adapter.ts')), `import { ProfessionalProjectService } from '../projects/professional-project-service.js';`);
  assert.equal((await checkBoundaries(setup)).diagnostics[0].code, 'CROSS_CONTEXT_IMPORT');
});

test('type-only import-equals is allowed for a declared adapter but runtime import-equals is not', async (t) => {
  const setup = await fixture(t, {
    [api('hr/professional-employee-adapter.ts')]: `import type ProfessionalEmployeePort = require('../projects/project-reference-ports.js');`,
  });
  assert.equal((await checkBoundaries(setup)).ok, true);
  await writeFile(path.join(setup.root, api('hr/professional-employee-adapter.ts')), `import ProfessionalProjectService = require('../projects/project-reference-ports.js');`);
  const result = await checkBoundaries(setup);
  assert.equal(result.diagnostics[0].code, 'CROSS_CONTEXT_IMPORT');
});

test('a file merely named adapter or port gets no automatic exemption', async (t) => {
  const result = await checkBoundaries(await fixture(t, {
    [api('hr/fake-adapter.ts')]: `import type { X } from '../projects/project-reference-ports.js';`,
    [api('general-projects/ports/fake-port.ts')]: `export * from '../../projects/professional-project-service.js';`,
  }));
  assert.equal(result.diagnostics.length, 2);
});

test('reserved query ports work before implementation, in their declared direction only', async (t) => {
  const result = await checkBoundaries(await fixture(t, {
    [api('general-projects/service.ts')]: `import type { Query } from '../service-catalog/service-catalog-query-port.js';`,
    [api('sales/service.ts')]: `import type { Query } from '../service-catalog/service-catalog-query-port';`,
    [api('payroll/service.ts')]: `import type { Query } from '../attendance/attendance-query-port.js'; import type { Workforce } from '../hr/hr-workforce-query-port.js';`,
    [api('hr/general-project-employee-adapter.ts')]: `import type { EmployeePort } from '../general-projects/general-project-reference-ports.js';`,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.importCount, 5);
});

test('type-only integrations reject runtime, side-effect, require and re-export imports', async (t) => {
  const result = await checkBoundaries(await fixture(t, {
    [api('sales/service.ts')]: `
      import { Query } from '../service-catalog/service-catalog-query-port.js';
      import '../service-catalog/service-catalog-query-port.js';
      const Query2 = require('../service-catalog/service-catalog-query-port.js');
      export * from '../service-catalog/service-catalog-query-port.js';
      const Query3 = import('../service-catalog/service-catalog-query-port.js');
    `,
  }));
  assert.equal(result.diagnostics.length, 5);
});

test('composition may wire modules but cannot be imported by a protected context', async (t) => {
  const setup = await fixture(t, {
    [api('app.ts')]: `import { router } from './hr/hr-router.js';`,
    [api('server.ts')]: `import { Adapter } from './hr/professional-employee-adapter.js';`,
    [api('composition/create-project.ts')]: `import { Service } from '../projects/professional-project-service.js';`,
  });
  assert.equal((await checkBoundaries(setup)).ok, true);
  await mkdir(path.join(setup.root, api('general-projects')), { recursive: true });
  await writeFile(path.join(setup.root, api('general-projects/service.ts')), `import { service } from '../composition/create-project.js';`);
  const result = await checkBoundaries(setup);
  assert.equal(result.diagnostics[0].rule, 'domain-must-not-import-composition');
});

test('explicit forbidden imports override an integration allowance', async (t) => {
  const manifest = structuredClone(policy);
  manifest.forbiddenImports.push({ id: 'suspend-query', fromContexts: ['general-projects'], toPaths: [api('service-catalog/service-catalog-query-port.ts')], reason: 'Contract suspended.' });
  const result = await checkBoundaries(await fixture(t, {
    [api('general-projects/service.ts')]: `import type { Query } from '../service-catalog/service-catalog-query-port.js';`,
    [api('pos/service.ts')]: `import { PostingEngine } from '../core-accounting/posting-engine.js';`,
  }, manifest));
  assert.deepEqual(result.diagnostics.map((d) => d.rule), ['suspend-query', 'no-direct-ledger-posting']);
});

test('module ownership is anchored and normalized across Windows paths, extensions, dots and suffixes', async (t) => {
  assert.equal(matches(api('hr-lookalike/service.ts'), api('hr/**')), false);
  assert.equal(matches(api('hr'), api('hr/**')), true);
  const result = await checkBoundaries(await fixture(t, {
    [api('general-projects/nested/service.ts')]: `
      import '.././../projects/professional-project-service.js?variant=1#part';
      import '../../hr';
      const hr = require('..\\\\..\\\\hr\\\\hr-service.cjs');
      import '../../hr-lookalike/service.js';
    `,
  }));
  assert.equal(result.diagnostics.length, 3);
});

test('resolves extensionless directory imports and JS specifiers to TS source', async (t) => {
  const result = await checkBoundaries(await fixture(t, {
    [api('general-projects/service.ts')]: `import '../projects'; import '../hr/hr-service.js';`,
    [api('projects/index.ts')]: 'export const project = 1;',
    [api('hr/hr-service.ts')]: 'export const hr = 1;',
  }));
  assert.deepEqual(result.diagnostics.map((d) => d.target), [api('projects/index.ts'), api('hr/hr-service.ts')]);
  assert.ok(result.diagnostics.every((d) => d.targetExists));
});

test('declared aliases and package bans cannot bypass the boundary', async (t) => {
  const manifest = structuredClone(policy);
  manifest.aliases = { '@api/': 'apps/api/src' };
  manifest.forbiddenSpecifiers = [{ id: 'no-provider-sdk', fromContexts: ['general-projects'], specifiers: ['provider-sdk', 'provider-sdk/'], reason: 'Use the declared integration.' }];
  const result = await checkBoundaries(await fixture(t, {
    [api('general-projects/service.ts')]: `import '@api/hr/hr-service.js'; import 'provider-sdk/internal'; import 'provider-sdk-lookalike';`,
  }, manifest));
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['CROSS_CONTEXT_IMPORT', 'FORBIDDEN_SPECIFIER']);
});

test('extracts multiline declarations, re-exports, import-equals, require and dynamic imports', () => {
  const imports = extractImports(`
    import type {
      A,
      B as C
    } from /* comment */ '../hr/port.js';
    export type { A } from '../hr/port.js';
    export * as hr from '../hr/service.js';
    import hr = require('../hr/service.js');
    void import('../hr/service.js', { with: { type: 'json' } });
    type Module = import('../hr/port.js');
    const load = require /* comment */ ('../hr/service.js');
    import '../hr/service.js';
  `);
  assert.equal(imports.length, 8);
  assert.deepEqual(imports.slice(0, 3).map((i) => i.typeOnly), [true, true, false]);
  assert.equal(imports[0].line, 2);
  assert.deepEqual(imports.map((i) => i.kind), ['import', 'export', 'export', 'require', 'dynamic-import', 'dynamic-import', 'require', 'import']);
});

test('inline type imports are distinguished from runtime bindings named type', () => {
  const imports = extractImports(`
    import { type Port, type Result as Alias } from './port.js';
    import { type Port, factory } from './port.js';
    import type from './port.js';
    import { type as renamed } from './port.js';
    import type, { factory } from './port.js';
  `);
  assert.deepEqual(imports.map((i) => i.typeOnly), [true, false, false, false, false]);
});

test('ignores comments, ordinary strings, regex literals, template text and member/method names', () => {
  const imports = extractImports([
    `// import '../hr/service.js';`,
    `/* export * from '../hr/service.js'; */`,
    `const text = "import x from '../hr/service.js'";`,
    "const template = `require('../hr/service.js')`;",
    `const regex = /import.*from ['\"]..\\/hr\\/service.js['\"]/u;`,
    `if (enabled()) /import.*from ['\"]..\\/hr\\/service.js['\"]/u.test(text);`,
    `const ratio = total() / 2; const other = 'return' / 2;`,
    `client.require('../hr/service.js'); client?.import('../hr/service.js');`,
    `class Policy { require(id: string) { return id; } }`,
    `function require(id) { return id; }`,
  ].join('\n'));
  assert.deepEqual(imports, []);
});

test('reads escaped specifiers and imports inside nested template expressions', () => {
  const imports = extractImports([
    String.raw`import '..\x2fhr\u002fservice.js';`,
    "const text = `text ${import('../hr/service.js')} ${`nested ${require('../pos/pos-service.js')}`}`;",
    "const load = import(`../projects/index.js`);",
  ].join('\n'));
  assert.deepEqual(imports.map((i) => i.specifier), ['../hr/service.js', '../hr/service.js', '../pos/pos-service.js', '../projects/index.js']);
});

test('computed import is an explicit review warning, not a fictitious dependency', async (t) => {
  const result = await checkBoundaries(await fixture(t, {
    [api('general-projects/service.ts')]: "const value = import(`./${name}.js`); const other = require(prefix + '/module.js');",
  }));
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.every((w) => w.code === 'COMPUTED_IMPORT'));
});

test('ignores excluded output directories but scans future source files', async (t) => {
  const result = await checkBoundaries(await fixture(t, {
    [api('general-projects/node_modules/example/index.js')]: `import '../../../hr/service.js';`,
    [api('general-projects/dist/service.js')]: `import '../../hr/service.js';`,
    [api('general-projects/coverage/service.js')]: `import '../../hr/service.js';`,
    [api('general-projects/new-file.mts')]: `import '../payroll/service.js';`,
  }));
  assert.equal(result.scannedFiles, 1);
  assert.equal(result.diagnostics.length, 1);
});

test('malformed source and escaped relative paths fail visibly', async (t) => {
  const result = await checkBoundaries(await fixture(t, {
    [api('general-projects/bad.ts')]: `import 'unterminated`,
    [api('general-projects/escape.ts')]: `import '../../../../../outside.js';`,
  }));
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['SOURCE_READ_ERROR', 'RESOLUTION_ERROR']);
});

for (const [description, change] of [
  ['version', (m) => { m.schemaVersion = 7; }],
  ['duplicate contexts', (m) => { m.contexts.push(structuredClone(m.contexts[0])); }],
  ['overlapping contexts', (m) => { m.contexts[0].paths.push(api('hr/nested/**')); }],
  ['escaping paths', (m) => { m.contexts[0].paths = ['../outside/**']; }],
  ['unscanned paths', (m) => { m.contexts[0].paths = ['unscanned/**']; }],
  ['broad port wildcard', (m) => { m.integrations[0].toPaths = [api('projects/**')]; }],
  ['unowned port', (m) => { m.integrations[0].toPaths = [api('other/port.ts')]; }],
  ['unknown context rule', (m) => { m.forbiddenImports[0].fromContexts.push('typo'); }],
  ['composition inside a context', (m) => { m.compositionRoots.push(api('hr/**')); }],
  ['duplicate rules', (m) => { m.integrations.push(structuredClone(m.integrations[0])); }],
]) {
  test(`invalid manifest fails closed: ${description}`, () => {
    const manifest = structuredClone(policy); change(manifest);
    assert.throws(() => validateManifest(manifest), /Invalid boundary manifest/u);
  });
}

test('CLI returns 0 for success, 1 for violations and 2 for configuration/usage errors', async (t) => {
  const good = await fixture(t);
  const output = JSON.parse(execFileSync(process.execPath, [script, '--root', good.root, '--json'], { encoding: 'utf8' }));
  assert.equal(output.ok, true);
  const bad = await fixture(t, { [api('general-projects/service.ts')]: `import '../hr/hr-service.js';` });
  const failed = spawnSync(process.execPath, [script, '--root', bad.root, '--json'], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).diagnostics[0].line, 1);
  assert.equal(spawnSync(process.execPath, [script, '--unknown']).status, 2);
  await writeFile(path.join(good.root, 'architecture-boundaries.json'), '{}');
  assert.equal(spawnSync(process.execPath, [script, '--root', good.root]).status, 2);
});

test('real repository baseline passes without dependencies or computed-import warnings', async () => {
  const result = await checkBoundaries({ root: repository, manifest: policy });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.warnings, []);
  assert.ok(result.scannedFiles > 0);
  assert.ok(result.contextFiles.hr > 0);
  assert.ok(result.contextFiles['professional-projects'] > 0);
  assert.ok(result.contextFiles['branch-pos'] > 0);
});
