import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseDocument } from "yaml";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installers = ["install-release.sh", "install-cpanel-release.sh"];

test("GitHub Actions workflows are valid YAML without duplicate keys", async () => {
  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowFiles = (await readdir(workflowDirectory)).filter((file) => /\.ya?ml$/u.test(file));

  for (const workflowFile of workflowFiles) {
    const source = await readFile(path.join(workflowDirectory, workflowFile), "utf8");
    const document = parseDocument(source, { uniqueKeys: true });
    assert.deepEqual(document.errors, [], `${workflowFile} must parse without YAML errors`);
  }
});

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
  assert.match(switcher, /randomBytes\(48\)\.toString\("base64url"\)/u);
  assert.match(switcher, /environment\.RATE_LIMIT_IDENTITY_SECRET/u);
  assert.match(switcher, /validate_registered_environment "\$target_root" true/u);
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
  const identityVerificationIndex = source.indexOf("verify-database-identities.mjs");
  const seedIndex = source.indexOf("apps/api/dist/platform/seed-reference-data.js");
  const activationIndex = source.indexOf('atomic_link "$release_dir" "$current_link"');

  assert.match(source, /MCAP_RUN_DATABASE_MIGRATIONS/u);
  assert.match(source, /MIGRATION_DATABASE_URL/u);
  assert.match(source, /DATABASE_URL="\$migration_database_url"/u);
  assert.match(source, /PATH="\$\(dirname -- "\$node_bin"\):\$\{PATH:-\/usr\/bin:\/bin\}"/u);
  assert.ok(migrationIndex > 0, "candidate migrations must be present");
  assert.ok(identityVerificationIndex > 0, "database identities must be verified");
  assert.ok(migrationIndex > identityVerificationIndex, "identity verification must precede migrations");
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
  assert.match(source, /IFS= read -r migration_database_url/u);
  assert.match(source, /MCAP_METRICS_TOKEN_FILE="\$metrics_token_file"/u);
  assert.match(source, /SetEnv" && \$2 == "DATABASE_URL"/u);
  assert.match(source, /BACKUP_ENCRYPTION_PASSPHRASE="\$backup_passphrase"/u);
  assert.match(source, /DATABASE_URL="\$migration_database_url"/u);
  assert.match(source, /MIGRATION_DATABASE_URL="\$migration_database_url"/u);
  assert.match(source, /MCAP_RUN_DATABASE_MIGRATIONS=true/u);
  assert.doesNotMatch(source, /set -x/u);
  assert.ok(backupIndex > 0, "encrypted backup must be present");
  assert.ok(installerIndex > backupIndex, "backup must complete before installation");
});

