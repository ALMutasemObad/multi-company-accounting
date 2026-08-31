import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root,
  cacheDir: fileURLToPath(new URL("./tmp/cashier-context/vitest-cache", import.meta.url)),
  test: {
    include: ["apps/web/src/cashier-context-*.test.ts", "apps/web/src/cashier-context-*.test.tsx", "apps/api/tests/cashier-context-*.test.ts"],
    pool: "threads", maxWorkers: 1, fileParallelism: false,
  },
});
