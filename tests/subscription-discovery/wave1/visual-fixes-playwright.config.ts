import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from './playwright.config';

const root = process.cwd();
export default defineConfig({
  ...base, testMatch: '**/visual-fixes.spec.ts',
  reporter: [['list'], ['json', { outputFile: resolve(root, 'tmp/coordination/w1-visual-fixes/e2e-results.json') }]],
  outputDir: resolve(root, 'tmp/coordination/w1-visual-fixes/e2e'),
  webServer: [
    { cwd: root, command: 'node tests/subscription-discovery/wave1/server.mjs', url: 'http://127.0.0.1:3166/api/v1/auth/csrf', reuseExistingServer: false, timeout: 60_000 },
    { cwd: root, command: 'node node_modules/vite/bin/vite.js --config tests/subscription-discovery/wave1/visual-fixes-vite.config.mjs --configLoader native', url: 'http://127.0.0.1:4216', reuseExistingServer: false, timeout: 60_000 },
  ],
});
