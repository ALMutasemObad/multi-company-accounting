import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  testMatch: ["public-plans.spec.ts", "track-a-public-offers.spec.ts"],
  fullyParallel: false, workers: 1, retries: 0, timeout: 90_000,
  expect: { timeout: 15_000 }, reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4180", locale: "en-US", timezoneId: "Asia/Riyadh", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "wide-1920", use: { viewport: { width: 1920, height: 1080 } } },
  ],
  outputDir: "test-results/track-a",
  webServer: [
    { command: "node scripts/visual-qa-server.mjs", url: "http://127.0.0.1:3130/api/v1/auth/csrf", reuseExistingServer: false, timeout: 60_000, env: { VISUAL_QA_PORT: "3130" } },
    { command: "node node_modules/vite/bin/vite.js --config vite.track-a.config.ts --configLoader runner", url: "http://127.0.0.1:4180", reuseExistingServer: false, timeout: 60_000 },
  ],
});
