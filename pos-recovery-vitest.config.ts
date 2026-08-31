import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  cacheDir: fileURLToPath(new URL("./tmp/agent/pos-recovery-vite", import.meta.url)),
  test: {
    include: ["apps/web/src/pos-recovery-*.test.ts", "apps/web/src/pos-recovery-*.test.tsx", "apps/api/tests/pos-recovery-*.test.ts",
      "apps/web/src/pos-experience-safety.test.ts", "apps/web/src/pos-experience-cart.test.ts", "apps/web/src/selling-profile-attempts.test.ts"],
    pool: "threads", maxWorkers: 1, fileParallelism: false,
  },
});
