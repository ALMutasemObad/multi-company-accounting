import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../tmp/zebra-label/web-cache",
  test: { include: ["src/zebra-label-*.test.ts", "src/zebra-label-*.test.tsx"], maxWorkers: 1, fileParallelism: false, pool: "threads" },
});
