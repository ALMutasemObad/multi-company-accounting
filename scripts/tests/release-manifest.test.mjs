import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { RELEASE_MANIFEST, verifyRelease, writeReleaseManifest } from "../lib/release-manifest.mjs";

const roots = [];
const metadata = {
  packageVersion: "1.2.3",
  version: "1.2.3+test",
  commit: "0123456789abcdef",
  builtAt: "2026-08-21T00:00:00.000Z",
  target: "linux-x64",
  nodeVersion: "24.19.0",
};
const requiredFiles = ["package.json", "payload/data.txt"];

const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mcap-release-test-"));
  roots.push(root);
  await mkdir(path.join(root, "payload"));
  await writeFile(path.join(root, "package.json"), '{"name":"fixture","version":"1.2.3"}\n');
  await writeFile(path.join(root, "payload", "data.txt"), "alpha");
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("release manifests are deterministic when file mtimes and creation order change", async () => {
  const root = await fixture();
  await writeReleaseManifest(root, metadata);
  const first = await readFile(path.join(root, RELEASE_MANIFEST), "utf8");
  await rm(path.join(root, RELEASE_MANIFEST));
  await utimes(path.join(root, "payload", "data.txt"), new Date("2030-01-01"), new Date("2030-01-01"));
  await writeReleaseManifest(root, metadata);
  const second = await readFile(path.join(root, RELEASE_MANIFEST), "utf8");
  assert.equal(second, first);
  assert.deepEqual(await verifyRelease(root, { requiredFiles, expectedTarget: "linux-x64" }), {
    releaseId: "1.2.3-test-0123456789ab",
    version: "1.2.3+test",
    commit: "0123456789abcdef",
    fileCount: 2,
    totalBytes: 42,
  });
});

test("release verification detects content tampering even when file size is unchanged", async () => {
  const root = await fixture();
  await writeReleaseManifest(root, metadata);
  await writeFile(path.join(root, "payload", "data.txt"), "bravo");
  await assert.rejects(verifyRelease(root, { requiredFiles, expectedTarget: "linux-x64" }), /hash mismatch/u);
});

test("release verification detects added and removed files", async () => {
  const extraRoot = await fixture();
  await writeReleaseManifest(extraRoot, metadata);
  await writeFile(path.join(extraRoot, "unexpected.txt"), "unexpected");
  await assert.rejects(verifyRelease(extraRoot, { requiredFiles, expectedTarget: "linux-x64" }), /file count/u);

  const missingRoot = await fixture();
  await writeReleaseManifest(missingRoot, metadata);
  await rm(path.join(missingRoot, "payload", "data.txt"));
  await assert.rejects(verifyRelease(missingRoot, { requiredFiles, expectedTarget: "linux-x64" }), /file count/u);
});

test("release creation rejects symbolic links", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "target"));
  await symlink(path.join(root, "target"), path.join(root, "linked"), "junction");
  await assert.rejects(writeReleaseManifest(root, metadata), /symbolic link/u);
});

test("release verification rejects manifest path traversal", async () => {
  const root = await fixture();
  await writeReleaseManifest(root, metadata);
  const manifestFile = path.join(root, RELEASE_MANIFEST);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.files[0].path = "../escape";
  await writeFile(manifestFile, `${JSON.stringify(manifest)}\n`);
  await assert.rejects(verifyRelease(root, { requiredFiles: [], expectedTarget: "linux-x64" }), /Unsafe release path/u);
});

test("release verification rejects artifacts built for another platform", async () => {
  const root = await fixture();
  await writeReleaseManifest(root, metadata);
  await assert.rejects(verifyRelease(root, { requiredFiles, expectedTarget: "win32-x64" }), /target mismatch/u);
});