test("CI deploys main only after all database and upgrade gates and uses pinned SSH identity", async () => {
  const source = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  const provenanceIndex = source.indexOf("Verify merged pull request provenance");
  const sshSecretIndex = source.indexOf("CPANEL_SSH_PRIVATE_KEY: ${{ secrets.CPANEL_SSH_PRIVATE_KEY }}");

  assert.match(
    source,
    /deploy-production:[\s\S]*needs: \[hosting-compatibility, migration-upgrade-compatibility, verify\]/u,
  );
  assert.match(source, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/u);
  assert.match(source, /pull-requests: read/u);
  assert.match(source, /pullRequest\.merge_commit_sha === sha/u);
  assert.match(source, /pullRequest\.base\?\.ref === "main"/u);
  assert.match(source, /event\.forced \|\| matches\.length !== 1/u);
  assert.match(source, /secrets\.CPANEL_SSH_PRIVATE_KEY/u);
  assert.match(source, /secrets\.BACKUP_ENCRYPTION_PASSPHRASE/u);
  assert.match(source, /secrets\.METRICS_BEARER_TOKEN/u);
  assert.match(source, /secrets\.MIGRATION_DATABASE_URL/u);
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
  assert.doesNotMatch(source, /group: production-database-operation/u);
  assert.match(source, /MCAP_PIPELINE_LOCK_WAIT_SECONDS=900/u);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(source, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/u);
  assert.match(source, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.match(source, /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/u);
  assert.match(
    source,
    /Create reproducible verified release[\s\S]*?Upload verified production release\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\s+uses: actions\/upload-artifact/u,
  );
  assert.match(source, /mariadb:10\.11\.11@sha256:96be0d3dfbeb07bc420e5fb8a6dc05c492676f1f89980a497a55e6fbbba3f1c4/u);
  assert.match(source, /mysql:8\.4\.11@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb/u);
  assert.ok(provenanceIndex > 0, "production provenance verification must be present");
  assert.ok(sshSecretIndex > provenanceIndex, "PR provenance must be verified before production secrets are read");
});

test("production runtime smoke test supplies every required security setting", async () => {
  const source = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");

  assert.match(
    source,
    /Smoke-test production runtime and graceful shutdown[\s\S]*?env:[\s\S]*?RATE_LIMIT_IDENTITY_SECRET: [^\r\n]{32,}[\s\S]*?run:/u,
  );
});

test("production metrics monitor protects the scrape and surfaces recent or synthetic alerts", async () => {
  const source = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "production-metrics-monitor.yml"),
    "utf8",
  );

  assert.match(source, /cron: '17 \* \* \* \*'/u);
  assert.match(source, /environment:\s+name: production/u);
  assert.match(source, /secrets\.METRICS_BEARER_TOKEN/u);
  assert.match(source, /actions: read/u);
  assert.match(source, /test "\$unauthenticated_status" = 401/u);
  assert.match(source, /mcap_operational_alert_active/u);
  assert.match(source, /mcap_operational_alert_last_fired_timestamp_seconds/u);
  assert.match(source, /Production monitoring test alert/u);
  assert.match(source, /mcap-production-database-backup/u);
  assert.match(source, /mcap-production-restore-drill/u);
  assert.match(source, /MAX_BACKUP_ARTIFACT_AGE_SECONDS: '91800'/u);
  assert.match(source, /MAX_RESTORE_DRILL_AGE_SECONDS: '3024000'/u);
  assert.match(source, /production-backup-dr\.yml\/runs/u);
  assert.match(source, /trustedRunIds/u);
  assert.match(source, /Production backup stale/u);
  assert.match(source, /Production restore drill stale/u);
});

