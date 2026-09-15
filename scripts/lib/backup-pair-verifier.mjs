import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./backup-format.mjs";

const SHA = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export async function verifyBackupPair(pairManifestPath) {
  const pairPath = path.resolve(pairManifestPath);
  const pairStat = await lstat(pairPath);
  if (!pairStat.isFile() || pairStat.isSymbolicLink()) throw new Error("Backup pair manifest is unsafe");
  const pair = JSON.parse(await readFile(pairPath, "utf8"));
  const createdAtMs = typeof pair.createdAt === "string" ? Date.parse(pair.createdAt) : Number.NaN;
  if (pair.format !== "mcap-backup-pair-v1" || !UUID.test(pair.pairId)
    || !Number.isFinite(createdAtMs) || new Date(createdAtMs).toISOString() !== pair.createdAt) throw new Error("Backup pair manifest is invalid");
  const names = [pair.database?.artifact?.file, pair.database?.manifest?.file, pair.media?.artifact?.file, pair.media?.manifest?.file];
  if (new Set(names).size !== 4
    || !/\.sql\.gz\.jwb$/u.test(names[0] ?? "") || names[1] !== `${names[0]}.json`
    || !/\.tar\.gz\.jwb$/u.test(names[2] ?? "") || names[3] !== `${names[2]}.json`) throw new Error("Backup pair member names are invalid");
  for (const member of [pair.database, pair.media]) {
    for (const protectedFile of [member?.artifact, member?.manifest]) {
      if (!protectedFile || !SHA.test(protectedFile.sha256) || typeof protectedFile.file !== "string" || path.basename(protectedFile.file) !== protectedFile.file) throw new Error("Backup pair member is invalid");
      const artifact = path.join(path.dirname(pairPath), protectedFile.file);
      const details = await lstat(artifact);
      if (!details.isFile() || details.isSymbolicLink() || await sha256File(artifact) !== protectedFile.sha256) throw new Error("Backup pair member is missing or modified");
    }
  }
  return { status: "verified", pairId: pair.pairId, files: names };
}
