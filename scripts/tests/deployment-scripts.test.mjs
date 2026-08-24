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

test("CloudLinux registration switching recreates immutable release roots and restores the source on failure", async () => {
  const switcher = await readFile(
    path.join(repositoryRoot, "deploy", "scripts", "switch-cloudlinux-registration.sh"),
    "utf8",
  );
  const installer = await readFile(
    path.join(repositoryRoot, "deploy", "scripts", "install-cpanel-release.sh"),
    "utf8",
  );

  assert.match(switcher, /selector-before-/u);
  assert.match(switcher, /write_environment_snapshot/u);
  assert.match(switcher, /destroy_registration "\$source_root"/u);
  assert.match(switcher, /create_registration "\$target_root"/u);
  assert.match(switcher, /restore_source_registration/u);
  assert.match(switcher, /ensure_https_redirect/u);
  assert.match(switcher, /# BEGIN MCAP HTTPS REDIRECT/u);
  assert.match(switcher, /sourceText\.indexOf\(start\) > sourceText\.indexOf\(end\)/u);
  assert.match(switcher, /RewriteCond %\{HTTPS\} !=on/u);
  assert.match(switcher, /RewriteCond %\{HTTP:X-Forwarded-Proto\} !\^https\$/u);
  assert.match(switcher, /RewriteRule \^ https:\/\/\$\{domain\}%\{REQUEST_URI\} \[R=308,L,NE\]/u);
  assert.doesNotMatch(switcher, /https:\/\/%\{HTTP_HOST\}/u);
  assert.match(switcher, /restore_passenger_config/u);
  assert.match(switcher, /chmod "\$config_mode"/u);
  assert.doesNotMatch(switcher, /printf[^\n]*environment_json/u);
  assert.match(installer, /MCAP_CLOUDLINUX_SWITCHER/u);
  assert.match(installer, /activate_release "\$old_release" "\$release_dir"/u);
  assert.match(installer, /activate_release "\$release_dir" "\$old_release"/u);
  assert.match(installer, /https_redirect_matches/u);
  assert.match(installer, /mcap_https_redirect_probe/u);
  assert.match(installer, /case "\$status" in 301\|308/u);
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
  assert.match(source, /IFS= read -r metrics_bearer_token/u);
  assert.match(source, /MCAP_METRICS_TOKEN_FILE="\$metrics_token_file"/u);
  assert.match(source, /SetEnv" && \$2 == "DATABASE_URL"/u);
  assert.match(source, /BACKUP_ENCRYPTION_PASSPHRASE="\$backup_passphrase"/u);
  assert.match(source, /MCAP_RUN_DATABASE_MIGRATIONS=true/u);
  assert.doesNotMatch(source, /set -x/u);
  assert.ok(backupIndex > 0, "encrypted backup must be present");
  assert.ok(installerIndex > backupIndex, "backup must complete before installation");
});

test("CI deploys main only after both database gates and uses pinned SSH identity", async () => {
  const source = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  const provenanceIndex = source.indexOf("Verify merged pull request provenance");
  const sshSecretIndex = source.indexOf("CPANEL_SSH_PRIVATE_KEY: ${{ secrets.CPANEL_SSH_PRIVATE_KEY }}");

  assert.match(source, /deploy-production:[\s\S]*needs: \[hosting-compatibility, verify\]/u);
  assert.match(source, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /pull-requests: read/u);
  assert.match(source, /pullRequest\.merge_commit_sha === sha/u);
  assert.match(source, /pullRequest\.base\?\.ref === "main"/u);
  assert.match(source, /event\.forced \|\| matches\.length !== 1/u);
  assert.match(source, /secrets\.CPANEL_SSH_PRIVATE_KEY/u);
  assert.match(source, /secrets\.BACKUP_ENCRYPTION_PASSPHRASE/u);
  assert.match(source, /secrets\.METRICS_BEARER_TOKEN/u);
  assert.match(source, /deploy\/ssh\/ifastnet_known_hosts/u);
  assert.match(source, /switch-cloudlinux-registration\.sh/u);
  assert.match(source, /MCAP_CLOUDLINUX_SELECTOR=\/usr\/sbin\/cloudlinux-selector/u);
  assert.match(source, /cloudlinux-registration\.integration\.sh/u);
  assert.match(source, /sha256sum --check mcap-finance-linux-x64\.tgz\.sha256/u);
  assert.match(source, /SELF_REGISTRATION_ENABLED: 'false'/u);
  assert.match(source, /mcap_https_redirect_probe/u);
  assert.match(source, /redirect_status/u);
  assert.match(source, /redirect_location/u);
  assert.match(source, /test "\$metrics_status" = 401/u);
  assert.match(source, /mcap_operational_alert_active/u);
  assert.ok(provenanceIndex > 0, "production provenance verification must be present");
  assert.ok(sshSecretIndex > provenanceIndex, "PR provenance must be verified before production secrets are read");
});

test("production metrics monitor protects the scrape and surfaces recent or synthetic alerts", async () => {
  const source = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "production-metrics-monitor.yml"),
    "utf8",
  );

  assert.match(source, /cron: '17 \* \* \* \*'/u);
  assert.match(source, /environment:\s+name: production/u);
  assert.match(source, /secrets\.METRICS_BEARER_TOKEN/u);
  assert.match(source, /test "\$unauthenticated_status" = 401/u);
  assert.match(source, /mcap_operational_alert_active/u);
  assert.match(source, /mcap_operational_alert_last_fired_timestamp_seconds/u);
  assert.match(source, /Production monitoring test alert/u);
});
