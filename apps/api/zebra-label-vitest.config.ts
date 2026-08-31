import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../tmp/zebra-label/api-cache",
  test: { include: ["tests/zebra-label-*.test.ts", "tests/barcode-label-renderer.test.ts", "tests/barcode-label-service.test.ts", "tests/barcode-label-architecture.test.ts", "tests/barcode-codec.test.ts"], maxWorkers: 1, fileParallelism: false, pool: "threads" },
});
