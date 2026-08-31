import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "node_modules/.vite-track-r2",
  test: { include: ["tests/selling-*.test.ts"], fileParallelism: false, maxWorkers: 1 },
});
