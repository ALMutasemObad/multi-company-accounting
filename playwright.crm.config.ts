import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "crm.spec.ts",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    ...devices["Desktop Chrome"],
    timezoneId: "Asia/Riyadh",
    screenshot: "only-on-failure",
  },
  outputDir: "test-results/crm-e2e",
  webServer: {
    command: "node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
