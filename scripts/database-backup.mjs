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
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = resolve(outputDirectory, `mcap-${connection.database}-${stamp}.sql.gz.jwb`);
  const partialPath = `${backupPath}.partial`;
  const manifestPath = `${backupPath}.json`;
  const partialManifestPath = `${manifestPath}.partial`;
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  try {
    const metadata = await withMysqlDefaultsFile(connection, async (defaultsFile) => {
      const mysqlVersion = await runMysqlScalar(mysqlBinary, defaultsFile, connection.database, "SELECT VERSION()");
      const schemaMigrationCountText = await runMysqlScalar(
        mysqlBinary,
        defaultsFile,
        connection.database,
        "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
      );
      const verification = await collectDatabaseVerification(mysqlBinary, defaultsFile, connection.database);
      if (verification.journalTotals.baseDebit !== verification.journalTotals.baseCredit) {
        throw new Error("Database journal totals are not balanced; backup was not created");
      }
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
      return { mysqlVersion, schemaMigrationCount: Number(schemaMigrationCountText), verification };
    });

    await rename(partialPath, backupPath);
    const [{ size }, sha256] = await Promise.all([stat(backupPath), sha256File(backupPath)]);
    const manifest = {
      format: "mcap-backup-v1",
      file: basename(backupPath),
      createdAt: new Date().toISOString(),
      sourceDatabase: connection.database,
      mysqlVersion: metadata.mysqlVersion,
      schemaMigrationCount: metadata.schemaMigrationCount,
      verification: metadata.verification,
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
    process.stdout.write(`${JSON.stringify({ status: "created", backupPath, manifestPath, bytes: size })}\n`);
  } catch (error) {
    await Promise.all([
      rm(partialPath, { force: true }),
      rm(partialManifestPath, { force: true }),
    ]);
    throw error;
  }
};

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Unknown error" })}\n`);
  process.exitCode = 1;
});
