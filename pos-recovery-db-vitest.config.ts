import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Explicit isolated database opt-in; never infer a production or developer database.
const url = new URL(process.env.DATABASE_URL ?? "mysql://localhost/unconfigured");
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (process.env.RUN_DB_TESTS !== "true" || process.env.RUN_POS_RECOVERY_FINALIZATION_DB_TESTS !== "true"
  || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  || !["mysql:", "mariadb:"].includes(url.protocol)
  || !/^w1pos[_a-z0-9]*$/i.test(databaseName) || process.env.POS_RECOVERY_TEST_DATABASE !== databaseName) {
  throw new Error("POS recovery DB tests require a coordinated, isolated local W1POS database");
}
export default defineConfig({
  cacheDir: fileURLToPath(new URL("./tmp/coordination/pos-recovery-db-vite", import.meta.url)),
  test: {
    include: ["apps/api/tests/pos.integration.test.ts", "apps/api/tests/pos-recovery-finalization.integration.test.ts"],
    pool: "threads", maxWorkers: 1, fileParallelism: false,
  },
});
