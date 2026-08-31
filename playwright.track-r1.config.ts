import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/track-r1", testMatch: "*.spec.ts", fullyParallel: false, workers: 1, retries: 0, timeout: 45_000,
  expect: { timeout: 10_000 }, reporter: [["list"]], outputDir: "test-results/track-r1",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4190", locale: "en-US", timezoneId: "Asia/Riyadh", screenshot: "off", trace: "off", video: "off" },
  projects: [{ name: "R1", use: { viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: "node tests/track-r1/server.mjs", url: "http://127.0.0.1:3140/api/v1/health", reuseExistingServer: false, timeout: 60_000 },
    { command: "node node_modules/vite/bin/vite.js --config vite.track-r1-test.config.ts --configLoader runner", url: "http://127.0.0.1:4190", reuseExistingServer: false, timeout: 60_000 },
  ],
});
