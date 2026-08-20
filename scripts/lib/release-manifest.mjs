import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const RELEASE_MANIFEST = "release-manifest.json";
export const RELEASE_SCHEMA_VERSION = 1;
export const DEFAULT_RELEASE_FILES = [
  ".env.production.example",
  "apps/api/dist/server.js",
  "apps/api/dist/platform/provision-company.js",
  "apps/api/dist/platform/seed-reference-data.js",
  "apps/api/prisma/schema.prisma",
  "apps/web/dist/index.html",
  "deploy/nginx/mcap-finance.conf.example",
  "deploy/scripts/install-release.sh",
  "deploy/scripts/install-cpanel-release.sh",
  "deploy/scripts/rollback-release.sh",
  "deploy/scripts/rollback-cpanel-release.sh",
  "deploy/systemd/mcap-backup.service.example",
  "deploy/systemd/mcap-backup.timer.example",
  "docs/production-operations.md",
  "docs/ifastnet-cpanel-deployment.md",
  "ecosystem.config.cjs",
  "node_modules/@prisma/client/package.json",
  "package-lock.json",
  "package.json",
  "scripts/database-backup.mjs",
  "scripts/database-restore.mjs",
  "scripts/lib/release-manifest.mjs",
  "scripts/release/verify-release.mjs",
  "tmp/restart.txt",
];

const manifestPath = (value) => value.split(path.sep).join("/");

const assertSafeRelativePath = (value) => {
  if (typeof value !== "string" || !value || value.includes("\\") || /[\r\n\0]/u.test(value)) {
    throw new Error(`Unsafe release path: ${JSON.stringify(value)}`);
  }
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || value === "." || value.startsWith("../")) {
    throw new Error(`Unsafe release path: ${JSON.stringify(value)}`);
  }
  return value;
};

const hashFile = (file) => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const input = createReadStream(file);
  input.on("data", (chunk) => hash.update(chunk));
  input.on("error", reject);
  input.on("end", () => resolve(hash.digest("hex")));
});

async function collectFiles(root, relative = "", files = []) {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name;
    const normalized = manifestPath(childRelative);
    if (normalized === RELEASE_MANIFEST) continue;
    const child = path.join(root, childRelative);
    const details = await lstat(child);
    if (details.isSymbolicLink()) throw new Error(`Release contains a symbolic link: ${normalized}`);
    if (details.isDirectory()) {
      await collectFiles(root, childRelative, files);
      continue;
    }
    if (!details.isFile()) throw new Error(`Release contains an unsupported filesystem entry: ${normalized}`);
    files.push({ path: normalized, bytes: details.size, sha256: await hashFile(child) });
  }
  return files;
}

const cleanMetadata = ({ packageVersion, version, commit, builtAt, target, nodeVersion }) => {
  for (const [name, value] of Object.entries({ packageVersion, version, commit, builtAt, target, nodeVersion })) {
    if (typeof value !== "string" || !value || value.length > 160 || /[\r\n\0]/u.test(value)) {
      throw new Error(`Invalid release metadata: ${name}`);
    }
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(version)) throw new Error("Invalid release version");
  if (!/^(?:[0-9a-f]{7,64}|local)$/u.test(commit)) throw new Error("Invalid release commit");
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(target)) throw new Error("Invalid release target");
  const timestamp = new Date(builtAt);
  if (!Number.isFinite(timestamp.valueOf()) || timestamp.toISOString() !== builtAt) throw new Error("Invalid release timestamp");
  const commitSuffix = commit === "local" ? "local" : commit.slice(0, 12);
  const releaseId = `${version.replaceAll("+", "-")}-${commitSuffix}`.toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,159}$/u.test(releaseId)) throw new Error("Invalid release identifier");
  return { packageVersion, version, commit, builtAt, target, nodeVersion, releaseId };
};

export async function buildReleaseManifest(root, metadata) {
  const absoluteRoot = path.resolve(root);
  const files = await collectFiles(absoluteRoot);
  const clean = cleanMetadata(metadata);
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    product: "mcap-finance",
    ...clean,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  };
}

export async function writeReleaseManifest(root, metadata) {
  const absoluteRoot = path.resolve(root);
  const manifest = await buildReleaseManifest(absoluteRoot, metadata);
  const destination = path.join(absoluteRoot, RELEASE_MANIFEST);
  const temporary = `${destination}.partial-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return manifest;
}

export async function verifyRelease(root, { requiredFiles = DEFAULT_RELEASE_FILES, expectedTarget = `${process.platform}-${process.arch}` } = {}) {
  const absoluteRoot = path.resolve(root);
  const manifestFile = path.join(absoluteRoot, RELEASE_MANIFEST);
  const manifestStats = await lstat(manifestFile);
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) throw new Error("Release manifest must be a regular file");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (manifest.schemaVersion !== RELEASE_SCHEMA_VERSION || manifest.product !== "mcap-finance") {
    throw new Error("Unsupported release manifest");
  }
  const clean = cleanMetadata(manifest);
  if (clean.releaseId !== manifest.releaseId) throw new Error("Release identifier does not match its metadata");
  if (clean.target !== expectedTarget) throw new Error(`Release target mismatch: expected ${expectedTarget}, found ${clean.target}`);
  if (!Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) throw new Error("Release file count is invalid");

  const expected = new Map();
  for (const entry of manifest.files) {
    const relative = assertSafeRelativePath(entry?.path);
    if (expected.has(relative)) throw new Error(`Duplicate release path: ${relative}`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/u.test(entry.sha256 ?? "")) {
      throw new Error(`Invalid manifest entry: ${relative}`);
    }
    expected.set(relative, entry);
  }

  for (const required of requiredFiles) {
    assertSafeRelativePath(required);
    if (!expected.has(required)) throw new Error(`Required release file is missing: ${required}`);
  }

  const actual = await collectFiles(absoluteRoot);
  if (actual.length !== expected.size) throw new Error(`Unexpected release file count: expected ${expected.size}, found ${actual.length}`);
  let totalBytes = 0;
  for (const file of actual) {
    const wanted = expected.get(file.path);
    if (!wanted) throw new Error(`Unexpected release file: ${file.path}`);
    if (wanted.bytes !== file.bytes) throw new Error(`Release file size mismatch: ${file.path}`);
    if (wanted.sha256 !== file.sha256) throw new Error(`Release file hash mismatch: ${file.path}`);
    totalBytes += file.bytes;
  }
  if (totalBytes !== manifest.totalBytes) throw new Error("Release total byte count is invalid");

  const packageFile = path.join(absoluteRoot, "package.json");
  if (requiredFiles.includes("package.json")) {
    const packageStats = await stat(packageFile);
    if (!packageStats.isFile()) throw new Error("Release package.json is invalid");
    const packageJson = JSON.parse(await readFile(packageFile, "utf8"));
    if (packageJson.version !== manifest.packageVersion) throw new Error("Release package version does not match package.json");
  }
  return { releaseId: manifest.releaseId, version: manifest.version, commit: manifest.commit, fileCount: actual.length, totalBytes };
}
