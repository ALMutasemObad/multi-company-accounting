import "dotenv/config";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { BackupEncryptTransform, sha256File, validateBackupPassphrase } from "./lib/backup-format.mjs";
import { collectDatabaseVerification, parseMysqlUrl, runMysqlScalar, waitForChild, withMysqlDefaultsFile } from "./lib/mysql-tools.mjs";

const main = async () => {
  const connection = parseMysqlUrl(process.env.DATABASE_URL);
  const passphrase = validateBackupPassphrase(process.env.BACKUP_ENCRYPTION_PASSPHRASE);
  const dumpBinary = process.env.MYSQLDUMP_BIN || "mysqldump";
  const mysqlBinary = process.env.MYSQL_BIN || "mysql";
  const outputDirectory = resolve(process.env.BACKUP_DIRECTORY || "backups");
  const filePrefix = process.env.BACKUP_FILE_PREFIX || `mcap-${connection.database}`;
  if (!/^mcap-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(filePrefix)) {
    throw new Error("BACKUP_FILE_PREFIX must be a safe mcap-prefixed file name");
  }
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = resolve(outputDirectory, `${filePrefix}-${stamp}.sql.gz.jwb`);
  const partialPath = `${backupPath}.partial`;
  const manifestPath = `${backupPath}.json`;
  const partialManifestPath = `${manifestPath}.partial`;
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  let backupCommitted = false;
  let manifestCommitted = false;
  try {
    const metadata = await withMysqlDefaultsFile(connection, async (defaultsFile) => {
      const schemaMigrationCountText = await runMysqlScalar(
        mysqlBinary,
        defaultsFile,
        connection.database,
        "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
      );
      const schemaMigrationCount = Number(schemaMigrationCountText);
      if (!Number.isSafeInteger(schemaMigrationCount) || schemaMigrationCount <= 0) {
        throw new Error("Database schema migration count is invalid; backup was not created");
      }
      const verification = await collectDatabaseVerification(mysqlBinary, defaultsFile, connection.database);
      const rowCountsAreValid = Object.values(verification.rowCounts).every(
        (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0,
      );
      const requiredCoreRowsExist = ["organizations", "companies", "users"].every(
        (name) => Number.isSafeInteger(Number(verification.rowCounts[name]))
          && Number(verification.rowCounts[name]) > 0,
      );
      if (!rowCountsAreValid || !requiredCoreRowsExist) {
        throw new Error("Database core reference rows are missing or invalid; backup was not created");
      }
      if (verification.journalTotals.baseDebit !== verification.journalTotals.baseCredit) {
        throw new Error("Database journal totals are not balanced; backup was not created");
      }
      const snapshotStartedAt = new Date().toISOString();
      const dump = spawn(
        dumpBinary,
        [
          `--defaults-extra-file=${defaultsFile}`,
          "--single-transaction",
          "--quick",
          "--routines",
          "--triggers",
          "--events",
          "--hex-blob",
          "--no-tablespaces",
          "--skip-lock-tables",
          connection.database,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      await Promise.all([
        pipeline(
          dump.stdout,
          createGzip({ level: 9 }),
          new BackupEncryptTransform(passphrase),
          createWriteStream(partialPath, { flags: "wx", mode: 0o600 }),
        ),
        waitForChild(dump, "mysqldump"),
      ]);
      return { schemaMigrationCount, snapshotStartedAt };
    });

    await rename(partialPath, backupPath);
    backupCommitted = true;
    const [{ size }, sha256] = await Promise.all([stat(backupPath), sha256File(backupPath)]);
    const manifest = {
      format: "mcap-backup-v2",
      file: basename(backupPath),
      createdAt: new Date().toISOString(),
      snapshotStartedAt: metadata.snapshotStartedAt,
      schemaMigrationCount: metadata.schemaMigrationCount,
      bytes: size,
      sha256,
      encryption: "AES-256-GCM chunked; scrypt N=32768 r=8 p=1",
      compression: "gzip",
    };
    await writeFile(partialManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(partialManifestPath, manifestPath);
    manifestCommitted = true;
    process.stdout.write(`${JSON.stringify({ status: "created", backupPath, manifestPath, bytes: size })}\n`);
  } catch (error) {
    await Promise.all([
      rm(partialPath, { force: true }),
      rm(partialManifestPath, { force: true }),
      backupCommitted && !manifestCommitted ? rm(backupPath, { force: true }) : Promise.resolve(),
    ]);
    throw error;
  }
};

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Unknown error" })}\n`);
  process.exitCode = 1;
});
