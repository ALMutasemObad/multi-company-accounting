import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { sha256File } from "./backup-format.mjs";

const BACKUP_FORMATS = new Set(["mcap-backup-v1", "mcap-backup-v2"]);
const BACKUP_ENCRYPTION = "AES-256-GCM chunked; scrypt N=32768 r=8 p=1";
const BACKUP_COMPRESSION = "gzip";
const FUTURE_CLOCK_SKEW_SECONDS = 300;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const V2_MANIFEST_FIELDS = new Set([
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

const fail = (message) => {
  throw new Error(message);
};

const parseManifest = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return fail("Backup manifest is not valid JSON");
  }
};

const parseCreatedAt = (value) => {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) {
    return fail("Backup manifest createdAt is invalid");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return fail("Backup manifest createdAt is invalid");
  }
  return timestamp;
};

export async function verifyBackupArtifact(
  backupFile,
  { now = new Date(), maxAgeSeconds } = {},
) {
  const backupPath = resolve(backupFile);
  const manifestPath = `${backupPath}.json`;
  const [backupStat, manifestStat] = await Promise.all([lstat(backupPath), lstat(manifestPath)]);
  if (!backupStat.isFile() || backupStat.isSymbolicLink()) fail("Backup artifact is not a regular file");
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) fail("Backup manifest is not a regular file");
  const [manifestText, actualSha256] = await Promise.all([
    readFile(manifestPath, "utf8"),
    sha256File(backupPath),
  ]);

  const manifest = parseManifest(manifestText);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("Backup manifest must be a JSON object");
  }
  if (!BACKUP_FORMATS.has(manifest.format)) fail("Unsupported backup manifest format");
  if (manifest.format === "mcap-backup-v2") {
    const fields = Object.keys(manifest);
    if (
      fields.length !== V2_MANIFEST_FIELDS.size
      || fields.some((field) => !V2_MANIFEST_FIELDS.has(field))
    ) {
      fail("Backup manifest contains unsupported plaintext metadata");
    }
    if (typeof manifest.snapshotStartedAt !== "string") {
      fail("Backup manifest recovery point timestamp is missing");
    }
  }
  if (manifest.file !== basename(backupPath)) fail("Backup manifest file name does not match the artifact");
  if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes !== backupStat.size) {
    fail("Backup manifest size does not match the artifact");
  }
  if (typeof manifest.sha256 !== "string" || !SHA256.test(manifest.sha256) || manifest.sha256 !== actualSha256) {
    fail("Backup artifact SHA-256 verification failed");
  }
  if (!Number.isSafeInteger(manifest.schemaMigrationCount) || manifest.schemaMigrationCount <= 0) {
    fail("Backup manifest migration count is invalid");
  }
  if (manifest.encryption !== BACKUP_ENCRYPTION || manifest.compression !== BACKUP_COMPRESSION) {
    fail("Backup manifest protection format is invalid");
  }

  const createdAtMs = parseCreatedAt(manifest.createdAt);
  const recoveryPointAt = manifest.snapshotStartedAt ?? manifest.createdAt;
  const recoveryPointAtMs = parseCreatedAt(recoveryPointAt);
  if (recoveryPointAtMs > createdAtMs) fail("Backup recovery point timestamp is after artifact creation");
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) fail("Backup verification clock is invalid");
  if (createdAtMs - nowMs > FUTURE_CLOCK_SKEW_SECONDS * 1000) {
    fail("Backup manifest creation timestamp is in the future");
  }
  const signedAgeSeconds = Math.floor((nowMs - recoveryPointAtMs) / 1000);
  if (signedAgeSeconds < -FUTURE_CLOCK_SKEW_SECONDS) fail("Backup manifest timestamp is in the future");
  const ageSeconds = Math.max(0, signedAgeSeconds);
  if (maxAgeSeconds !== undefined) {
    if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
      fail("Maximum backup age must be a positive integer number of seconds");
    }
    if (ageSeconds > maxAgeSeconds) fail("Backup artifact is older than the allowed recovery point objective");
  }

  return {
    status: "verified",
    file: basename(backupPath),
    createdAt: manifest.createdAt,
    recoveryPointAt,
    ageSeconds,
    bytes: manifest.bytes,
    sha256: manifest.sha256,
    schemaMigrationCount: manifest.schemaMigrationCount,
  };
}
