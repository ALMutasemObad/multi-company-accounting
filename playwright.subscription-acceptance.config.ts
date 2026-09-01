import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const output = process.env.SUBSCRIPTION_ACCEPTANCE_RUN_DIR;
if (!output) throw new Error('Use the subscription-acceptance package command to create fresh evidence.');

export default defineConfig({
  testDir: './tests/subscription-discovery',
  testMatch: ['**/plan-navigation.spec.ts', '**/wave1/acceptance.spec.ts', '**/wave1/defects.spec.ts',
    '**/wave1/qa-fixes.spec.ts', '**/wave1/visual-fixes.spec.ts', '**/wave1/d3-context.spec.ts'],
  projects: [{ name: 'subscription-chromium', use: { browserName: 'chromium' } }],
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 45_000, expect: { timeout: 15_000 }, globalTimeout: 12 * 60_000,
  outputDir: resolve(output, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: resolve(output, 'results.json') }],
    ['html', { open: 'never', outputFolder: resolve(output, 'html') }],
    ['./scripts/subscription-acceptance/reporter.ts']],
  use: {
    baseURL: 'http://127.0.0.1:4216', viewport: { width: 1440, height: 1000 },
    locale: 'en-US', timezoneId: 'Asia/Riyadh', headless: true,
    screenshot: 'only-on-failure', trace: 'off', video: 'off',
    launchOptions: { executablePath: process.env.SUBSCRIPTION_ACCEPTANCE_BROWSER_PATH },
  },
  globalSetup: './scripts/subscription-acceptance/readiness.mjs',
  webServer: [
    { name: 'subscription-fixture', command: 'node --max-old-space-size=768 tests/subscription-discovery/wave1/server.mjs',
      cwd: process.cwd(), wait: { stdout: /W1 fixture API http:\/\/127\.0\.0\.1:3166;/ },
      reuseExistingServer: false, timeout: 60_000, stdout: 'pipe', stderr: 'pipe' },
    { name: 'subscription-vite', command: 'node --max-old-space-size=768 node_modules/vite/bin/vite.js --config vite.subscription-acceptance.config.mjs --configLoader native --clearScreen false',
      cwd: process.cwd(), wait: { stdout: /Local:.*127\.0\.0\.1:4216\// },
      reuseExistingServer: false, timeout: 60_000, stdout: 'pipe', stderr: 'pipe' },
  ],
});
