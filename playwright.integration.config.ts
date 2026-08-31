import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['visual/**/*.spec.ts', 'track-b/**/*.spec.ts'],
  fullyParallel: false, workers: 1, retries: 0, timeout: 120_000,
  expect: { timeout: 15_000 }, reporter: [['list']],
  outputDir: 'test-results/coordinator-integration-final',
  use: {
    baseURL: 'http://127.0.0.1:4183', ...devices['Desktop Chrome'],
    locale: 'en-US', timezoneId: 'Asia/Riyadh', colorScheme: 'light',
    screenshot: 'only-on-failure', trace: 'off', video: 'off',
    actionTimeout: 15_000, navigationTimeout: 30_000,
  },
  projects: [
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'tablet-768', testIgnore: ['**/track-b/**', '**/track-c-*.spec.ts'], use: { viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'wide-1920', testIgnore: ['**/track-b/**', '**/track-c-*.spec.ts'], use: { viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: [
    { command: 'node scripts/visual-qa-server.mjs', url: 'http://127.0.0.1:3133/api/v1/auth/csrf', env: { VISUAL_QA_PORT: '3133' }, reuseExistingServer: false, timeout: 60_000 },
    { command: 'node node_modules/vite/bin/vite.js --config vite.integration.config.ts --configLoader runner', url: 'http://127.0.0.1:4183', reuseExistingServer: false, timeout: 60_000 },
  ],
});
