import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertLocalBrowserFile, prepareAcceptanceEnvironment } from './environment.mjs';

const [mode = 'run', ...extra] = process.argv.slice(2);
if (!['run', 'list'].includes(mode) || extra.length) {
  throw new Error('Use subscription-acceptance:test or subscription-acceptance:list without filters or extra arguments.');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const output = join(root, 'test-results/subscription-acceptance');
mkdirSync(output, { recursive: true });
const run = mkdtempSync(join(output, `${mode}-`));
for (const name of ['temp', 'cache', 'profile', 'profile/roaming', 'profile/local']) mkdirSync(join(run, name), { recursive: true });

// Only this process and its children receive the isolated environment.
const { browser, removed } = await prepareAcceptanceEnvironment(process.env, run, process.execPath, async () => {
  const { chromium } = await import('@playwright/test');
  return chromium.executablePath();
});
process.env.SUBSCRIPTION_ACCEPTANCE_MODE = mode;
const manifest = readFileSync(new URL('./expected-cases.json', import.meta.url));
writeFileSync(join(run, 'invocation.json'), `${JSON.stringify({
  mode, createdAt: new Date().toISOString(), node: process.version, platform: process.platform,
  commit: process.env.GITHUB_SHA ?? null, expectedCases: 58, workers: 1, retries: 0,
  manifestSha256: createHash('sha256').update(manifest).digest('hex'), removedEnvironmentVariables: removed,
}, null, 2)}\n`);
console.log(`Subscription acceptance evidence: ${run}`);
if (mode === 'run') assertLocalBrowserFile(browser);

// Run the CLI in this process: Playwright owns webServer startup, signal handling
// and teardown on both Windows and Linux. There is no outer child-tree killer.
const cli = join(root, 'node_modules/@playwright/test/cli.js');
process.argv = [process.execPath, cli, 'test', '--config', 'playwright.subscription-acceptance.config.ts',
  '--workers=1', '--retries=0', ...(mode === 'list' ? ['--list'] : [])];
await import(pathToFileURL(cli).href);
