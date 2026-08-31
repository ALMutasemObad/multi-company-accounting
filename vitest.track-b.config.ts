import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const trackRoot = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: resolve(trackRoot, "apps/web"),
  cacheDir: resolve(trackRoot, "apps/web/node_modules/.cache-track-b/vitest"),
  test: { maxWorkers: 1, include: ["src/**/*.test.ts"] },
});
