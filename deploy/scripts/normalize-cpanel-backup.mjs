#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ENCRYPTION = "AES-256-GCM chunked; scrypt N=32768 r=8 p=1";
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const V2_FIELDS = new Set([
  "format",
  "file",
  "createdAt",
  "snapshotStartedAt",
  "schemaMigrationCount",
  "bytes",
  "sha256",
  "encryption",
  "compression",
]);

const parseTimestamp = (value, label) => {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return milliseconds;
};

const assertV2Manifest = (manifest, backupPath, actualSha256) => {
  const fields = Object.keys(manifest);
  if (fields.length !== V2_FIELDS.size || fields.some((field) => !V2_FIELDS.has(field))) {
    throw new Error("v2 manifest contains unsupported plaintext metadata");
  }
  const createdAt = parseTimestamp(manifest.createdAt, "createdAt");
  const snapshotStartedAt = parseTimestamp(manifest.snapshotStartedAt, "snapshotStartedAt");
  if (snapshotStartedAt > createdAt) throw new Error("snapshotStartedAt is after createdAt");
  if (createdAt - Date.now() > 300_000) throw new Error("createdAt is implausibly in the future");
  if (
    manifest.file !== path.basename(backupPath)
    || !Number.isSafeInteger(manifest.bytes)
    || manifest.bytes <= 0
    || manifest.bytes !== fs.lstatSync(backupPath).size
    || !SHA256.test(manifest.sha256)
    || manifest.sha256 !== actualSha256
    || !Number.isSafeInteger(manifest.schemaMigrationCount)
    || manifest.schemaMigrationCount <= 0
    || manifest.encryption !== ENCRYPTION
    || manifest.compression !== "gzip"
  ) {
    throw new Error("v2 manifest does not match the encrypted artifact");
  }
};

export function normalizeCpanelBackup(backupPath, manifestPath, actualSha256) {
  if (!path.isAbsolute(backupPath) || manifestPath !== `${backupPath}.json` || !SHA256.test(actualSha256)) {
    throw new Error("backup normalization arguments are invalid");
  }
  let backupStat = fs.lstatSync(backupPath);
  const manifestStat = fs.lstatSync(manifestPath);
  if (!backupStat.isFile() || backupStat.isSymbolicLink()) {
    throw new Error("backup artifact is not a regular file");
  }
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("backup manifest is not a regular file");
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("backup manifest is not valid JSON");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("backup manifest must be a JSON object");
  }
  if (!["mcap-backup-v1", "mcap-backup-v2"].includes(manifest.format)) {
    throw new Error("backup manifest format is unsupported");
  }
  const createdAt = parseTimestamp(manifest.createdAt, "createdAt");
  if (createdAt - Date.now() > 300_000) throw new Error("createdAt is implausibly in the future");
  if (
    manifest.file !== path.basename(backupPath)
    || !Number.isSafeInteger(manifest.bytes)
    || manifest.bytes <= 0
    || manifest.bytes !== backupStat.size
    || !SHA256.test(manifest.sha256)
    || manifest.sha256 !== actualSha256
    || !Number.isSafeInteger(manifest.schemaMigrationCount)
    || manifest.schemaMigrationCount <= 0
    || manifest.encryption !== ENCRYPTION
    || manifest.compression !== "gzip"
  ) {
    throw new Error("backup manifest does not match the encrypted artifact");
  }

  if (manifest.format === "mcap-backup-v1") {
    const snapshotStartedAt = manifest.snapshotStartedAt ?? manifest.createdAt;
    const snapshotStartedAtMs = parseTimestamp(snapshotStartedAt, "snapshotStartedAt");
    if (snapshotStartedAtMs > createdAt) throw new Error("snapshotStartedAt is after createdAt");
    const stamp = manifest.createdAt.replaceAll(":", "-").replaceAll(".", "-");
    const targetFile = `mcap-production-${stamp}-${actualSha256.slice(0, 12)}.sql.gz.jwb`;
    const targetPath = path.join(path.dirname(backupPath), targetFile);
    const targetManifestPath = `${targetPath}.json`;
    const partialManifestPath = `${targetManifestPath}.partial`;
    if ([targetPath, targetManifestPath, partialManifestPath].some((value) => fs.existsSync(value))) {
      throw new Error("sanitized backup target already exists");
    }
    const sanitized = {
      format: "mcap-backup-v2",
      file: targetFile,
      createdAt: manifest.createdAt,
      snapshotStartedAt,
      schemaMigrationCount: manifest.schemaMigrationCount,
      bytes: manifest.bytes,
      sha256: manifest.sha256,
      encryption: manifest.encryption,
      compression: manifest.compression,
    };
    fs.writeFileSync(partialManifestPath, `${JSON.stringify(sanitized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    let backupMoved = false;
    let manifestInstalled = false;
    try {
      fs.renameSync(backupPath, targetPath);
      backupMoved = true;
      fs.renameSync(partialManifestPath, targetManifestPath);
      manifestInstalled = true;
      fs.unlinkSync(manifestPath);
    } catch (error) {
      if (manifestInstalled) fs.rmSync(targetManifestPath, { force: true });
      if (backupMoved && fs.existsSync(targetPath) && !fs.existsSync(backupPath)) {
        fs.renameSync(targetPath, backupPath);
      }
      fs.rmSync(partialManifestPath, { force: true });
      throw error;
    }
    backupPath = targetPath;
    manifestPath = targetManifestPath;
    manifest = sanitized;
    backupStat = fs.lstatSync(backupPath);
  }

  assertV2Manifest(manifest, backupPath, actualSha256);
  if (!path.basename(backupPath).startsWith("mcap-production-")) {
    throw new Error("normalized backup file name is invalid");
  }
  const finalManifestStat = fs.lstatSync(manifestPath);
  if (!backupStat.isFile() || backupStat.isSymbolicLink() || !finalManifestStat.isFile() || finalManifestStat.isSymbolicLink()) {
    throw new Error("normalized recovery point is not made of regular files");
  }
  if (
    process.platform !== "win32"
    && ((backupStat.mode & 0o777) !== 0o600 || (finalManifestStat.mode & 0o777) !== 0o600)
  ) {
    throw new Error("normalized recovery point permissions are not 0600");
  }
  return {
    status: "created",
    file: path.basename(backupPath),
    manifest: path.basename(manifestPath),
    createdAt: manifest.createdAt,
    bytes: manifest.bytes,
    sha256: manifest.sha256,
    schemaMigrationCount: manifest.schemaMigrationCount,
  };
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) {
  try {
    if (process.argv.length !== 5) throw new Error("usage: normalize-cpanel-backup.mjs <backup> <manifest> <sha256>");
    const result = normalizeCpanelBackup(process.argv[2], process.argv[3], process.argv[4]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`backup normalization failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
