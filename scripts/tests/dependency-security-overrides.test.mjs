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

test("the lockfile pins the reviewed URI and query parser patches", async () => {
  const lockfile = await readJson("../../package-lock.json");
  const fastUri = lockfile.packages?.["node_modules/fast-uri"];
  const queryString = lockfile.packages?.["node_modules/qs"];

  assert.equal(fastUri?.version, "3.1.7");
  assert.equal(
    fastUri?.integrity,
    "sha512-dOvZVzjdZdz7phd9v6jCbwxrBW3fK6n8Rc0CtdmM4bumzMnxywBYhuph6J819RRw/ku+rLbelwfMunktuzVVHg==",
  );
  assert.equal(queryString?.version, "6.16.0");
  assert.equal(
    queryString?.integrity,
    "sha512-h6fhOIaRrID2CbEY2fqs+7t+UXZo+MLAnU5gRIq85uFtdiUPCdsApMlHhXogKVM4HM2DVbIjGNTTYH2OcmP1vA==",
  );
});
