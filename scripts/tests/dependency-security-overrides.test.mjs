import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readJson = async (relativePath) => JSON.parse(
  await readFile(new URL(relativePath, import.meta.url), "utf8"),
);

test("Prisma tooling resolves the patched deepmerge-ts release", async () => {
  const manifest = await readJson("../../package.json");
  const lockfile = await readJson("../../package-lock.json");
  const resolvedPackage = lockfile.packages?.["node_modules/deepmerge-ts"];

  assert.equal(manifest.overrides?.["deepmerge-ts"], "8.0.1");
  assert.equal(resolvedPackage?.version, "8.0.1");
  assert.equal(
    resolvedPackage?.integrity,
    "sha512-szCXE7YLCvLKR9bFPJcvsezOShdalctSvrgN/LM/QGUEPZQajwjmsMObZ6/DuANT5lxzM/wtO8Feubwdkz8myA==",
  );
});
