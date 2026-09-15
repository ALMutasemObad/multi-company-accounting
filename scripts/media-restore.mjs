import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { BackupDecryptTransform, sha256File, validateBackupPassphrase } from "./lib/backup-format.mjs";

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = ""; child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject); child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`tar failed: ${stderr.slice(0, 200)}`)));
});

async function assertSafeTree(directory) {
  let files = 0;
  let sourceBytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name); const details = await lstat(candidate);
    if (details.isSymbolicLink() || (!details.isDirectory() && !details.isFile())) throw new Error("Restored media contains an unsafe entry");
    if (details.isDirectory()) {
      const nested = await assertSafeTree(candidate);
      files += nested.files;
      sourceBytes += nested.sourceBytes;
    } else {
      files += 1;
      sourceBytes += details.size;
    }
  }
  return { files, sourceBytes };
}

export async function restoreMediaBackup(backupFile, destination, { passphrase, tarBinary = "tar" } = {}) {
  const backupPath = path.resolve(backupFile); const manifestPath = `${backupPath}.json`; const target = path.resolve(destination);
  validateBackupPassphrase(passphrase);
  const [manifestStat, backupStat] = await Promise.all([lstat(manifestPath), lstat(backupPath)]);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || !backupStat.isFile() || backupStat.isSymbolicLink()) throw new Error("Media backup artifact or manifest is invalid");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.format !== "mcap-media-backup-v1" || manifest.file !== path.basename(backupPath)
    || manifest.sha256 !== await sha256File(backupPath) || manifest.bytes !== backupStat.size
    || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0
    || manifest.encryption !== "AES-256-GCM chunked; scrypt N=32768 r=8 p=1" || manifest.compression !== "gzip+tar") {
    throw new Error("Media backup artifact or manifest is invalid");
  }
  try { await lstat(target); throw new Error("Media restore destination must not exist"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const parent = path.dirname(target); await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== parent) throw new Error("Media restore parent must not traverse symlinks");
  const temporaryArchive = path.join(parent, `.media-restore-${process.pid}-${Date.now()}.tar.gz`);
  const staging = `${target}.staging-${process.pid}-${Date.now()}`;
  try {
    await pipeline(createReadStream(backupPath), new BackupDecryptTransform(passphrase), createWriteStream(temporaryArchive, { flags: "wx", mode: 0o600 }));
    const listing = await run(tarBinary, ["-tzf", temporaryArchive]);
    for (const entry of listing.split(/\r?\n/u).filter(Boolean)) {
      const clean = entry.replace(/^\.\//u, "");
      if (path.posix.isAbsolute(clean) || clean === ".." || clean.startsWith("../") || clean.includes("/../")) throw new Error("Media archive contains an unsafe path");
    }
    await mkdir(staging, { mode: 0o750 });
    await run(tarBinary, ["-xzf", temporaryArchive, "--no-same-owner", "--no-same-permissions", "-C", staging]);
    await assertSafeTree(staging);
    await rename(staging, target);
    return { status: "restored" };
  } finally {
    await Promise.all([rm(temporaryArchive, { force: true }), rm(staging, { recursive: true, force: true })]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  restoreMediaBackup(process.argv[2], process.argv[3], { passphrase: process.env.BACKUP_ENCRYPTION_PASSPHRASE })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "media restore failed"}\n`); process.exitCode = 1; });
}
