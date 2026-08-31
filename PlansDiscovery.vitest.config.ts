import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: local("./apps/web"),
  cacheDir: local("./tmp/plans-discovery/vitest-cache"),
  test: {
    maxWorkers: 1,
    include: ["src/PlansDiscovery*.test.ts", "src/PlansDiscovery*.test.tsx", "src/public-plans.test.ts", "src/public-offers.test.ts", "src/i18n/i18n.test.ts"],
  },
});
