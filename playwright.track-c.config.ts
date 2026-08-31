import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual", testMatch: "track-c-*.spec.ts",
  fullyParallel: false, workers: 1, retries: 0, timeout: 45_000,
  expect: { timeout: 12_000 }, reporter: "list",
  use: { baseURL: "http://127.0.0.1:4182", locale: "en-US", timezoneId: "Asia/Riyadh", screenshot: "only-on-failure" },
  projects: [
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  outputDir: "test-results/track-c",
  webServer: [
    { command: "node scripts/visual-qa-server.mjs", url: "http://127.0.0.1:3132/api/v1/auth/csrf", reuseExistingServer: false, env: { VISUAL_QA_PORT: "3132" }, timeout: 60_000 },
    { command: "node node_modules/vite/bin/vite.js --config apps/web/vite.track-c.config.ts", url: "http://127.0.0.1:4182", reuseExistingServer: false, timeout: 60_000 },
  ],
});
