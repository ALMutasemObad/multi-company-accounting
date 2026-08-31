import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "node_modules/.vitest-track-r3",
  test: {
    include: ["src/retail-onboarding-track-r3.test.tsx", "src/i18n/i18n.test.ts", "src/authorization.test.ts"],
    maxWorkers: 1,
    pool: "threads",
  },
});
