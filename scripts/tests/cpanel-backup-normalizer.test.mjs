import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { normalizeCpanelBackup } from "../../deploy/scripts/normalize-cpanel-backup.mjs";

const encryption = "AES-256-GCM chunked; scrypt N=32768 r=8 p=1";

async function legacyFixture() {
  const directory = await mkdtemp(join(tmpdir(), "mcap-cpanel-normalizer-"));
  const backupPath = join(directory, "mcap-sensitive-source-2026.sql.gz.jwb");
  const bytes = Buffer.from("authenticated-encrypted-production-dump");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const manifestPath = `${backupPath}.json`;
  await writeFile(backupPath, bytes, { mode: 0o600 });
  await writeFile(manifestPath, `${JSON.stringify({
    format: "mcap-backup-v1",
    file: basename(backupPath),
    createdAt,
    sourceDatabase: "sensitive_production_name",
    mysqlVersion: "10.11.11-MariaDB",
    schemaMigrationCount: 38,
    bytes: bytes.length,
    sha256,
    encryption,
    compression: "gzip",
    verification: {
      rowCounts: { organizations: 1, companies: 2, users: 3 },
      journalTotals: { baseDebit: "100.00", baseCredit: "100.00" },
    },
  }, null, 2)}\n`, { mode: 0o600 });
  return {
    backupPath,
    manifestPath,
    directory,
    sha256,
    createdAt,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("atomically replaces a legacy recovery point with a sanitized v2 pair", async () => {
  const value = await legacyFixture();
  try {
    const result = normalizeCpanelBackup(value.backupPath, value.manifestPath, value.sha256);
    assert.equal(result.status, "created");
    assert.match(result.file, /^mcap-production-.*\.sql\.gz\.jwb$/u);
    const sanitized = JSON.parse(await readFile(join(value.directory, result.manifest), "utf8"));
    assert.deepEqual(Object.keys(sanitized).sort(), [
      "bytes",
      "compression",
      "createdAt",
      "encryption",
      "file",
      "format",
      "schemaMigrationCount",
      "sha256",
      "snapshotStartedAt",
    ].sort());
    assert.equal(sanitized.format, "mcap-backup-v2");
    assert.equal(sanitized.snapshotStartedAt, value.createdAt);
    assert.equal("sourceDatabase" in sanitized, false);
    await assert.rejects(readFile(value.backupPath), { code: "ENOENT" });
    await assert.rejects(readFile(value.manifestPath), { code: "ENOENT" });
  } finally {
    await value.cleanup();
  }
});

test("rejects unexpected plaintext fields in a native v2 manifest", async () => {
  const value = await legacyFixture();
  try {
    const genericName = `mcap-production-${Date.now()}.sql.gz.jwb`;
    const genericPath = join(value.directory, genericName);
    const bytes = await readFile(value.backupPath);
    await writeFile(genericPath, bytes, { mode: 0o600 });
    const manifestPath = `${genericPath}.json`;
    await writeFile(manifestPath, `${JSON.stringify({
      format: "mcap-backup-v2",
      file: genericName,
      createdAt: value.createdAt,
      snapshotStartedAt: value.createdAt,
      schemaMigrationCount: 38,
      bytes: bytes.length,
      sha256: value.sha256,
      encryption,
      compression: "gzip",
      diagnostics: { sourceDatabase: "must-not-leak" },
    })}\n`, { mode: 0o600 });
    assert.throws(
      () => normalizeCpanelBackup(genericPath, manifestPath, value.sha256),
      /unsupported plaintext metadata/u,
    );
  } finally {
    await value.cleanup();
  }
});

test("leaves the legacy pair untouched when the sanitized target already exists", async () => {
  const value = await legacyFixture();
  try {
    const stamp = value.createdAt.replaceAll(":", "-").replaceAll(".", "-");
    const target = join(
      value.directory,
      `mcap-production-${stamp}-${value.sha256.slice(0, 12)}.sql.gz.jwb`,
    );
    await writeFile(target, "preexisting-target", { mode: 0o600 });
    assert.throws(
      () => normalizeCpanelBackup(value.backupPath, value.manifestPath, value.sha256),
      /target already exists/u,
    );
    assert.equal((await readFile(value.backupPath, "utf8")), "authenticated-encrypted-production-dump");
    assert.equal(JSON.parse(await readFile(value.manifestPath, "utf8")).format, "mcap-backup-v1");
    assert.equal(await readFile(target, "utf8"), "preexisting-target");
  } finally {
    await value.cleanup();
  }
});
