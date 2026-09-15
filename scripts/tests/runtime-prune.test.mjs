import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helper = path.join(root, "scripts/release/prune-runtime.mjs");
const npmCli = process.env.npm_execpath;
const runNpm = (directory, args) => exec(process.execPath, [npmCli, ...args], {
  cwd: directory, timeout: 30_000, maxBuffer: 1024 * 1024,
});
const fixture = async (requiredPeer = false) => {
  const directory = await mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "mcap-runtime-prune-"));
  const packages = {
    prisma: { name: "prisma", version: "1.0.0" },
    "native-binding": { name: "native-binding", version: "1.0.0" },
    consumer: {
      name: "consumer", version: "1.0.0",
      peerDependencies: { prisma: "1.0.0", ...(requiredPeer ? { "required-runtime": "1.0.0" } : {}) },
      peerDependenciesMeta: { prisma: { optional: true } },
    },
    "required-runtime": { name: "required-runtime", version: "1.0.0" },
  };
  for (const [name, metadata] of Object.entries(packages)) {
    const target = path.join(directory, "packages", name);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "package.json"), JSON.stringify(metadata));
  }
  await writeFile(path.join(directory, "package.json"), JSON.stringify({
    name: "runtime-prune-fixture", private: true, version: "1.0.0",
    dependencies: { consumer: "file:packages/consumer" },
    optionalDependencies: { "native-binding": "file:packages/native-binding" },
    devDependencies: { prisma: "file:packages/prisma", ...(requiredPeer ? { "required-runtime": "file:packages/required-runtime" } : {}) },
  }));
  await runNpm(directory, ["install", "--install-links", "--ignore-scripts", "--no-audit", "--no-fund"]);
  return directory;
};

test("runtime pruning removes a devOptional build peer, keeps native optionals, and preserves the lock", { timeout: 30_000 }, async (t) => {
  assert.ok(npmCli, "Run infrastructure tests through npm so the pinned CLI is available");
  const directory = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, "package-lock.json");
  const original = await readFile(lockPath);
  assert.equal(JSON.parse(original).packages["node_modules/prisma"].devOptional, true);
  await runNpm(directory, ["prune", "--omit=dev", "--no-save", "--ignore-scripts", "--no-audit"]);
  assert.equal(JSON.parse(await readFile(path.join(directory, "node_modules/prisma/package.json"))).name, "prisma");
  await exec(process.execPath, [helper], { cwd: directory, timeout: 30_000 });
  await assert.rejects(readFile(path.join(directory, "node_modules/prisma/package.json")), { code: "ENOENT" });
  assert.equal(JSON.parse(await readFile(path.join(directory, "node_modules/native-binding/package.json"))).name, "native-binding");
  assert.deepEqual(await readFile(lockPath), original);
});

test("runtime pruning fails closed when a required runtime peer would be missing", { timeout: 30_000 }, async (t) => {
  assert.ok(npmCli, "Run infrastructure tests through npm so the pinned CLI is available");
  const directory = await fixture(true);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = await readFile(path.join(directory, "package-lock.json"));
  await assert.rejects(exec(process.execPath, [helper], { cwd: directory, timeout: 30_000 }), (error) => {
    assert.match(error.stderr, /Production runtime dependency and peer graph is invalid/u);
    return true;
  });
  assert.deepEqual(await readFile(path.join(directory, "package-lock.json")), original);
});

test("release digest capture cannot hide a packaging failure behind tee", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /set -Eeuo pipefail\s+bash scripts\/release\/package-release\.sh \. \. \| tee release-digests\.txt/u);
  assert.match(workflow, /grep -Eq '\^archive_sha256=\[0-9a-f\]\{64\}\$' release-digests\.txt/u);
  assert.match(workflow, /grep -Eq '\^manifest_sha256=\[0-9a-f\]\{64\}\$' release-digests\.txt/u);
  assert.equal((workflow.match(/npm run runtime:prune/gu) || []).length, 2);
});
