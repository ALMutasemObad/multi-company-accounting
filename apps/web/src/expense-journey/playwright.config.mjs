import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default defineConfig({
  testDir: ".", testMatch: "*.pw.ts", workers: 1,
  outputDir: join(tmpdir(), "expense-journey-browser-results"),
  use: { baseURL: "http://127.0.0.1:4183", headless: true, launchOptions: {
    executablePath: process.env.EXPENSE_CHROME,
  } },
  webServer: { command: "node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4183", cwd: fileURLToPath(new URL("../..", import.meta.url)), url: "http://127.0.0.1:4183", reuseExistingServer: false },
});
