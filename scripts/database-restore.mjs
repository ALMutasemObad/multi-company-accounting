import "dotenv/config";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { BackupDecryptTransform, sha256File, validateBackupPassphrase } from "./lib/backup-format.mjs";
import { collectDatabaseVerification, parseMysqlUrl, runMysqlScalar, waitForChild, withMysqlDefaultsFile } from "./lib/mysql-tools.mjs";

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
  const [manifestText, actualSha256, backupStat] = await Promise.all([
    readFile(manifestPath, "utf8"),
    sha256File(backupPath),
    stat(backupPath),
  ]);
  const manifest = JSON.parse(manifestText);
  if (manifest.format !== "mcap-backup-v1") throw new Error("Unsupported backup manifest format");
  if (manifest.sha256 !== actualSha256 || manifest.bytes !== backupStat.size) {
    throw new Error("Backup integrity verification failed");
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
    if (
      tableCount === 0
      || schemaMigrationCount !== manifest.schemaMigrationCount
      || JSON.stringify(databaseVerification) !== JSON.stringify(manifest.verification)
    ) {
      throw new Error("Restored database verification failed");
    }
    return { tableCount, schemaMigrationCount };
  });

  process.stdout.write(`${JSON.stringify({
    status: "restored",
    targetDatabase: connection.database,
    sourceDatabase: manifest.sourceDatabase,
    ...verification,
  })}\n`);
};

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Unknown error" })}\n`);
  process.exitCode = 1;
});
