import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installers = ["install-release.sh", "install-cpanel-release.sh"];

test("deployment installers do not require /dev/fd process substitution", async () => {
  for (const installer of installers) {
    const source = await readFile(path.join(repositoryRoot, "deploy", "scripts", installer), "utf8");
    assert.doesNotMatch(source, /<\s*<\s*\(/u, `${installer} must work inside CageFS without /dev/fd`);
    assert.match(source, /tar -tzf "\$archive" \| while IFS= read -r entry/u);
  }
});

test("cPanel deployment scripts verify the active release and refresh stable Passenger configuration", async () => {
  for (const script of ["install-cpanel-release.sh", "rollback-cpanel-release.sh"]) {
    const source = await readFile(path.join(repositoryRoot, "deploy", "scripts", script), "utf8");
    assert.match(source, /MCAP_PASSENGER_CONFIG_FILE/u);
    assert.match(source, /mcap_release_probe/u);
    assert.match(source, /active_release_matches/u);
    assert.match(source, /touch -- "\$passenger_config_file"/u);
  }
});
