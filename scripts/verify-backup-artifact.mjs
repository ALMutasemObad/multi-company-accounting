import { verifyBackupArtifact } from "./lib/backup-artifact-verifier.mjs";

const parseMaxAge = (value) => {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/u.test(value)) throw new Error("BACKUP_MAX_AGE_SECONDS must be a positive integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("BACKUP_MAX_AGE_SECONDS must be a positive integer");
  }
  return parsed;
};

const main = async () => {
  const backupFile = process.argv[2];
  if (!backupFile || process.argv.length !== 3) {
    throw new Error("Usage: node scripts/verify-backup-artifact.mjs <backup-file>");
  }
  const result = await verifyBackupArtifact(backupFile, {
    maxAgeSeconds: parseMaxAge(process.env.BACKUP_MAX_AGE_SECONDS),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    error: error instanceof Error ? error.message : "Backup verification failed",
  })}\n`);
  process.exitCode = 1;
});
