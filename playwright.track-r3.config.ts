import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/track-r3",
  fullyParallel: false, workers: 1, retries: 0,
  timeout: 45_000, expect: { timeout: 10_000 },
  reporter: [["list"]], outputDir: "tmp/agent/track-r3-results",
  use: {
    baseURL: "http://127.0.0.1:4192", viewport: { width: 1440, height: 1000 },
    browserName: "chromium", headless: true, trace: "off", video: "off", screenshot: "off",
    locale: "en-US", timezoneId: "Asia/Riyadh", actionTimeout: 10_000,
  },
  webServer: {
    command: "node ../../node_modules/vite/bin/vite.js --config vite.track-r3.config.ts --configLoader runner",
    cwd: "apps/web", url: "http://127.0.0.1:4192", timeout: 60_000, reuseExistingServer: false,
    stdout: "pipe", stderr: "pipe",
  },
});
