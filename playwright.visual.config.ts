import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';
const apiURL = 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-responsive-report' }]]
    : [['list']],
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    locale: 'en-US',
    timezoneId: 'Asia/Riyadh',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'wide-1920', use: { viewport: { width: 1920, height: 1080 } } },
  ],
  outputDir: 'test-results/responsive-ui',
  webServer: [
    {
      command: 'node scripts/visual-qa-server.mjs',
      url: `${apiURL}/api/v1/auth/csrf`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        VISUAL_QA_PORT: '3000',
      },
    },
    {
      command: 'node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 4173 --strictPort',
      url: baseURL,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
