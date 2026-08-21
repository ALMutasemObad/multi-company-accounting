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

test("cPanel installer migrates and seeds the candidate before activating it", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "deploy", "scripts", "install-cpanel-release.sh"),
    "utf8",
  );
  const migrationIndex = source.indexOf("prisma@7.9.1 migrate deploy");
  const seedIndex = source.indexOf("apps/api/dist/platform/seed-reference-data.js");
  const activationIndex = source.indexOf('atomic_link "$release_dir" "$current_link"');

  assert.match(source, /MCAP_RUN_DATABASE_MIGRATIONS/u);
  assert.match(source, /PATH="\$\(dirname -- "\$node_bin"\):\$\{PATH:-\/usr\/bin:\/bin\}"/u);
  assert.ok(migrationIndex > 0, "candidate migrations must be present");
  assert.ok(seedIndex > migrationIndex, "reference data must follow migrations");
  assert.ok(activationIndex > seedIndex, "activation must happen after migrations and reference data");
});

test("cPanel production pipeline backs up before invoking the atomic installer", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "deploy", "scripts", "deploy-cpanel-release.sh"),
    "utf8",
  );
  const backupIndex = source.indexOf("scripts/database-backup.mjs");
  const installerIndex = source.indexOf("install-cpanel-release.sh");

  assert.match(source, /IFS= read -r backup_passphrase/u);
  assert.match(source, /SetEnv" && \$2 == "DATABASE_URL"/u);
  assert.match(source, /BACKUP_ENCRYPTION_PASSPHRASE="\$backup_passphrase"/u);
  assert.match(source, /MCAP_RUN_DATABASE_MIGRATIONS=true/u);
  assert.doesNotMatch(source, /set -x/u);
  assert.ok(backupIndex > 0, "encrypted backup must be present");
  assert.ok(installerIndex > backupIndex, "backup must complete before installation");
});

test("CI deploys main only after both database gates and uses pinned SSH identity", async () => {
  const source = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");

  assert.match(source, /deploy-production:[\s\S]*needs: \[hosting-compatibility, verify\]/u);
  assert.match(source, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /secrets\.CPANEL_SSH_PRIVATE_KEY/u);
  assert.match(source, /secrets\.BACKUP_ENCRYPTION_PASSPHRASE/u);
  assert.match(source, /deploy\/ssh\/ifastnet_known_hosts/u);
  assert.match(source, /sha256sum --check mcap-finance-linux-x64\.tgz\.sha256/u);
  assert.match(source, /SELF_REGISTRATION_ENABLED: 'false'/u);
  assert.match(source, /PASSWORD_RESET_ENABLED: 'false'/u);
});
