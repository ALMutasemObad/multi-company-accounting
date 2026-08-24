import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { writeReleaseManifest } from "../lib/release-manifest.mjs";

const RELEASE_PATHS = [
  ".env.production.example",
  "apps/api/dist",
  "apps/api/package.json",
  "apps/api/prisma.config.ts",
  "apps/api/prisma/migrations",
  "apps/api/prisma/schema.prisma",
  "apps/web/dist",
  "apps/web/package.json",
  "deploy/nginx",
  "deploy/scripts",
  "deploy/systemd",
  "docs/production-operations.md",
  "docs/ifastnet-cpanel-deployment.md",
  "docs/security-advisories.md",
  "ecosystem.config.cjs",
  "node_modules",
  "package-lock.json",
  "package.json",
  "scripts/database-backup.mjs",
  "scripts/database-restore.mjs",
  "scripts/verify-database-identities.mjs",
  "scripts/lib",
  "scripts/release/verify-release.mjs",
];

const FORBIDDEN_PRODUCTION_DEPENDENCIES = ["prisma", "tsx", "typescript", "vitest"];

const parseArguments = (argumentsList) => {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(`Invalid argument: ${name ?? ""}`);
    options[name.slice(2)] = value;
  }
  return options;
};

const exists = async (value) => {
  try { await lstat(value); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
};

const copyWithoutLinks = async (source, destination) => {
  const details = await lstat(source);
  if (details.isSymbolicLink()) return 1;
  if (details.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: details.mode & 0o777 });
    let skipped = 0;
    const entries = await readdir(source);
    entries.sort((left, right) => left.localeCompare(right, "en"));
    for (const entry of entries) skipped += await copyWithoutLinks(path.join(source, entry), path.join(destination, entry));
    return skipped;
  }
  if (!details.isFile()) throw new Error(`Unsupported release input: ${source}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: false, errorOnExist: true, preserveTimestamps: true });
  return 0;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const source = path.resolve(options.source ?? ".");
  const output = path.resolve(options.output ?? "release-root");
  if (source === output) throw new Error("Release output must differ from the source root");
  if (await exists(output)) throw new Error(`Release output already exists: ${output}`);

  const actualTarget = `${process.platform}-${process.arch}`;
  const target = options.target ?? process.env.RELEASE_TARGET ?? actualTarget;
  if (target !== actualTarget) throw new Error(`Release target must match the build runtime: ${actualTarget}`);

  const packageJson = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
  for (const dependency of FORBIDDEN_PRODUCTION_DEPENDENCIES) {
    if (await exists(path.join(source, "node_modules", dependency))) {
      throw new Error(`Development dependency remains in production tree: ${dependency}. Run npm prune --omit=dev --omit=optional first.`);
    }
  }

  const epochSeconds = Number(options.epoch ?? process.env.SOURCE_DATE_EPOCH);
  const builtAt = options["built-at"] ?? (Number.isSafeInteger(epochSeconds) && epochSeconds >= 0
    ? new Date(epochSeconds * 1000).toISOString()
    : new Date().toISOString());
  const commit = options.commit ?? process.env.RELEASE_COMMIT ?? "local";
  const version = options.version ?? process.env.RELEASE_VERSION ?? packageJson.version;
  await mkdir(path.dirname(output), { recursive: true });
  let staging = path.join(path.dirname(output), `.${path.basename(output)}.partial-${process.pid}-${Date.now()}`);
  if (await exists(staging)) throw new Error(`Temporary release output already exists: ${staging}`);
  let skippedLinks = 0;
  let manifest;
  try {
    await mkdir(staging, { mode: 0o755 });
    for (const relative of RELEASE_PATHS) {
      const input = path.join(source, relative);
      if (!await exists(input)) throw new Error(`Required release input is missing: ${relative}`);
      skippedLinks += await copyWithoutLinks(input, path.join(staging, relative));
    }
    await mkdir(path.join(staging, "tmp"), { mode: 0o755 });
    await writeFile(path.join(staging, "tmp", "restart.txt"), "", { mode: 0o644, flag: "wx" });
    manifest = await writeReleaseManifest(staging, {
      packageVersion: packageJson.version,
      version,
      commit,
      builtAt,
      target,
      nodeVersion: process.versions.node,
    });
    await rename(staging, output);
    staging = "";
  } catch (error) {
    if (staging && await exists(staging)) await rm(staging, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(`${JSON.stringify({
    status: "created",
    root: output,
    skippedLinks,
    releaseId: manifest.releaseId,
    version: manifest.version,
    commit: manifest.commit,
    target: manifest.target,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
  })}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
