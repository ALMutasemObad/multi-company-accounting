import process from "node:process";
import {
  DatabaseIdentityPolicyError,
  verifyDatabaseIdentityPolicy,
} from "./lib/database-identities.mjs";
import { parseMysqlUrl, runMysqlScalar, withMysqlDefaultsFile } from "./lib/mysql-tools.mjs";

const mysqlBinary = process.env.MYSQL_BIN ?? "mysql";

const inspectIdentity = async (connection) => withMysqlDefaultsFile(connection, async (defaultsFile) => {
  const identity = await runMysqlScalar(
    mysqlBinary,
    defaultsFile,
    connection.database,
    "SELECT CURRENT_USER()",
  );
  const grantsOutput = await runMysqlScalar(
    mysqlBinary,
    defaultsFile,
    connection.database,
    "SHOW GRANTS FOR CURRENT_USER()",
  );
  return {
    identity,
    grants: grantsOutput.split(/\r?\n/u).filter(Boolean),
  };
});

const main = async () => {
  const runtimeConnection = parseMysqlUrl(process.env.DATABASE_URL);
  const migrationConnection = parseMysqlUrl(process.env.MIGRATION_DATABASE_URL);
  let runtime;
  let migration;
  try {
    runtime = await inspectIdentity(runtimeConnection);
    migration = await inspectIdentity(migrationConnection);
  } catch {
    throw new DatabaseIdentityPolicyError("DATABASE_IDENTITY_CONNECTION_FAILED");
  }
  const report = verifyDatabaseIdentityPolicy({
    runtimeConnection,
    migrationConnection,
    runtimeIdentity: runtime.identity,
    migrationIdentity: migration.identity,
    runtimeGrants: runtime.grants,
    migrationGrants: migration.grants,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
};

main().catch((error) => {
  const code = error instanceof DatabaseIdentityPolicyError ? error.code : "INVALID_DATABASE_IDENTITY_CONFIGURATION";
  process.stderr.write(`database identity verification failed (${code})\n`);
  process.exitCode = 1;
});
