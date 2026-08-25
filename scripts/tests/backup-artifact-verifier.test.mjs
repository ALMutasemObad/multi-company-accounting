import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyBackupArtifact } from "../lib/backup-artifact-verifier.mjs";

const fixedNow = new Date("2026-08-25T12:00:00.000Z");
const encryption = "AES-256-GCM chunked; scrypt N=32768 r=8 p=1";

async function fixture(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "mcap-backup-artifact-"));
  const file = "mcap-production-2026-08-25.sql.gz.jwb";
  const backupPath = join(directory, file);
  const contents = Buffer.from("encrypted-production-backup-fixture");
  await writeFile(backupPath, contents, { mode: 0o600 });
  const manifest = {
    format: "mcap-backup-v2",
    file,
    createdAt: "2026-08-25T11:59:00.000Z",
    snapshotStartedAt: "2026-08-25T11:58:50.000Z",
    schemaMigrationCount: 38,
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
    encryption,
    compression: "gzip",
    ...overrides,
  };
  await writeFile(`${backupPath}.json`, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  return {
    backupPath,
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("verifies a fresh encrypted backup without returning protected database metadata", async () => {
  const value = await fixture();
  try {
    const result = await verifyBackupArtifact(value.backupPath, { now: fixedNow, maxAgeSeconds: 3600 });
    assert.deepEqual(result, {
      status: "verified",
      file: "mcap-production-2026-08-25.sql.gz.jwb",
      createdAt: "2026-08-25T11:59:00.000Z",
      recoveryPointAt: "2026-08-25T11:58:50.000Z",
      ageSeconds: 70,
      bytes: 35,
      sha256: "1fe8d5c79950085b3fa2c475d9f69ada80e74fc53ebc755d5442aa7e07dec4d8",
      schemaMigrationCount: 38,
    });
    assert.equal("sourceDatabase" in result, false);
    assert.equal("verification" in result, false);

    const legacy = await fixture({
      format: "mcap-backup-v1",
      snapshotStartedAt: undefined,
      sourceDatabase: "legacy_database",
      mysqlVersion: "10.11",
      verification: { companyCount: "2" },
    });
    try {
      const legacyResult = await verifyBackupArtifact(legacy.backupPath, { now: fixedNow });
      assert.equal(legacyResult.status, "verified");
      assert.equal("sourceDatabase" in legacyResult, false);
      assert.equal("verification" in legacyResult, false);
    } finally {
      await legacy.cleanup();
    }
  } finally {
    await value.cleanup();
  }
});

test("rejects artifact tampering and manifest file-name substitution", async () => {
  const tampered = await fixture();
  try {
    await writeFile(tampered.backupPath, "tampered-after-manifest");
    await assert.rejects(
      verifyBackupArtifact(tampered.backupPath, { now: fixedNow }),
      /size does not match|SHA-256 verification failed/u,
    );
  } finally {
    await tampered.cleanup();
  }

  const renamed = await fixture({ file: "different.sql.gz.jwb" });
  try {
    await assert.rejects(
      verifyBackupArtifact(renamed.backupPath, { now: fixedNow }),
      /file name does not match/u,
    );
  } finally {
    await renamed.cleanup();
  }

  const exposed = await fixture({ sourceDatabase: "must-not-be-plaintext" });
  try {
    await assert.rejects(
      verifyBackupArtifact(exposed.backupPath, { now: fixedNow }),
      /unsupported plaintext metadata/u,
    );
  } finally {
    await exposed.cleanup();
  }

  const nestedExposure = await fixture({
    diagnostics: { sourceDatabase: "must-not-be-plaintext", journalTotals: { debit: "10" } },
  });
  try {
    await assert.rejects(
      verifyBackupArtifact(nestedExposure.backupPath, { now: fixedNow }),
      /unsupported plaintext metadata/u,
    );
  } finally {
    await nestedExposure.cleanup();
  }
});

test("enforces the recovery point age and rejects implausible future timestamps", async () => {
  const stale = await fixture({
    createdAt: "2026-08-24T08:00:00.000Z",
    snapshotStartedAt: "2026-08-24T07:59:50.000Z",
  });
  try {
    await assert.rejects(
      verifyBackupArtifact(stale.backupPath, { now: fixedNow, maxAgeSeconds: 26 * 60 * 60 }),
      /older than the allowed recovery point objective/u,
    );
  } finally {
    await stale.cleanup();
  }

  const future = await fixture({ createdAt: "2026-08-25T12:06:00.000Z" });
  try {
    await assert.rejects(
      verifyBackupArtifact(future.backupPath, { now: fixedNow }),
      /timestamp is in the future/u,
    );
  } finally {
    await future.cleanup();
  }
});
