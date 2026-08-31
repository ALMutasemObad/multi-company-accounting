import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const root = process.cwd();
export default defineConfig({
  testDir: '..', fullyParallel: false, workers: 1, retries: 0,
  timeout: 45_000, expect: { timeout: 15_000 }, reporter: [['list'], ['json', { outputFile: resolve(root, 'tmp/coordination/subscription-acceptance/e2e-results.json') }]],
  outputDir: resolve(root, 'tmp/coordination/subscription-acceptance/e2e'),
  use: { baseURL: 'http://127.0.0.1:4216', viewport: { width: 1440, height: 1000 },
    locale: 'en-US', timezoneId: 'Asia/Riyadh', screenshot: 'only-on-failure', trace: 'off', video: 'off' },
  webServer: [
    { cwd: root, command: 'node tests/subscription-discovery/wave1/server.mjs', url: 'http://127.0.0.1:3166/api/v1/auth/csrf', reuseExistingServer: process.env.W1_REUSE_SERVER === 'true', timeout: 60_000 },
    { cwd: root, command: 'node node_modules/vite/bin/vite.js --config tests/subscription-discovery/wave1/vite.config.mjs --configLoader native', url: 'http://127.0.0.1:4216', reuseExistingServer: process.env.W1_REUSE_SERVER === 'true', timeout: 60_000 },
  ],
});
