import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/track-e", testMatch: "*.spec.ts",
  fullyParallel: false, workers: 1, retries: 0, timeout: 30_000,
  expect: { timeout: 6_000 }, reporter: "list",
  use: { baseURL: "http://127.0.0.1:4185", locale: "en-US", timezoneId: "Asia/Riyadh", screenshot: "only-on-failure", trace: "off", video: "off" },
  projects: [
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  outputDir: "test-results/track-e",
  webServer: { command: "node node_modules/vite/bin/vite.js --config vite.track-e.config.ts", url: "http://127.0.0.1:4185/tests/track-e/", reuseExistingServer: false, timeout: 60_000 },
});
