import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { BackupEncryptTransform, sha256File, validateBackupPassphrase } from "./lib/backup-format.mjs";

const main = async () => {
  const root = path.resolve(process.env.MEDIA_ROOT || "");
  if (!process.env.MEDIA_ROOT || !path.isAbsolute(process.env.MEDIA_ROOT) || path.parse(root).root === root) throw new Error("MEDIA_ROOT must be absolute and non-root");
  if (await realpath(root) !== root || (await lstat(root)).isSymbolicLink()) throw new Error("MEDIA_ROOT must be a real non-symlink directory");
  const passphrase = validateBackupPassphrase(process.env.BACKUP_ENCRYPTION_PASSPHRASE);
  const outputDirectory = path.resolve(process.env.BACKUP_DIRECTORY || "backups");
  const tarBinary = process.env.TAR_BIN || "tar";
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const resolvedOutput = await realpath(outputDirectory);
  if (resolvedOutput === root || resolvedOutput.startsWith(`${root}${path.sep}`) || root.startsWith(`${resolvedOutput}${path.sep}`)) throw new Error("BACKUP_DIRECTORY and MEDIA_ROOT must not contain one another");
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = path.join(outputDirectory, `mcap-product-media-${stamp}.tar.gz.jwb`);
  const partialPath = `${backupPath}.partial`; const manifestPath = `${backupPath}.json`; const partialManifest = `${manifestPath}.partial`;
  try {
    const archive = spawn(tarBinary, ["-C", root, "--exclude=.staging-*", "--exclude=*/.staging-*", "-cf", "-", "."], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; archive.stderr.setEncoding("utf8"); archive.stderr.on("data", (chunk) => { stderr += chunk; });
    const completion = new Promise((resolve, reject) => { archive.once("error", reject); archive.once("close", resolve); });
    // WebP payloads are already compressed; level 1 avoids extending deploy/backup time for negligible gain.
    await pipeline(archive.stdout, createGzip({ level: 1 }), new BackupEncryptTransform(passphrase), createWriteStream(partialPath, { flags: "wx", mode: 0o600 }));
    const exitCode = await completion;
    if (exitCode !== 0) throw new Error(`tar failed: ${stderr.slice(0, 200)}`);
    await rename(partialPath, backupPath);
    const [{ size }, sha256] = await Promise.all([stat(backupPath), sha256File(backupPath)]);
    const manifest = { format: "mcap-media-backup-v1", file: path.basename(backupPath), createdAt: new Date().toISOString(), bytes: size, sha256, encryption: "AES-256-GCM chunked; scrypt N=32768 r=8 p=1", compression: "gzip+tar" };
    await writeFile(partialManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(partialManifest, manifestPath);
    process.stdout.write(`${JSON.stringify({ status: "created", backupPath, manifestPath, bytes: size, sha256 })}\n`);
  } catch (error) {
    await Promise.all([
      rm(partialPath, { force: true }), rm(partialManifest, { force: true }),
      rm(backupPath, { force: true }), rm(manifestPath, { force: true }),
    ]);
    throw error;
  }
};

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "media backup failed"}\n`); process.exitCode = 1; });
