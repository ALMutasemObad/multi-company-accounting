import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const root = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: resolve(root, "apps/web"),
  cacheDir: resolve(root, "apps/web/node_modules/.cache-track-r1/vitest"),
  test: { maxWorkers: 1, include: ["src/pos-experience-*.test.ts", "src/pos.test.ts", "src/barcode.test.ts"] },
});
