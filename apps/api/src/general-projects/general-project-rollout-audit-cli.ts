import { createDatabase } from "../database.js";
import { auditGeneralProjectRollout } from "./general-project-rollout-audit.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stdout.write('{"status":"DATABASE_URL_MISSING"}\n');
  process.exitCode = 2;
} else {
  let database: ReturnType<typeof createDatabase> | undefined;
  try {
    database = createDatabase(databaseUrl, {
      connectionLimit: 1, minimumIdle: 0, acquireTimeoutMs: 5_000,
      connectTimeoutMs: 2_000, idleTimeoutSeconds: 10,
    });
    const result = await auditGeneralProjectRollout(
      database,
      process.env.PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID,
      process.env.PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_IDS_BY_CURRENCY,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "READY" ? 0 : 1;
  } catch {
    // A driver error may include SQL or a connection string; never print it here.
    process.stdout.write('{"status":"DATABASE_READ_FAILED"}\n');
    process.exitCode = 2;
  } finally {
    if (database) {
      try { await database.$disconnect(); } catch { /* no connection details in output */ }
    }
  }
}
