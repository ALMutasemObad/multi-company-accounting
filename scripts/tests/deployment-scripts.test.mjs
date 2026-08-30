import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseDocument } from "yaml";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installers = ["install-release.sh", "install-cpanel-release.sh"];
const approvedActionPins = new Map([
  ["actions/checkout", { sha: "3d3c42e5aac5ba805825da76410c181273ba90b1", version: "v7.0.1" }],
  ["actions/setup-node", { sha: "820762786026740c76f36085b0efc47a31fe5020", version: "v7.0.0" }],
  ["actions/upload-artifact", { sha: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", version: "v7.0.1" }],
  ["actions/download-artifact", { sha: "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", version: "v8.0.1" }],
]);

test("GitHub Actions workflows are valid YAML without duplicate keys", async () => {
  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowFiles = (await readdir(workflowDirectory)).filter((file) => /\.ya?ml$/u.test(file));

  for (const workflowFile of workflowFiles) {
    const source = await readFile(path.join(workflowDirectory, workflowFile), "utf8");
    const document = parseDocument(source, { uniqueKeys: true });
    assert.deepEqual(document.errors, [], `${workflowFile} must parse without YAML errors`);
  }
});

test("every external GitHub Action uses the approved immutable Node 24 pin", async () => {
  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowFiles = (await readdir(workflowDirectory)).filter((file) => /\.ya?ml$/u.test(file));
  const observedActions = new Set();

  for (const workflowFile of workflowFiles) {
    const source = await readFile(path.join(workflowDirectory, workflowFile), "utf8");
    for (const match of source.matchAll(/^\s*-?\s*uses:\s+([^\s#]+)(?:\s+#\s*(\S+))?/gmu)) {
      const reference = match[1];
      const separator = reference.lastIndexOf("@");
      assert.ok(separator > 0, `${workflowFile} contains an unpinned action: ${reference}`);
      const name = reference.slice(0, separator);
      const sha = reference.slice(separator + 1);
      const approved = approvedActionPins.get(name);
      assert.ok(approved, `${workflowFile} contains an unapproved external action: ${name}`);
      assert.equal(sha, approved.sha, `${workflowFile} must use the approved ${name} commit`);
      assert.equal(match[2], approved.version, `${workflowFile} must document the pinned ${name} release`);
      observedActions.add(name);
    }
  }

  assert.deepEqual(observedActions, new Set(approvedActionPins.keys()));
});

test("dependency security monitoring runs daily from main without secrets or artifacts", async () => {
  const source = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "dependency-security-monitor.yml"),
    "utf8",
  );
  const installIndex = source.indexOf("npm ci");
  const scriptsIndex = source.indexOf("npm run audit:install-scripts");
  const buildAuditIndex = source.indexOf("npm run audit:critical");
  const pruneIndex = source.indexOf("npm prune --omit=dev --omit=optional");
  const productionAuditIndex = source.indexOf("npm run audit:production");

  assert.match(source, /schedule:\s+- cron: '37 3 \* \* \*'/u);
  assert.match(source, /workflow_dispatch:/u);
  assert.match(source, /permissions:\s+contents: read/u);
  assert.match(source, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /timeout-minutes: 15/u);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\./u);
  assert.doesNotMatch(source, /upload-artifact|download-artifact/u);
  assert.ok(installIndex > 0, "the locked dependency graph must be installed");
  assert.ok(scriptsIndex > installIndex, "install-script policy must follow npm ci");
  assert.ok(buildAuditIndex > scriptsIndex, "the complete graph must be audited before pruning");
  assert.ok(pruneIndex > buildAuditIndex, "build dependencies must be pruned after their audit");
  assert.ok(productionAuditIndex > pruneIndex, "the pruned production graph must be audited last");
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

test("CI deploys only staging from current main after all database and upgrade gates", async () => {
  const source = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  const provenanceIndex = source.indexOf("Verify merged pull request provenance for staging");
  const rebuildIndex = source.indexOf("Rebuild the verified staging release from the selected revision");
  const sshSecretIndex = source.indexOf("CPANEL_SSH_PRIVATE_KEY: ${{ secrets.CPANEL_SSH_PRIVATE_KEY }}");
  const preflightIndex = source.indexOf("Preflight the Staging database and operator identity read-only");
  const uploadIndex = source.indexOf("Upload the immutable staging artifact");
  const activationIndex = source.indexOf("Back up, migrate, and activate staging atomically");

  assert.match(
    source,
    /deploy-staging:[\s\S]*needs: \[hosting-compatibility, migration-upgrade-compatibility, verify\]/u,
  );
  assert.match(source, /on:\s+push:\s+branches: \[main\]\s+pull_request:\s+workflow_dispatch:/u);
  assert.match(source, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /Verify a manual staging deployment uses the current main revision/u);
  assert.match(source, /test "\$current_main" = "\$GITHUB_SHA"/u);
  assert.match(source, /environment:\s+# Legacy secret scope only[\s\S]*name: production/u);
  assert.doesNotMatch(source, /deploy-production:/u);
  assert.doesNotMatch(source, /name: Deploy production/u);
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
  assert.match(source, /SELF_REGISTRATION_ENABLED: 'false'/u);
  assert.match(source, /mcap_https_redirect_probe/u);
  assert.match(source, /redirect_status/u);
  assert.match(source, /redirect_location/u);
  assert.match(source, /test "\$metrics_status" = 401/u);
  assert.match(source, /mcap_operational_alert_active/u);
  assert.doesNotMatch(source, /group: production-database-operation/u);
  assert.match(source, /MCAP_PIPELINE_LOCK_WAIT_SECONDS=900/u);
  assert.match(source, /release_archive_sha256: \$\{\{ steps\.release\.outputs\.archive_sha256 \}\}/u);
  assert.match(source, /release_manifest_sha256: \$\{\{ steps\.release\.outputs\.manifest_sha256 \}\}/u);
  assert.match(source, /VERIFIED_ARCHIVE_SHA256: \$\{\{ needs\.verify\.outputs\.release_archive_sha256 \}\}/u);
  assert.match(source, /VERIFIED_MANIFEST_SHA256: \$\{\{ needs\.verify\.outputs\.release_manifest_sha256 \}\}/u);
  assert.match(
    source,
    /Rebuild the verified staging release from the selected revision[\s\S]*DATABASE_URL: mysql:\/\/release_build:release_build@127\.0\.0\.1:3306\/release_build[\s\S]*npm run prisma:generate/u,
  );
  assert.match(source, /test "\$\{#VERIFIED_ARCHIVE_SHA256\}" -eq 64/u);
  assert.match(source, /test "\$\{#VERIFIED_MANIFEST_SHA256\}" -eq 64/u);
  assert.doesNotMatch(source, /Upload verified production release/u);
  assert.doesNotMatch(source, /actions\/download-artifact/u);
  assert.match(source, /mariadb:10\.11\.11@sha256:96be0d3dfbeb07bc420e5fb8a6dc05c492676f1f89980a497a55e6fbbba3f1c4/u);
  assert.match(source, /mysql:8\.4\.11@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb/u);
  assert.ok(provenanceIndex > 0, "staging provenance verification must be present");
  assert.ok(rebuildIndex > provenanceIndex, "the release must be rebuilt only after merge provenance is verified");
  assert.ok(sshSecretIndex > rebuildIndex, "release reproduction must complete before staging secrets are read");
  assert.ok(sshSecretIndex > provenanceIndex, "PR provenance must be verified before staging secrets are read");
  assert.ok(preflightIndex > sshSecretIndex, "the remote preflight must run only after the pinned SSH identity is configured");
  assert.ok(uploadIndex > preflightIndex, "the read-only identity preflight must precede remote artifact creation");
  assert.ok(activationIndex > uploadIndex, "migration and activation must remain after the immutable artifact upload");
  assert.match(source, /Preflight the Staging database and operator identity read-only[\s\S]*MIGRATION_DATABASE_URL: \$\{\{ secrets\.MIGRATION_DATABASE_URL \}\}/u);
  assert.match(source, /retiredDatabaseBrand = new RegExp\(\["j", "\[aeiou\]", "wa\{1,2\}r"\]/u);
  assert.match(source, /decodeURIComponent\(parsed\.pathname\)/u);
  assert.match(source, /PLATFORM_OPERATOR_EMAILS\.trim\(\)\.length > 0/u);
  assert.match(source, /spawnSync\([\s\S]*\["get", "--json", "--interpreter", "nodejs", "--user", user\]/u);
  assert.match(source, /without revealing (?:its value|values)/u);
  const preflightSource = source.slice(preflightIndex, uploadIndex);
  assert.doesNotMatch(preflightSource, /console\.log\([^\n]*(?:MIGRATION_DATABASE_URL|DATABASE_URL|PLATFORM_OPERATOR_EMAILS)/u);
  assert.doesNotMatch(preflightSource, /(?:echo|printf)[^\n]*(?:MIGRATION_DATABASE_URL|DATABASE_URL|PLATFORM_OPERATOR_EMAILS)/u);
});

test("legacy recovery workflows are manual Staging operations pinned to current main", async () => {
  const workflowSignatures = new Map([
    ["production-cloudlinux-recreate.yml", /"\$selector" create --json --interpreter nodejs/u],
    ["production-cloudlinux-root-recovery.yml", /Synchronize the registered application root and restart/u],
    ["production-passenger-loader-recovery.yml", /Install protected startup loader and force a fresh app group/u],
    ["production-passenger-recovery.yml", /Install a protected Node environment wrapper/u],
  ]);

  for (const [workflowFile, operationalSignature] of workflowSignatures) {
    const source = await readFile(path.join(repositoryRoot, ".github", "workflows", workflowFile), "utf8");
    const currentMainIndex = source.indexOf("Verify this manual Staging recovery uses current main");
    const secretIndex = source.indexOf("CPANEL_SSH_PRIVATE_KEY: ${{ secrets.CPANEL_SSH_PRIVATE_KEY }}");
    const lockIndex = source.indexOf('pipeline_lock="$deploy_root/.pipeline.lock"');
    const stateIndexes = [source.indexOf("current_release=$(readlink"), source.indexOf("old_current=$(readlink")]
      .filter((index) => index >= 0);
    const stateIndex = Math.min(...stateIndexes);

    assert.match(source, /^name: Staging .+ \(manual\)$/mu);
    assert.match(source, /on:\s+workflow_dispatch:/u);
    assert.doesNotMatch(source, /(?:^|\n)\s*push:/u);
    assert.doesNotMatch(source, /ops\//u);
    assert.match(source, /if: github\.ref == 'refs\/heads\/main'/u);
    assert.match(source, /ref: \$\{\{ github\.sha \}\}/u);
    assert.match(source, /persist-credentials: false/u);
    assert.match(source, /current_main=\$\(gh api "\/repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/u);
    assert.match(source, /test "\$current_main" = "\$GITHUB_SHA"/u);
    assert.match(source, /environment:\s+# Legacy secret scope only; the remote target is classified as Staging\.[\s\S]*name: production/u);
    assert.doesNotMatch(source, /environment:\s+name: staging/u);
    assert.match(source, operationalSignature);
    assert.match(source, /pipeline_lock="\$deploy_root\/\.pipeline\.lock"/u);
    assert.match(source, /set -o noclobber/u);
    assert.match(source, /flock -w 60 8/u);
    assert.ok(lockIndex > secretIndex, `${workflowFile} must take the remote lock after configuring SSH`);
    assert.ok(Number.isFinite(stateIndex) && stateIndex > lockIndex, `${workflowFile} must lock before reading mutable release state`);
    assert.ok(currentMainIndex > 0, `${workflowFile} must verify current main before reading secrets`);
    assert.ok(secretIndex > currentMainIndex, `${workflowFile} must not read the SSH secret before current-main verification`);
  }
});

test("manual Staging operator migration is current-main-only, recoverable, and value-redacted", async () => {
  const [workflow, migration, switcher, recreate, operations] = await Promise.all([
    readFile(path.join(repositoryRoot, ".github", "workflows", "staging-platform-operator-id-migration.yml"), "utf8"),
    readFile(path.join(repositoryRoot, "deploy", "scripts", "migrate-staging-platform-operator-ids.sh"), "utf8"),
    readFile(path.join(repositoryRoot, "deploy", "scripts", "switch-cloudlinux-registration.sh"), "utf8"),
    readFile(path.join(repositoryRoot, ".github", "workflows", "production-cloudlinux-recreate.yml"), "utf8"),
    readFile(path.join(repositoryRoot, "docs", "production-operations.md"), "utf8"),
  ]);

  const currentMainIndex = workflow.indexOf("Verify this manual Staging migration uses current main");
  const sshSecretIndex = workflow.indexOf("CPANEL_SSH_PRIVATE_KEY: ${{ secrets.CPANEL_SSH_PRIVATE_KEY }}");
  const migrationSecretIndex = workflow.indexOf("MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}");

  assert.match(workflow, /^name: Staging platform operator ID migration \(manual\)$/mu);
  assert.match(workflow, /on:\s+workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /(?:^|\n)\s*(?:push|pull_request|schedule):/u);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /current_main=\$\(gh api "\/repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/u);
  assert.match(workflow, /test "\$current_main" = "\$GITHUB_SHA"/u);
  assert.match(workflow, /deploy\/ssh\/ifastnet_known_hosts/u);
  assert.match(workflow, /StrictHostKeyChecking=yes/u);
  assert.match(workflow, /\\u0000-\\u001f\\u007f/u);
  assert.match(workflow, /base64 --wrap=0/u);
  assert.match(workflow, /base64 --decode > "\$secret_file"/u);
  assert.match(workflow, /unset MIGRATION_DATABASE_URL/u);
  assert.match(workflow, /bash -s -- "\$secret_file"/u);
  assert.doesNotMatch(workflow, /printf '%s\\n' "\$MIGRATION_DATABASE_URL"/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /timeout-minutes: 45/u);
  assert.match(workflow, /Legacy secret scope only; the remote target is classified as Staging/u);
  assert.ok(currentMainIndex > 0, "current main must be verified");
  assert.ok(sshSecretIndex > currentMainIndex, "SSH secrets must be read only after current-main verification");
  assert.ok(migrationSecretIndex > sshSecretIndex, "the database target must be read only in the migration step");

  assert.match(migration, /^set -Eeuo pipefail$/mu);
  assert.match(migration, /^umask 077$/mu);
  assert.match(migration, /\.pipeline\.lock/u);
  assert.match(migration, /flock -w "\$pipeline_lock_wait_seconds"/u);
  assert.match(migration, /timeout --kill-after=10s 60s "\$selector"/u);
  assert.match(migration, /platform-operator-registry-before-/u);
  assert.match(migration, /platform-operator-htaccess-before-/u);
  assert.match(migration, /platform-operator-env-before-/u);
  assert.match(migration, /chmod 0600 -- "\$registry_backup" "\$passenger_backup"/u);
  assert.match(migration, /emailNormalized: \{ in: emails \}/u);
  assert.match(migration, /select: \{ id: true, emailNormalized: true, isActive: true \}/u);
  assert.match(migration, /MAX_OPERATOR_COUNT = 64/u);
  assert.match(migration, /MAX_UNSIGNED_BIGINT/u);
  assert.match(migration, /readBounded\(migrationDatabaseUrlPath, MAX_DATABASE_URL_BYTES\)/u);
  assert.doesNotMatch(migration, /process\.env\.MCAP_MIGRATION_DATABASE_URL/u);
  assert.match(migration, /retiredDatabaseBrand/u);
  assert.match(migration, /email sources differ/u);
  assert.match(migration, /database sources differ/u);
  assert.match(migration, /existingIdSources\.length === sources\.length \? "noop" : "migrate"/u);
  assert.match(migration, /configuredIds\.length !== sources\.length/u);
  assert.match(migration, /verify-release\.mjs" --root "\$current_release"/u);
  assert.match(migration, /the Passenger configuration owner is invalid/u);
  assert.match(migration, /the shared pipeline lock owner is invalid/u);
  assert.match(migration, /--app-root "\$app_root" --env-vars "\$candidate_environment"/u);
  assert.match(migration, /verify_registry_environment "\$candidate_environment_json"/u);
  assert.match(migration, /mv -f -- "\$environment_candidate" "\$environment_file"/u);
  assert.match(migration, /mv -f -- "\$passenger_candidate" "\$passenger_config_file"/u);
  assert.match(migration, /rollback_configuration/u);
  assert.match(migration, /verify_registry_environment "\$original_environment_json"/u);
  assert.match(migration, /"\$selector" restart --json/u);
  assert.match(migration, /probe_health 15/u);
  assert.match(migration, /probe_health 30/u);
  assert.match(migration, /verify_preflight/u);
  assert.match(migration, /\[\[ "\$action" == noop \]\]/u);
  assert.doesNotMatch(migration, /set -x/u);
  assert.doesNotMatch(migration, /(?:echo|printf|console\.log)\s*[^\n]*(?:PLATFORM_OPERATOR_EMAILS|PLATFORM_OPERATOR_USER_IDS|DATABASE_URL)/u);
  const ci = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.equal(ci.match(/deploy\/scripts\/migrate-staging-platform-operator-ids\.sh/gmu)?.length, 2);

  assert.match(switcher, /legacyOperatorEmails = environment\.PLATFORM_OPERATOR_EMAILS/u);
  assert.match(switcher, /delete environment\.PLATFORM_OPERATOR_EMAILS/u);
  assert.match(recreate, /registry backup contains the retired platform operator email allowlist/u);
  assert.match(recreate, /delete environment\.PLATFORM_OPERATOR_EMAILS/u);
  assert.match(operations, /Staging platform operator ID migration \(manual\)/u);
  assert.match(operations, /platform-operator-registry-before-/u);
});

test("release packaging is shared by verification and deployment and emits only immutable digests", async () => {
  const workflow = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  const packager = await readFile(
    path.join(repositoryRoot, "scripts", "release", "package-release.sh"),
    "utf8",
  );

  assert.equal(workflow.match(/bash scripts\/release\/package-release\.sh/gmu)?.length, 2);
  assert.match(packager, /set -Eeuo pipefail/u);
  assert.match(packager, /SOURCE_DATE_EPOCH/u);
  assert.match(packager, /tar --sort=name/u);
  assert.match(packager, /gzip -n -9/u);
  assert.match(packager, /verify-release\.mjs/u);
  assert.match(packager, /sha256sum --check/u);
  assert.match(packager, /archive_sha256=%s\\nmanifest_sha256=%s/u);
  assert.doesNotMatch(packager, /rm\s+-rf/u);
});

test("production runtime smoke test supplies every required security setting", async () => {
  const source = await readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");

  assert.match(
    source,
    /Smoke-test production runtime and graceful shutdown[\s\S]*?env:[\s\S]*?RATE_LIMIT_IDENTITY_SECRET: [^\r\n]{32,}[\s\S]*?run:/u,
  );
});

test("staging metrics monitor is manual and protects the scrape and evidence checks", async () => {
  const source = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "production-metrics-monitor.yml"),
    "utf8",
  );

  assert.doesNotMatch(source, /schedule:|cron:/u);
  assert.match(source, /workflow_dispatch:/u);
  assert.match(source, /environment:\s+# Legacy secret scope only[\s\S]*name: production/u);
  assert.match(source, /secrets\.METRICS_BEARER_TOKEN/u);
  assert.match(source, /actions: read/u);
  assert.match(source, /test "\$unauthenticated_status" = 401/u);
  assert.match(source, /mcap_operational_alert_active/u);
  assert.match(source, /mcap_operational_alert_last_fired_timestamp_seconds/u);
  assert.match(source, /Staging monitoring test alert/u);
  assert.match(source, /mcap-production-database-backup/u);
  assert.match(source, /mcap-production-restore-drill/u);
  assert.match(source, /MAX_BACKUP_ARTIFACT_AGE_SECONDS: '91800'/u);
  assert.match(source, /MAX_RESTORE_DRILL_AGE_SECONDS: '3024000'/u);
  assert.match(source, /production-backup-dr\.yml\/runs/u);
  assert.match(source, /trustedRunIds/u);
  assert.match(source, /Staging backup stale/u);
  assert.match(source, /Staging restore drill stale/u);
});

test("staging workflows keep the temporary environment-scoped secret boundary explicit", async () => {
  const [ci, monitor, backup, operations, resilience, hosting] = await Promise.all([
    readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8"),
    readFile(path.join(repositoryRoot, ".github", "workflows", "production-metrics-monitor.yml"), "utf8"),
    readFile(path.join(repositoryRoot, ".github", "workflows", "production-backup-dr.yml"), "utf8"),
    readFile(path.join(repositoryRoot, "docs", "production-operations.md"), "utf8"),
    readFile(path.join(repositoryRoot, "docs", "operational-resilience.md"), "utf8"),
    readFile(path.join(repositoryRoot, "docs", "ifastnet-cpanel-deployment.md"), "utf8"),
  ]);

  for (const workflow of [ci, monitor, backup]) {
    assert.match(workflow, /Legacy secret scope only/u);
    assert.doesNotMatch(workflow, /environment:\s+name: staging/u);
  }
  assert.doesNotMatch(ci, /deploy-production:|name: Deploy production/u);
  assert.match(operations, /GitHub Environment ذات الاسم القديم `production` \*\*كنطاق أسرار إرثي فقط\*\*/u);
  assert.match(operations, /حُذفت نسخها على مستوى Repository/u);
  assert.match(operations, /خطة إزالة الاسم الإرثي/u);
  assert.match(resilience, /Environment ذات الاسم الإرثي `production`/u);
  assert.match(hosting, /اسم GitHub Environment القديم `production` كنطاق للأسرار الموجودة/u);
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

test("manual staging DR stores immutable offsite recovery points and can run a restore drill", async () => {
  const source = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "production-backup-dr.yml"),
    "utf8",
  );
  const restoreSource = await readFile(path.join(repositoryRoot, "scripts", "database-restore.mjs"), "utf8");
  const restoreJobStart = source.indexOf("  restore_drill:");
  const restoreJobOutputs = source.indexOf("    outputs:", restoreJobStart);

  assert.doesNotMatch(source, /schedule:|cron:/u);
  assert.match(source, /workflow_dispatch:/u);
  assert.match(source, /if: github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /Verify this is the current main revision/u);
  assert.match(source, /test "\$current_main" = "\$GITHUB_SHA"/u);
  assert.match(source, /persist-credentials: false/u);
  assert.match(source, /environment:\s+# Legacy secret scope only[\s\S]*name: production/u);
  assert.doesNotMatch(source, /group: production-database-operation/u);
  assert.match(source, /MCAP_PIPELINE_LOCK_WAIT_SECONDS=900/u);
  assert.match(source, /actions: read/u);
  assert.match(source, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
  assert.match(source, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(source, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u);
  assert.match(source, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/u);
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
  assert.match(source, /steps\.evidence\.outputs\.status == 'passed_with_recovery_gap'/u);
  assert.doesNotMatch(source, /failed_recovery_point_objective/u);
  assert.match(source, /::warning title=Staging recovery gap/u);
  assert.doesNotMatch(
    source,
    /if \[\[ "\$PREVIOUS_STALE" == true \]\]; then\s+printf[^\n]+\n\s+failed=true/u,
  );
  assert.doesNotMatch(restoreSource, /dotenv\/config/u);
  assert.match(restoreSource, /loadEnvFile/u);
  assert.doesNotMatch(source, /echo[^\n]*(BACKUP_ENCRYPTION_PASSPHRASE|MIGRATION_DATABASE_URL)/u);
});
