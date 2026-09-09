import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const workspaceRoot = resolve(__dirname, "../../..");
const baseURL = "http://127.0.0.1:4174";

export default defineConfig({
  testDir: resolve(workspaceRoot, "tests/e2e"),
  testMatch: "human-resources.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    locale: "en-US",
    timezoneId: "Asia/Riyadh",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  outputDir: resolve(workspaceRoot, "test-results/hr-workspace"),
  webServer: {
    command: "node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 4174 --strictPort",
    cwd: workspaceRoot,
    url: baseURL,
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
