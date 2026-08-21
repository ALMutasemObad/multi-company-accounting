import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3200';
const capturePath = resolve(process.env.E2E_REGISTRATION_CAPTURE_PATH ?? 'test-results/registration-emails.jsonl');
process.env.E2E_REGISTRATION_CAPTURE_PATH = capturePath;

const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    locale: 'en-US',
    timezoneId: 'Asia/Aden',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  outputDir: 'test-results/playwright',
  webServer: {
    command: 'node apps/api/dist/server.js',
    url: `${baseURL}/ready`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...inheritedEnvironment,
      NODE_ENV: 'test',
      SERVE_WEB_ASSETS: 'true',
      PORT: new URL(baseURL).port || '80',
      WEB_ORIGIN: baseURL,
      SESSION_COOKIE_SECURE: 'false',
      TRUST_PROXY: 'false',
      SELF_REGISTRATION_ENABLED: 'true',
      REGISTRATION_EMAIL_MODE: 'log',
      REGISTRATION_EMAIL_CAPTURE_PATH: capturePath,
      REGISTRATION_AUDIT_PEPPER: 'playwright-registration-audit-pepper-2026',
      REGISTRATION_TOKEN_SECRET: 'playwright-registration-token-secret-2026',
      REGISTRATION_RATE_LIMIT_MAX: '20',
      AUTH_RATE_LIMIT_MAX: '100',
      LOG_REQUESTS: 'false',
    },
  },
});
