import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertLocalBrowserFile, prepareAcceptanceEnvironment } from '../subscription-acceptance/environment.mjs';

const output = resolve('test-results/subscription-acceptance');
mkdirSync(output, { recursive: true });
const run = mkdtempSync(join(output, 'launcher-'));
for (const path of ['temp', 'cache', 'profile', 'profile/roaming', 'profile/local']) mkdirSync(join(run, path), { recursive: true });

// Stub only Playwright's read-only resolver, not the ordering/environment helper.
// These platform path contracts are not claims of native Linux browser execution.
const installations = [
  ['explicit PLAYWRIGHT_BROWSERS_PATH', { PLAYWRIGHT_BROWSERS_PATH: '/opt/installed-playwright', XDG_CACHE_HOME: '/original/cache' }, '/opt/installed-playwright/chromium/chrome'],
  ['Linux default cache', { HOME: '/home/qa' }, '/home/qa/.cache/ms-playwright/chromium/chrome'],
  ['Windows profile path', { USERPROFILE: 'C:\\Users\\qa', LOCALAPPDATA: 'C:\\Users\\qa\\AppData\\Local' }, 'C:\\Users\\qa\\AppData\\Local\\ms-playwright\\chromium\\chrome.exe'],
];
for (const [name, original, selected] of installations) {
  test(`resolves ${name} before isolation and forwards exactly that executable`, async () => {
    const env = { ...original };
    let calls = 0;
    const result = await prepareAcceptanceEnvironment(env, run, process.execPath, async () => {
      calls += 1;
      for (const key of ['PLAYWRIGHT_BROWSERS_PATH', 'HOME', 'XDG_CACHE_HOME', 'USERPROFILE', 'LOCALAPPDATA']) assert.equal(env[key], original[key]);
      assert.equal(env.TMP, join(run, 'temp'));
      return selected;
    });
    assert.equal(calls, 1);
    assert.equal(result.browser, selected);
    assert.equal(env.SUBSCRIPTION_ACCEPTANCE_BROWSER_PATH, selected);
    assert.equal(env.XDG_CACHE_HOME, join(run, 'cache'));
    assert.equal(env.LOCALAPPDATA, join(run, 'profile/local'));
  });
}

test('explicit executable is authoritative even if invalid; never falls back', async () => {
  for (const selected of [process.execPath, '', join(run, 'missing-browser')]) {
    const result = await prepareAcceptanceEnvironment({ SUBSCRIPTION_BROWSER_EXECUTABLE_PATH: selected }, run, process.execPath,
      async () => { assert.fail('must not look for another executable'); });
    assert.equal(result.browser, selected);
    if (selected === process.execPath) assert.doesNotThrow(() => assertLocalBrowserFile(selected));
    else assert.throws(() => assertLocalBrowserFile(selected), /existing local executable file/);
  }
  for (const invalid of [run, 'relative/chrome', '//server/share/chrome', '\\\\server\\share\\chrome']) {
    assert.throws(() => assertLocalBrowserFile(invalid), /existing local executable file/);
  }
});

test('installation lookup failure propagates without choosing another browser', async () => {
  const failure = new Error('Synthetic installation lookup failure');
  await assert.rejects(prepareAcceptanceEnvironment({}, run, process.execPath, async () => { throw failure; }), error => error === failure);
});

test('failed owned-server readiness aborts instead of accepting or switching listeners', async () => {
  const { default: readiness } = await import('../subscription-acceptance/readiness.mjs');
  const originalFetch = globalThis.fetch;
  const originalOutput = process.env.SUBSCRIPTION_ACCEPTANCE_RUN_DIR;
  process.env.SUBSCRIPTION_ACCEPTANCE_RUN_DIR = run;
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return new Response('{}', { status: 503 }); };
  try {
    await assert.rejects(readiness(), /fixture is not ready/);
    assert.deepEqual(calls, ['http://127.0.0.1:3166/api/v1/auth/csrf']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOutput === undefined) delete process.env.SUBSCRIPTION_ACCEPTANCE_RUN_DIR;
    else process.env.SUBSCRIPTION_ACCEPTANCE_RUN_DIR = originalOutput;
  }
});

test('child mock receives the selected executable without DB/mail/payment credentials', async () => {
  const secret = 'SYNTHETIC-SECRET-MUST-NOT-APPEAR';
  const names = ['DATABASE_URL', 'R2_DATABASE_URL', 'DIRECT_URL', 'RUN_DB_TESTS', 'RUN_R2_DB_TESTS',
    'DB_PASSWORD', 'MYSQL_PWD', 'MYSQL_PASSWORD', 'MARIADB_PASSWORD',
    'RUN_POS_RECOVERY_FINALIZATION_DB_TESTS', 'SMTP_HOST', 'SMTP_PASSWORD', 'PAYMENT_SECRET', 'STRIPE_SECRET_KEY', 'MYFATOORAH_API_KEY'];
  const env = { ...process.env, SUBSCRIPTION_BROWSER_EXECUTABLE_PATH: process.execPath, NODE_COMPILE_CACHE: join(run, 'forbidden-cache') };
  for (const name of names) env[name] = secret;
  const prepared = await prepareAcceptanceEnvironment(env, run, process.execPath, async () => { assert.fail('explicit executable'); });
  assertLocalBrowserFile(prepared.browser); // Node stands in for an already-installed local executable; no Chromium is launched.
  assert.ok(prepared.removed >= names.length);
  const child = spawnSync(process.execPath, ['--max-old-space-size=768', '-e',
    `const names = ${JSON.stringify(names)}; console.log(JSON.stringify({ browser: process.env.SUBSCRIPTION_ACCEPTANCE_BROWSER_PATH, inherited: names.filter(name => name in process.env).length, compileCache: 'NODE_COMPILE_CACHE' in process.env }));`],
  { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { browser: process.execPath, inherited: 0, compileCache: false });
  assert.equal(`${child.stdout}${child.stderr}`.includes(secret), false);
});
