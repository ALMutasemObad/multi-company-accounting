import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { BackupDecryptTransform, validateBackupPassphrase } from "./lib/backup-format.mjs";
import { verifyBackupArtifact } from "./lib/backup-artifact-verifier.mjs";
import { collectDatabaseVerification, parseMysqlUrl, runMysqlScalar, waitForChild, withMysqlDefaultsFile } from "./lib/mysql-tools.mjs";

try {
  loadEnvFile();
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const main = async () => {
  const connection = parseMysqlUrl(process.env.DATABASE_URL);
  const passphrase = validateBackupPassphrase(process.env.BACKUP_ENCRYPTION_PASSPHRASE);
  const mysqlBinary = process.env.MYSQL_BIN || "mysql";
  if (!process.env.BACKUP_FILE && !process.argv[2]) throw new Error("BACKUP_FILE or a backup file argument is required");
  const backupPath = resolve(process.env.BACKUP_FILE || process.argv[2]);
  const expectedConfirmation = `RESTORE:${connection.database}`;
  if (process.env.RESTORE_CONFIRM !== expectedConfirmation) {
    throw new Error(`RESTORE_CONFIRM must equal ${expectedConfirmation}`);
  }
  const manifestPath = `${backupPath}.json`;
  await verifyBackupArtifact(backupPath);
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const isLegacyManifest = manifest.format === "mcap-backup-v1";
  if (isLegacyManifest && (!manifest.verification || typeof manifest.verification !== "object")) {
    throw new Error("Legacy backup manifest verification metadata is invalid");
  }

  const verification = await withMysqlDefaultsFile(connection, async (defaultsFile) => {
    const existingTables = Number(await runMysqlScalar(
      mysqlBinary,
      defaultsFile,
      connection.database,
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()",
    ));
    if (existingTables !== 0) {
      throw new Error("Restore target must be an empty database");
    }

    const mysql = spawn(
      mysqlBinary,
      [
        `--defaults-extra-file=${defaultsFile}`,
        "--binary-mode",
        "--default-character-set=utf8mb4",
        connection.database,
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
    );
    await Promise.all([
      pipeline(
        createReadStream(backupPath),
        new BackupDecryptTransform(passphrase),
        createGunzip(),
        mysql.stdin,
      ),
      waitForChild(mysql, "mysql restore"),
    ]);

    const tableCount = Number(await runMysqlScalar(
      mysqlBinary,
      defaultsFile,
      connection.database,
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()",
    ));
    const schemaMigrationCount = Number(await runMysqlScalar(
      mysqlBinary,
      defaultsFile,
      connection.database,
      "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    ));
    const databaseVerification = await collectDatabaseVerification(mysqlBinary, defaultsFile, connection.database);
    const rowCountsAreValid = Object.values(databaseVerification.rowCounts).every(
      (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0,
    );
    const requiredCoreRowsExist = ["organizations", "companies", "users"].every(
      (name) => Number.isSafeInteger(Number(databaseVerification.rowCounts[name]))
        && Number(databaseVerification.rowCounts[name]) > 0,
    );
    if (
      tableCount === 0
      || schemaMigrationCount !== manifest.schemaMigrationCount
      || !rowCountsAreValid
      || !requiredCoreRowsExist
      || databaseVerification.journalTotals.baseDebit !== databaseVerification.journalTotals.baseCredit
      || (isLegacyManifest && JSON.stringify(databaseVerification) !== JSON.stringify(manifest.verification))
    ) {
      throw new Error("Restored database verification failed");
    }
    return { tableCount, schemaMigrationCount };
  });

  process.stdout.write(`${JSON.stringify({
    status: "restored",
    targetDatabase: connection.database,
    ...verification,
  })}\n`);
};

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Unknown error" })}\n`);
  process.exitCode = 1;
});
