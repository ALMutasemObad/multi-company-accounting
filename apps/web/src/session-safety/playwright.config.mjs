import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
export default defineConfig({
  testDir: '.', testMatch: 'integration.pw.mjs', workers: 1, timeout: 30000,
  outputDir: `${root}/test-results/session-integration`,
  use: { baseURL: 'http://127.0.0.1:5197', screenshot: 'only-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5197 --strictPort',
    cwd: root, url: 'http://127.0.0.1:5197', reuseExistingServer: false },
});
