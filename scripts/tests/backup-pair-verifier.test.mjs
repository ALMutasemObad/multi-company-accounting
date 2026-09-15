import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256File } from "../lib/backup-format.mjs";
import { verifyBackupPair } from "../lib/backup-pair-verifier.mjs";

test("backup pair verification rejects a missing or modified encrypted member", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcap-backup-pair-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const database = path.join(root, "database.sql.gz.jwb");
  const media = path.join(root, "media.tar.gz.jwb");
  await writeFile(database, "encrypted-db"); await writeFile(media, "encrypted-media");
  const databaseManifest = `${database}.json`; const mediaManifest = `${media}.json`;
  await writeFile(databaseManifest, "db-manifest"); await writeFile(mediaManifest, "media-manifest");
  const pair = path.join(root, "pair.json");
  await writeFile(pair, JSON.stringify({
    format: "mcap-backup-pair-v1", pairId: "123e4567-e89b-42d3-a456-426614174000", createdAt: "2026-09-15T00:00:00.000Z",
    database: { artifact: { file: path.basename(database), sha256: await sha256File(database) }, manifest: { file: path.basename(databaseManifest), sha256: await sha256File(databaseManifest) } },
    media: { artifact: { file: path.basename(media), sha256: await sha256File(media) }, manifest: { file: path.basename(mediaManifest), sha256: await sha256File(mediaManifest) } },
  }));
  await assert.doesNotReject(verifyBackupPair(pair));
  const validPair = await readFile(pair, "utf8");
  await writeFile(pair, validPair.replace("2026-09-15T00:00:00.000Z", "2026-09-15"));
  await assert.rejects(verifyBackupPair(pair), /invalid/u);
  await writeFile(pair, validPair);
  await writeFile(media, "modified");
  await assert.rejects(verifyBackupPair(pair), /missing or modified/u);
  await rm(media);
  await assert.rejects(verifyBackupPair(pair));
});