test("production offsite backup helper keeps credentials on stdin and exports verified encrypted artifacts only", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "deploy", "scripts", "create-cpanel-offsite-backup.sh"),
    "utf8",
  );
  const normalizerSource = await readFile(
    path.join(repositoryRoot, "deploy", "scripts", "normalize-cpanel-backup.mjs"),
    "utf8",
  );

  assert.match(source, /set -Eeuo pipefail/u);
  assert.match(source, /umask 077/u);
  assert.match(source, /IFS= read -r backup_passphrase/u);
  assert.match(source, /IFS= read -r migration_database_url/u);
  assert.match(source, /unset backup_passphrase migration_database_url/u);
  assert.match(source, /scripts\/database-backup\.mjs/u);
  assert.match(source, /DATABASE_URL="\$migration_database_url"/u);
  assert.match(source, /verify-database-identities\.mjs/u);
  assert.match(source, /MCAP_PASSENGER_CONFIG_FILE/u);
  assert.match(source, /\.pipeline\.lock/u);
  assert.match(source, /flock -w "\$pipeline_lock_wait_seconds" 8/u);
  assert.match(source, /MCAP_PIPELINE_LOCK_WAIT_SECONDS/u);
  assert.match(source, /BACKUP_FILE_PREFIX=mcap-production/u);
  assert.match(source, /BACKUP_ENCRYPTION_PASSPHRASE="\$backup_passphrase"/u);
  assert.match(source, /sha256sum --binary/u);
  assert.match(normalizerSource, /schemaMigrationCount/u);
  assert.match(source, /"\$deploy_root"\/releases\/\*/u);
  assert.match(source, /"\$backup_directory"\/mcap-\*\.sql\.gz\.jwb/u);
  assert.match(source, /normalize-cpanel-backup\.mjs/u);
  assert.match(normalizerSource, /\["mcap-backup-v1", "mcap-backup-v2"\]/u);
  assert.match(normalizerSource, /targetFile = `mcap-production-/u);
  assert.match(normalizerSource, /startsWith\("mcap-production-"\)/u);
  assert.match(normalizerSource, /V2_FIELDS/u);
  assert.doesNotMatch(source, /set -x/u);
  assert.doesNotMatch(source, /printf[^\n]*(backup_passphrase|migration_database_url)/u);
});

test("scheduled production DR stores immutable offsite recovery points and restores them monthly", async () => {
  const source = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "production-backup-dr.yml"),
    "utf8",
  );
  const restoreSource = await readFile(path.join(repositoryRoot, "scripts", "database-restore.mjs"), "utf8");
  const restoreJobStart = source.indexOf("  restore_drill:");
  const restoreJobOutputs = source.indexOf("    outputs:", restoreJobStart);

  assert.match(source, /cron: '43 1 \* \* \*'/u);
  assert.match(source, /workflow_dispatch:/u);
  assert.match(source, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /Verify this is the current main revision/u);
  assert.match(source, /test "\$current_main" = "\$GITHUB_SHA"/u);
  assert.match(source, /persist-credentials: false/u);
  assert.match(source, /environment:\s+name: production/u);
  assert.doesNotMatch(source, /group: production-database-operation/u);
  assert.match(source, /MCAP_PIPELINE_LOCK_WAIT_SECONDS=900/u);
  assert.match(source, /actions: read/u);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(source, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/u);
  assert.match(source, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.match(source, /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/u);
  assert.match(source, /deploy\/ssh\/ifastnet_known_hosts/u);
  assert.match(source, /secrets\.CPANEL_SSH_PRIVATE_KEY/u);
  assert.match(source, /secrets\.BACKUP_ENCRYPTION_PASSPHRASE/u);
  assert.match(source, /secrets\.MIGRATION_DATABASE_URL/u);
  assert.match(source, /create-cpanel-offsite-backup\.sh/u);
  assert.match(source, /normalize-cpanel-backup\.mjs/u);
  assert.match(source, /verify-backup-artifact\.mjs/u);
  assert.match(source, /name: mcap-production-database-backup/u);
  assert.match(source, /retention-days: 90/u);
  assert.match(source, /compression-level: 0/u);
  assert.match(source, /LOCAL_BACKUP_RETENTION_DAYS: '7'/u);
  assert.match(source, /LOCAL_ORPHAN_GRACE_DAYS: '1'/u);
  assert.match(source, /Prune only offsite-backed local recovery points/u);
  assert.match(source, /mcap-production-\*\.sql\.gz\.jwb\.json/u);
  assert.doesNotMatch(source, /rm -rf/u);
  assert.match(source, /MAX_PREVIOUS_BACKUP_ARTIFACT_AGE_SECONDS: '91800'/u);
  assert.match(source, /production-backup-dr\.yml\/runs/u);
  assert.match(source, /trustedRunIds/u);
  assert.match(source, /image: mariadb:10\.11\.11@sha256:96be0d3dfbeb07bc420e5fb8a6dc05c492676f1f89980a497a55e6fbbba3f1c4/u);
  assert.match(source, /database-restore\.mjs/u);
  assert.match(source, /RTO_OBJECTIVE_SECONDS: '900'/u);
  assert.match(source, /name: mcap-production-restore-drill/u);
  assert.match(source, /name: mcap-production-restore-drill-failed/u);
  assert.match(source, /technicalRestoreExecutionSeconds/u);
  assert.ok(restoreJobStart > 0 && restoreJobOutputs > restoreJobStart);
  assert.doesNotMatch(source.slice(restoreJobStart, restoreJobOutputs), /BACKUP_ENCRYPTION_PASSPHRASE/u);
  assert.match(source, /dr-evidence\.json/u);
  assert.match(source, /recovery_objective_gate:/u);
  assert.match(source, /overwrite: \$\{\{ github\.run_attempt > 1 \}\}/u);
  assert.match(source, /steps\.evidence\.outputs\.status == 'passed'/u);
  assert.match(source, /failed_recovery_point_objective/u);
  assert.doesNotMatch(restoreSource, /dotenv\/config/u);
  assert.match(restoreSource, /loadEnvFile/u);
  assert.doesNotMatch(source, /echo[^\n]*(BACKUP_ENCRYPTION_PASSPHRASE|MIGRATION_DATABASE_URL)/u);
});
