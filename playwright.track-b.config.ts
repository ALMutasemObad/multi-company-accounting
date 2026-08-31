import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: process.env.TRACK_B_PUBLIC_REGRESSION === "1" ? ["visual/public-plans.spec.ts"] : ["track-b/**/*.spec.ts"],
  fullyParallel: false, workers: 1, retries: 0, timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "test-results/track-b",
  use: {
    baseURL: "http://127.0.0.1:4181", ...devices["Desktop Chrome"],
    locale: "en-US", timezoneId: "Asia/Riyadh", screenshot: "only-on-failure", trace: "off", video: "off",
  },
  projects: [
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: "node scripts/visual-qa-server.mjs", url: "http://127.0.0.1:3131/api/v1/auth/csrf", env: { VISUAL_QA_PORT: "3131" }, reuseExistingServer: false, timeout: 60_000 },
    { command: "node node_modules/vite/bin/vite.js --config vite.track-b.config.ts --configLoader native", url: "http://127.0.0.1:4181", reuseExistingServer: false, timeout: 60_000 },
  ],
});
