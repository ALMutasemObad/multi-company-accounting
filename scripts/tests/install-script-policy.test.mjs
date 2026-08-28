import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const verifier = fileURLToPath(
  new URL("../ci/verify-install-scripts.mjs", import.meta.url),
);

function verify(input) {
  return spawnSync(process.execPath, [verifier], {
    input,
    encoding: "utf8",
    windowsHide: true,
  });
}

test("install-script policy accepts an empty pending report", () => {
  const result = verify("{}\n");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("install-script policy rejects unapproved scripts without exposing report input", () => {
  const result = verify(JSON.stringify({ pending: ["unexpected-package@1.2.3"] }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unapproved install scripts: unexpected-package@1\.2\.3/u);
});

test("install-script policy fails closed on malformed npm output", () => {
  const result = verify("not-json");
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "Invalid npm install-script report.\n");
});
