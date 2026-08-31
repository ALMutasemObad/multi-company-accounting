import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/grocery-integration', fullyParallel: false, workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 15_000 }, reporter: 'list',
  outputDir: 'tmp/agent/grocery-integration-results',
  use: { baseURL: 'http://127.0.0.1:4193', viewport: { width: 1440, height: 900 },
    locale: 'en-US', timezoneId: 'Asia/Riyadh', screenshot: 'only-on-failure', trace: 'off', video: 'off' },
  webServer: [
    { command: 'node scripts/visual-qa-server.mjs', env: { VISUAL_QA_PORT: '3143' },
      url: 'http://127.0.0.1:3143/api/v1/auth/csrf', reuseExistingServer: false, timeout: 60_000 },
    { command: 'node node_modules/vite/bin/vite.js --config vite.grocery-integration.config.ts --configLoader runner',
      url: 'http://127.0.0.1:4193', reuseExistingServer: false, timeout: 60_000 },
  ],
});
