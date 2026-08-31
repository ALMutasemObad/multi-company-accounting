import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/subscription-discovery', fullyParallel: false, workers: 1, retries: 0,
  timeout: 45_000, expect: { timeout: 15_000 }, reporter: 'list',
  outputDir: 'tmp/subscription-discovery/browser-results',
  use: { baseURL: 'http://127.0.0.1:4213', viewport: { width: 390, height: 844 },
    locale: 'en-US', timezoneId: 'Asia/Riyadh', screenshot: 'only-on-failure', trace: 'off', video: 'off' },
  webServer: [
    { command: 'node scripts/visual-qa-server.mjs', env: { VISUAL_QA_PORT: '3163' },
      url: 'http://127.0.0.1:3163/api/v1/auth/csrf', reuseExistingServer: false, timeout: 60_000 },
    { command: 'node node_modules/vite/bin/vite.js --config vite.subscription-discovery.config.mjs --configLoader native',
      url: 'http://127.0.0.1:4213', reuseExistingServer: false, timeout: 60_000 },
  ],
});
