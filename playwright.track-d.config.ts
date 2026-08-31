import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/track-d', fullyParallel: false, workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 10_000 }, reporter: [['list']],
  outputDir: 'test-results/track-d',
  use: { baseURL: 'http://127.0.0.1:4184', ...devices['Desktop Chrome'],
    screenshot: 'off', trace: 'off', video: 'off' },
  projects: [
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: 'node scripts/visual-qa-server.mjs', url: 'http://127.0.0.1:3134/api/v1/auth/csrf', env: { VISUAL_QA_PORT: '3134' }, reuseExistingServer: false, timeout: 60_000 },
    { command: 'node node_modules/vite/bin/vite.js --config vite.track-d.config.ts --configLoader runner', url: 'http://127.0.0.1:4184', reuseExistingServer: false, timeout: 60_000 },
  ],
});
