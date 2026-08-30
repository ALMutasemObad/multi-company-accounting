#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() {
  printf 'mcap-staging-operator-migration: %s\n' "$1" >&2
  exit 1
}

log() {
  printf 'mcap-staging-operator-migration: %s\n' "$1"
}

deploy_root=${MCAP_DEPLOY_ROOT:-}
passenger_config_file=${MCAP_PASSENGER_CONFIG_FILE:-}
node_bin=${MCAP_NODE_BIN:-/opt/alt/alt-nodejs22/root/usr/bin/node}
selector=${MCAP_CLOUDLINUX_SELECTOR:-/usr/sbin/cloudlinux-selector}
cloudlinux_user=${MCAP_CLOUDLINUX_USER:-}
cloudlinux_domain=${MCAP_CLOUDLINUX_DOMAIN:-}
cloudlinux_version=${MCAP_CLOUDLINUX_VERSION:-22.23.2}
backup_directory=${MCAP_CLOUDLINUX_BACKUP_DIRECTORY:-}
live_url=${MCAP_LIVE_URL:-}
ready_url=${MCAP_READY_URL:-}
pipeline_lock_wait_seconds=${MCAP_PIPELINE_LOCK_WAIT_SECONDS:-900}
migration_database_url_file=${1:-}

[[ "$deploy_root" == /* && "$deploy_root" != / ]] || fail "the deployment root is invalid"
[[ "$passenger_config_file" == /* && "$passenger_config_file" != / ]] \
  || fail "the Passenger configuration path is invalid"
[[ "$backup_directory" == /* && "$backup_directory" != / ]] || fail "the recovery backup path is invalid"
[[ "$cloudlinux_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "the CloudLinux user is invalid"
[[ "$cloudlinux_domain" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || fail "the CloudLinux domain is invalid"
[[ "$cloudlinux_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "the CloudLinux version is invalid"
[[ "$pipeline_lock_wait_seconds" =~ ^[1-9][0-9]{0,3}$ ]] \
  && (( pipeline_lock_wait_seconds <= 1800 )) \
  || fail "the pipeline lock wait is invalid"
[[ "$live_url" == https://* && ${#live_url} -le 2048 && ! "$live_url" =~ [[:cntrl:]] ]] \
  || fail "the live probe target is invalid"
[[ "$ready_url" == https://* && ${#ready_url} -le 2048 && ! "$ready_url" =~ [[:cntrl:]] ]] \
  || fail "the readiness probe target is invalid"
[[ "$migration_database_url_file" == /tmp/mcap-staging-migration-target.* \
   && -f "$migration_database_url_file" && ! -L "$migration_database_url_file" \
   && "$(stat -c '%a' -- "$migration_database_url_file")" == 600 \
   && "$(stat -c '%U' -- "$migration_database_url_file")" == "$cloudlinux_user" \
   && $(stat -c '%s' -- "$migration_database_url_file") -ge 1 \
   && $(stat -c '%s' -- "$migration_database_url_file") -le 2048 ]] \
  || fail "the protected migration database target file is invalid"
[[ "$node_bin" == /opt/alt/alt-nodejs22/root/usr/bin/node \
   && "$selector" == /usr/sbin/cloudlinux-selector ]] \
  || fail "a required Staging executable path is unexpected"
node_resolved=$(readlink -f -- "$node_bin") || fail "the Staging Node executable cannot be resolved"
selector_resolved=$(readlink -f -- "$selector") || fail "the CloudLinux Selector cannot be resolved"
case "$node_resolved" in /opt/alt/alt-nodejs22/*) ;; *) fail "the Staging Node target is outside its trusted root" ;; esac
case "$selector_resolved" in /usr/*) ;; *) fail "the CloudLinux Selector target is outside its trusted root" ;; esac
for executable in "$node_resolved" "$selector_resolved"; do
  [[ -f "$executable" && ! -L "$executable" && -x "$executable" \
     && "$(stat -c '%U' -- "$executable")" == root ]] \
    || fail "a required Staging executable target is unavailable"
  executable_mode=$(stat -c '%a' -- "$executable")
  [[ "$executable_mode" =~ ^[0-7]{3,4}$ ]] \
    && (( (8#$executable_mode & 022) == 0 )) \
    || fail "a required Staging executable target is writable by an untrusted principal"
done
unset executable executable_mode
[[ "$(id -un)" == "$cloudlinux_user" ]] || fail "the remote Staging user is unexpected"
[[ -d "$deploy_root" && ! -L "$deploy_root" && "$(readlink -f -- "$deploy_root")" == "$deploy_root" ]] \
  || fail "the deployment root is unsafe"
[[ -f "$passenger_config_file" && ! -L "$passenger_config_file" \
   && "$(readlink -f -- "$passenger_config_file")" == "$passenger_config_file" ]] \
  || fail "the Passenger configuration is unsafe"
[[ "$(stat -c '%U' -- "$passenger_config_file")" == "$cloudlinux_user" ]] \
  || fail "the Passenger configuration owner is invalid"
[[ -d "$backup_directory" && ! -L "$backup_directory" \
   && "$(readlink -f -- "$backup_directory")" == "$backup_directory" ]] \
  || fail "the recovery backup directory is unsafe"
case "$backup_directory" in "$deploy_root"/*) ;; *) fail "the recovery backup directory is outside the deployment root" ;; esac
[[ "$(stat -c '%U' -- "$backup_directory")" == "$cloudlinux_user" ]] \
  || fail "the recovery backup directory owner is invalid"
chmod 0700 -- "$backup_directory"

pipeline_lock="$deploy_root/.pipeline.lock"
if [[ ! -e "$pipeline_lock" && ! -L "$pipeline_lock" ]]; then
  (set -o noclobber; umask 077; : > "$pipeline_lock") 2>/dev/null || true
fi
[[ -f "$pipeline_lock" && ! -L "$pipeline_lock" ]] || fail "the shared pipeline lock is unsafe"
[[ "$(stat -c '%U' -- "$pipeline_lock")" == "$cloudlinux_user" ]] \
  || fail "the shared pipeline lock owner is invalid"
chmod 0600 -- "$pipeline_lock"
exec 8>>"$pipeline_lock"
flock -w "$pipeline_lock_wait_seconds" 8 \
  || fail "timed out waiting for another Staging operation"

current_link="$deploy_root/current"
[[ -L "$current_link" ]] || fail "the active release link is unavailable"
current_release=$(readlink -f -- "$current_link") || fail "the active release link is broken"
case "$current_release" in
  "$deploy_root"/releases/*) ;;
  *) fail "the active release is outside the release directory" ;;
esac
[[ -d "$current_release" && ! -L "$current_release" \
   && "$(readlink -f -- "$current_release")" == "$current_release" ]] \
  || fail "the active release directory is unsafe"
[[ -f "$current_release/apps/api/dist/database.js" && ! -L "$current_release/apps/api/dist/database.js" ]] \
  || fail "the active release cannot create its database client"
[[ -f "$current_release/scripts/release/verify-release.mjs" \
   && ! -L "$current_release/scripts/release/verify-release.mjs" ]] \
  || fail "the active release verifier is unavailable"
[[ -d "$current_release/tmp" && ! -L "$current_release/tmp" ]] \
  || fail "the active release restart directory is unsafe"
timeout --kill-after=10s 180s "$node_bin" "$current_release/scripts/release/verify-release.mjs" --root "$current_release" >/dev/null \
  || fail "the active release failed its immutable-content verification"

environment_file="$deploy_root/shared/passenger.env"
environment_present=false
if [[ -e "$environment_file" || -L "$environment_file" ]]; then
  [[ -f "$environment_file" && ! -L "$environment_file" \
     && "$(readlink -f -- "$environment_file")" == "$environment_file" ]] \
    || fail "the protected environment file is unsafe"
  environment_present=true
fi

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
selector_before=$(mktemp /tmp/mcap-operator-selector-before.XXXXXX)
selector_after=$(mktemp /tmp/mcap-operator-selector-after.XXXXXX)
original_environment_json=$(mktemp /tmp/mcap-operator-environment-before.XXXXXX)
candidate_environment_json=$(mktemp /tmp/mcap-operator-environment-next.XXXXXX)
selector_set_result=$(mktemp /tmp/mcap-operator-selector-set.XXXXXX)
selector_restart_result=$(mktemp /tmp/mcap-operator-selector-restart.XXXXXX)
selector_rollback_result=$(mktemp /tmp/mcap-operator-selector-rollback.XXXXXX)
plan_state=$(mktemp /tmp/mcap-operator-plan.XXXXXX)
app_root_file=$(mktemp /tmp/mcap-operator-app-root.XXXXXX)
passenger_candidate=$(mktemp "$(dirname -- "$passenger_config_file")/.mcap-operator-htaccess.next.XXXXXX")
environment_candidate=
if [[ "$environment_present" == true ]]; then
  environment_candidate=$(mktemp "$(dirname -- "$environment_file")/.mcap-operator-env.next.XXXXXX")
fi

registry_backup=$(mktemp "$backup_directory/platform-operator-registry-before-$timestamp.XXXXXXXX")
passenger_backup=$(mktemp "$backup_directory/platform-operator-htaccess-before-$timestamp.XXXXXXXX")
environment_backup=
if [[ "$environment_present" == true ]]; then
  environment_backup=$(mktemp "$backup_directory/platform-operator-env-before-$timestamp.XXXXXXXX")
fi

passenger_mode=$(stat -c '%a' -- "$passenger_config_file")
[[ "$passenger_mode" =~ ^[0-7]{3,4}$ ]] || fail "the Passenger configuration mode is invalid"
(( (8#$passenger_mode & 022) == 0 )) || fail "the Passenger configuration is group/other writable"
environment_mode=
if [[ "$environment_present" == true ]]; then
  environment_mode=$(stat -c '%a' -- "$environment_file")
  [[ "$environment_mode" == 600 ]] || fail "the protected environment mode is invalid"
  [[ "$(stat -c '%U' -- "$environment_file")" == "$cloudlinux_user" ]] \
    || fail "the protected environment owner is invalid"
fi

mutation_started=false
migration_completed=false

validate_selector_result() {
  local result_file=$1 command_exit=$2
  "$node_bin" - "$result_file" "$command_exit" <<'NODE'
const fs = require("node:fs");
try {
  const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (Number(process.argv[3]) !== 0 || payload?.result !== "success") process.exit(2);
} catch {
  process.exit(2);
}
NODE
}

verify_registry_environment() {
  local expected_environment_file=$1
  timeout --kill-after=10s 60s "$selector" get --json --interpreter nodejs --user "$cloudlinux_user" > "$selector_after" 2>/dev/null \
    || return 1
  [[ -s "$selector_after" && $(stat -c '%s' -- "$selector_after") -le 4194304 ]] || return 1
  "$node_bin" - "$selector_after" "$expected_environment_file" \
    "$cloudlinux_version" "$cloudlinux_user" "$cloudlinux_domain" "$expected_app_root" <<'NODE'
const fs = require("node:fs");
try {
  const [statePath, expectedPath, version, user, domain, expectedRoot] = process.argv.slice(2);
  const payload = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
  const applications = payload.available_versions?.[version]?.users?.[user]?.applications || {};
  const matches = Object.entries(applications).filter(([, application]) => application?.domain === domain);
  if (payload.result !== "success" || matches.length !== 1 || matches[0][0] !== expectedRoot
      || matches[0][1]?.startup_file !== "apps/api/dist/server.js" || matches[0][1]?.app_mode !== "production") process.exit(2);
  const actual = matches[0][1]?.env_vars;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) process.exit(2);
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) process.exit(2);
  if (expectedKeys.some((key) => typeof actual[key] !== "string" || actual[key] !== expected[key])) process.exit(2);
} catch {
  process.exit(2);
}
NODE
}

probe_health() {
  local attempts=${1:-30}
  local live_status ready_status
  for _ in $(seq 1 "$attempts"); do
    live_status=$(curl --silent --output /dev/null --write-out '%{http_code}' --connect-timeout 2 --max-time 5 "$live_url" || true)
    ready_status=$(curl --silent --output /dev/null --write-out '%{http_code}' --connect-timeout 2 --max-time 5 "$ready_url" || true)
    if [[ "$live_status" == 200 && "$ready_status" == 200 ]]; then return 0; fi
    sleep 2
  done
  return 1
}

restore_regular_file() {
  local backup=$1 destination=$2 mode=$3 candidate
  candidate=$(mktemp "$(dirname -- "$destination")/.mcap-operator-restore.XXXXXX") || return 1
  cp -- "$backup" "$candidate" || { rm -f -- "$candidate"; return 1; }
  chmod "$mode" -- "$candidate" || { rm -f -- "$candidate"; return 1; }
  mv -f -- "$candidate" "$destination"
}

rollback_configuration() {
  local rollback_ok=true rollback_exit restart_exit
  set +e
  if [[ -s "$original_environment_json" && -s "$app_root_file" ]]; then
    local original_environment app_root
    original_environment=$(<"$original_environment_json")
    app_root=$(<"$app_root_file")
    timeout --kill-after=10s 60s "$selector" set --json --interpreter nodejs --user "$cloudlinux_user" \
      --app-root "$app_root" --env-vars "$original_environment" \
      > "$selector_rollback_result" 2>&1
    rollback_exit=$?
    validate_selector_result "$selector_rollback_result" "$rollback_exit" >/dev/null 2>&1 || rollback_ok=false
    verify_registry_environment "$original_environment_json" >/dev/null 2>&1 || rollback_ok=false
    unset original_environment
  else
    rollback_ok=false
  fi

  if [[ "$environment_present" == true ]]; then
    restore_regular_file "$environment_backup" "$environment_file" "$environment_mode" || rollback_ok=false
  fi
  restore_regular_file "$passenger_backup" "$passenger_config_file" "$passenger_mode" || rollback_ok=false

  if [[ -s "$app_root_file" ]]; then
    local app_root
    app_root=$(<"$app_root_file")
    timeout --kill-after=10s 60s "$selector" restart --json --interpreter nodejs --user "$cloudlinux_user" --app-root "$app_root" \
      > "$selector_restart_result" 2>&1
    restart_exit=$?
    validate_selector_result "$selector_restart_result" "$restart_exit" >/dev/null 2>&1 || rollback_ok=false
    probe_health 15 >/dev/null 2>&1 || rollback_ok=false
  else
    rollback_ok=false
  fi
  set -e
  [[ "$rollback_ok" == true ]]
}

cleanup() {
  local status=$?
  trap - HUP INT TERM EXIT
  if [[ "$status" != 0 && "$mutation_started" == true && "$migration_completed" != true ]]; then
    if rollback_configuration; then
      log "the failed change was restored from protected snapshots"
    else
      printf 'mcap-staging-operator-migration: rollback did not complete; use the protected remote snapshots\n' >&2
    fi
  fi
  rm -f -- \
    "$selector_before" "$selector_after" "$original_environment_json" "$candidate_environment_json" \
    "$selector_set_result" "$selector_restart_result" "$selector_rollback_result" "$plan_state" \
    "$app_root_file" "$passenger_candidate"
  if [[ -n "$environment_candidate" ]]; then rm -f -- "$environment_candidate"; fi
  if [[ -n "$migration_database_url_file" ]]; then rm -f -- "$migration_database_url_file"; fi
  unset original_environment candidate_environment app_root migration_database_url_file
  exit "$status"
}
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
trap cleanup EXIT

timeout --kill-after=10s 60s "$selector" get --json --interpreter nodejs --user "$cloudlinux_user" > "$selector_before" 2>/dev/null \
  || fail "the active CloudLinux registry could not be read"
[[ -s "$selector_before" && $(stat -c '%s' -- "$selector_before") -le 4194304 ]] \
  || fail "the active CloudLinux registry exceeds its accepted bound"
cp -- "$selector_before" "$registry_backup"
cp -- "$passenger_config_file" "$passenger_backup"
if [[ "$environment_present" == true ]]; then cp -- "$environment_file" "$environment_backup"; fi
chmod 0600 -- "$registry_backup" "$passenger_backup"
if [[ "$environment_present" == true ]]; then chmod 0600 -- "$environment_backup"; fi

expected_app_root=${current_release#"/home/$cloudlinux_user/"}
[[ "$expected_app_root" != "$current_release" && "$expected_app_root" =~ ^[A-Za-z0-9._/-]+$ \
   && "$expected_app_root" != /* && "$expected_app_root" != *..* ]] \
  || fail "the active CloudLinux root cannot be derived safely"

(
  cd -- "$current_release"
  timeout --kill-after=10s 90s "$node_bin" --input-type=module - \
    "$registry_backup" \
    "$environment_backup" \
    "$passenger_backup" \
    "$cloudlinux_version" \
    "$cloudlinux_user" \
    "$cloudlinux_domain" \
    "$expected_app_root" \
    "$original_environment_json" \
    "$candidate_environment_json" \
    "$environment_candidate" \
    "$passenger_candidate" \
    "$plan_state" \
    "$app_root_file" \
    "$migration_database_url_file" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_CONFIGURATION_BYTES = 1_048_576;
const MAX_REGISTRY_BYTES = 4_194_304;
const MAX_DATABASE_URL_BYTES = 2_048;
const MAX_OPERATOR_COUNT = 64;
const MAX_EMAIL_BYTES = 320;
const MAX_ENVIRONMENT_KEYS = 256;
const MAX_ENVIRONMENT_VALUE_BYTES = 32_768;
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;
const RELEVANT_KEYS = new Set(["DATABASE_URL", "PLATFORM_OPERATOR_EMAILS", "PLATFORM_OPERATOR_USER_IDS"]);

const [
  registryPath,
  protectedEnvironmentPath,
  passengerPath,
  version,
  user,
  domain,
  expectedRoot,
  originalEnvironmentOutput,
  candidateEnvironmentOutput,
  protectedEnvironmentOutput,
  passengerOutput,
  planOutput,
  appRootOutput,
  migrationDatabaseUrlPath,
] = process.argv.slice(2);

function readBounded(file, maximum) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) throw new Error("invalid file");
  return fs.readFileSync(file, "utf8");
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))) return trimmed.slice(1, -1);
  return trimmed;
}

function parseProtectedEnvironment(text) {
  const environment = {};
  const counts = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    if (RELEVANT_KEYS.has(match[1])) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    environment[match[1]] = unquote(match[2]);
  }
  for (const count of counts.values()) if (count !== 1) throw new Error("duplicate protected setting");
  return environment;
}

function parsePassenger(text) {
  const environment = {};
  const counts = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*SetEnv\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*$/u);
    if (!match) continue;
    if (RELEVANT_KEYS.has(match[1])) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    environment[match[1]] = unquote(match[2]);
  }
  for (const count of counts.values()) if (count !== 1) throw new Error("duplicate Passenger setting");
  return environment;
}

function validateRegistryEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid registry environment");
  const entries = Object.entries(value);
  if (entries.length > MAX_ENVIRONMENT_KEYS) throw new Error("registry environment too large");
  for (const [key, item] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof item !== "string" || Buffer.byteLength(item) > MAX_ENVIRONMENT_VALUE_BYTES) {
      throw new Error("invalid registry environment value");
    }
  }
  return { ...value };
}

function databaseIdentity(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > MAX_DATABASE_URL_BYTES
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("invalid database URL");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "mysql:" || !parsed.hostname || parsed.username.length === 0 || parsed.pathname.length < 2) {
    throw new Error("invalid database URL");
  }
  const schema = decodeURIComponent(parsed.pathname);
  const retiredDatabaseBrand = new RegExp(["j", "[aeiou]", "wa{1,2}r"].join(""), "iu");
  if (!/^\/[A-Za-z0-9_$-]+$/u.test(schema) || retiredDatabaseBrand.test(schema)) throw new Error("invalid database schema");
  return `${parsed.hostname.toLowerCase()}\u0000${parsed.port || "3306"}\u0000${schema}`;
}

function parseEmails(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  if (Buffer.byteLength(value) > MAX_OPERATOR_COUNT * (MAX_EMAIL_BYTES + 1)) throw new Error("email allowlist too large");
  const emails = value.split(",").map((item) => item.trim().toLocaleLowerCase("en-US"));
  if (emails.length < 1 || emails.length > MAX_OPERATOR_COUNT) throw new Error("email allowlist count invalid");
  for (const email of emails) {
    if (Buffer.byteLength(email) < 3 || Buffer.byteLength(email) > MAX_EMAIL_BYTES
        || !/^[^,\s@]+@[^,\s@]+$/u.test(email)) throw new Error("email allowlist value invalid");
  }
  if (new Set(emails).size !== emails.length) throw new Error("email allowlist contains duplicates");
  return emails;
}

function parseIds(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  if (Buffer.byteLength(value) > MAX_OPERATOR_COUNT * 21) throw new Error("ID allowlist too large");
  const rawIds = value.split(",").map((item) => item.trim());
  if (rawIds.length < 1 || rawIds.length > MAX_OPERATOR_COUNT) throw new Error("ID allowlist count invalid");
  if (!rawIds.every((item) => /^[1-9][0-9]*$/u.test(item))) throw new Error("ID allowlist value invalid");
  const ids = rawIds.map(BigInt);
  if (ids.some((id) => id > MAX_UNSIGNED_BIGINT) || new Set(ids.map(String)).size !== ids.length) {
    throw new Error("ID allowlist value invalid");
  }
  return ids;
}

function canonicalStrings(values) {
  return [...values].sort().join("\u0000");
}

function canonicalIds(values) {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0).map(String).join(",");
}

function replaceProtectedEnvironment(text, ids) {
  const kept = text.split(/\r?\n/u).filter((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/u);
    return !match || (match[1] !== "PLATFORM_OPERATOR_EMAILS" && match[1] !== "PLATFORM_OPERATOR_USER_IDS");
  });
  while (kept.length && kept.at(-1) === "") kept.pop();
  return `${kept.join("\n")}${kept.length ? "\n" : ""}PLATFORM_OPERATOR_USER_IDS=${ids}\n`;
}

function replacePassenger(text, ids) {
  const kept = text.split(/\r?\n/u).filter((line) => {
    const match = line.match(/^\s*SetEnv\s+([A-Za-z_][A-Za-z0-9_]*)\s+/u);
    return !match || (match[1] !== "PLATFORM_OPERATOR_EMAILS" && match[1] !== "PLATFORM_OPERATOR_USER_IDS");
  });
  while (kept.length && kept.at(-1) === "") kept.pop();
  return `${kept.join("\n")}${kept.length ? "\n" : ""}SetEnv PLATFORM_OPERATOR_USER_IDS ${ids}\n`;
}

async function main() {
  const registryText = readBounded(registryPath, MAX_REGISTRY_BYTES);
  const passengerText = readBounded(passengerPath, MAX_CONFIGURATION_BYTES);
  const protectedText = protectedEnvironmentPath ? readBounded(protectedEnvironmentPath, MAX_CONFIGURATION_BYTES) : null;
  const payload = JSON.parse(registryText);
  const applications = payload.available_versions?.[version]?.users?.[user]?.applications || {};
  const matches = Object.entries(applications).filter(([, application]) => application?.domain === domain);
  if (payload.result !== "success" || matches.length !== 1 || matches[0][0] !== expectedRoot
      || matches[0][1]?.startup_file !== "apps/api/dist/server.js" || matches[0][1]?.app_mode !== "production") {
    throw new Error("ambiguous registry");
  }
  const [appRoot, application] = matches[0];
  const registryEnvironment = validateRegistryEnvironment(application.env_vars || {});
  const sources = [
    ...(protectedText === null ? [] : [{ label: "protected", environment: parseProtectedEnvironment(protectedText) }]),
    { label: "passenger", environment: parsePassenger(passengerText) },
    { label: "registry", environment: registryEnvironment },
  ];

  const databaseSources = sources.filter(({ environment }) => typeof environment.DATABASE_URL === "string" && environment.DATABASE_URL.length > 0);
  if (databaseSources.length < 1 || typeof registryEnvironment.DATABASE_URL !== "string") throw new Error("database source missing");
  const databaseIdentities = databaseSources.map(({ environment }) => databaseIdentity(environment.DATABASE_URL));
  if (new Set(databaseIdentities).size !== 1) throw new Error("database sources differ");
  const migrationDatabaseUrl = readBounded(migrationDatabaseUrlPath, MAX_DATABASE_URL_BYTES);
  if (databaseIdentity(migrationDatabaseUrl) !== databaseIdentities[0]) {
    throw new Error("migration database target differs");
  }

  const emailSources = sources.map(({ environment }) => parseEmails(environment.PLATFORM_OPERATOR_EMAILS)).filter((items) => items.length > 0);
  if (emailSources.length > 1 && new Set(emailSources.map(canonicalStrings)).size !== 1) throw new Error("email sources differ");
  const existingIdSources = sources.map(({ environment }) => parseIds(environment.PLATFORM_OPERATOR_USER_IDS)).filter((items) => items.length > 0);
  if (existingIdSources.length > 1 && new Set(existingIdSources.map(canonicalIds)).size !== 1) throw new Error("ID sources differ");

  const databaseModule = await import(pathToFileURL(path.join(process.cwd(), "apps/api/dist/database.js")).href);
  const prisma = databaseModule.createDatabase(registryEnvironment.DATABASE_URL, {
    connectionLimit: 1,
    minimumIdle: 1,
    acquireTimeoutMs: 10_000,
    connectTimeoutMs: 3_000,
    idleTimeoutSeconds: 30,
  });

  let selectedIds;
  let action;
  try {
    if (emailSources.length > 0) {
      const emails = emailSources[0];
      const rows = await prisma.user.findMany({
        where: { emailNormalized: { in: emails } },
        select: { id: true, emailNormalized: true, isActive: true },
      });
      const byEmail = new Map();
      for (const row of rows) {
        const normalized = row.emailNormalized.trim().toLocaleLowerCase("en-US");
        if (byEmail.has(normalized)) throw new Error("ambiguous user mapping");
        byEmail.set(normalized, row);
      }
      if (emails.some((email) => !byEmail.has(email))) throw new Error("user mapping missing");
      selectedIds = emails.map((email) => {
        const row = byEmail.get(email);
        if (!row.isActive) throw new Error("user mapping inactive");
        return row.id;
      });
      if (new Set(selectedIds.map(String)).size !== selectedIds.length) throw new Error("ambiguous user mapping");
      const resolvedCanonical = canonicalIds(selectedIds);
      if (existingIdSources.length > 0 && existingIdSources.some((ids) => canonicalIds(ids) !== resolvedCanonical)) {
        throw new Error("existing ID allowlist differs");
      }
      action = "migrate";
    } else {
      if (existingIdSources.length < 1) throw new Error("no operator allowlist exists");
      selectedIds = existingIdSources[0];
      const rows = await prisma.user.findMany({
        where: { id: { in: selectedIds } },
        select: { id: true, isActive: true },
      });
      const byId = new Map(rows.map((row) => [String(row.id), row]));
      if (selectedIds.some((id) => !byId.get(String(id))?.isActive)) throw new Error("configured ID is unavailable");
      action = existingIdSources.length === sources.length ? "noop" : "migrate";
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  const ids = canonicalIds(selectedIds);
  if (!ids) throw new Error("resolved ID allowlist is empty");
  const candidateRegistryEnvironment = { ...registryEnvironment, PLATFORM_OPERATOR_USER_IDS: ids };
  delete candidateRegistryEnvironment.PLATFORM_OPERATOR_EMAILS;
  const serializedEnvironment = JSON.stringify(candidateRegistryEnvironment);
  if (Buffer.byteLength(serializedEnvironment) > MAX_CONFIGURATION_BYTES) throw new Error("candidate registry environment too large");

  fs.writeFileSync(originalEnvironmentOutput, JSON.stringify(registryEnvironment), { mode: 0o600 });
  fs.writeFileSync(candidateEnvironmentOutput, serializedEnvironment, { mode: 0o600 });
  if (protectedText !== null) {
    fs.writeFileSync(protectedEnvironmentOutput, replaceProtectedEnvironment(protectedText, ids), { mode: 0o600 });
  }
  fs.writeFileSync(passengerOutput, replacePassenger(passengerText, ids), { mode: 0o600 });
  fs.writeFileSync(planOutput, `${action}\n`, { mode: 0o600 });
  fs.writeFileSync(appRootOutput, appRoot, { mode: 0o600 });
}

main().catch(() => {
  process.stderr.write("Staging operator migration planning failed without exposing configuration values.\n");
  process.exitCode = 1;
});
NODE
) || fail "the Staging operator migration plan was rejected"

rm -f -- "$migration_database_url_file"
migration_database_url_file=

action=$(<"$plan_state")
app_root=$(<"$app_root_file")
[[ "$app_root" == "$expected_app_root" ]] || fail "the active CloudLinux registration changed unexpectedly"

verify_preflight() {
  timeout --kill-after=10s 60s "$selector" get --json --interpreter nodejs --user "$cloudlinux_user" > "$selector_after" 2>/dev/null \
    || return 1
  [[ -s "$selector_after" && $(stat -c '%s' -- "$selector_after") -le 4194304 ]] || return 1
  "$node_bin" --input-type=module - \
    "$selector_after" "$environment_file" "$passenger_config_file" \
    "$cloudlinux_version" "$cloudlinux_user" "$cloudlinux_domain" "$expected_app_root" <<'NODE'
import fs from "node:fs";

const [registryPath, protectedPath, passengerPath, version, user, domain, expectedRoot] = process.argv.slice(2);
const MAX_FILE = 1_048_576;
const MAX_REGISTRY = 4_194_304;
const MAX_URL = 2_048;
const MAX_IDS = 64;

function read(file, maximum) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) throw new Error("invalid file");
  return fs.readFileSync(file, "utf8");
}
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed[0] === '"' && trimmed.at(-1) === '"') || (trimmed[0] === "'" && trimmed.at(-1) === "'"))) return trimmed.slice(1, -1);
  return trimmed;
}
function parseFile(text, passenger) {
  const output = {};
  const counts = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = passenger
      ? line.match(/^\s*SetEnv\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*$/u)
      : line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    if (["DATABASE_URL", "PLATFORM_OPERATOR_EMAILS", "PLATFORM_OPERATOR_USER_IDS"].includes(match[1])) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
    output[match[1]] = unquote(match[2]);
  }
  for (const count of counts.values()) if (count !== 1) throw new Error("duplicate setting");
  return output;
}
function databaseIdentity(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > MAX_URL
      || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("invalid database source");
  const parsed = new URL(value);
  const schema = decodeURIComponent(parsed.pathname);
  const retiredDatabaseBrand = new RegExp(["j", "[aeiou]", "wa{1,2}r"].join(""), "iu");
  if (parsed.protocol !== "mysql:" || !parsed.hostname || !parsed.username || !/^\/[A-Za-z0-9_$-]+$/u.test(schema)
      || retiredDatabaseBrand.test(schema)) throw new Error("invalid database source");
  return `${parsed.hostname.toLowerCase()}\u0000${parsed.port || "3306"}\u0000${schema}`;
}
function ids(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const parts = value.split(",").map((item) => item.trim());
  if (parts.length < 1 || parts.length > MAX_IDS || !parts.every((item) => /^[1-9][0-9]*$/u.test(item))) throw new Error("invalid ID setting");
  if (new Set(parts).size !== parts.length) throw new Error("duplicate ID setting");
  return parts.map(BigInt).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).map(String).join(",");
}

try {
  const payload = JSON.parse(read(registryPath, MAX_REGISTRY));
  const applications = payload.available_versions?.[version]?.users?.[user]?.applications || {};
  const matches = Object.entries(applications).filter(([, application]) => application?.domain === domain);
  if (payload.result !== "success" || matches.length !== 1 || matches[0][0] !== expectedRoot
      || matches[0][1]?.startup_file !== "apps/api/dist/server.js" || matches[0][1]?.app_mode !== "production") {
    throw new Error("invalid registry");
  }
  const sources = [
    ...(fs.existsSync(protectedPath) ? [parseFile(read(protectedPath, MAX_FILE), false)] : []),
    parseFile(read(passengerPath, MAX_FILE), true),
    matches[0][1].env_vars || {},
  ];
  if (sources.some((source) => typeof source.PLATFORM_OPERATOR_EMAILS === "string" && source.PLATFORM_OPERATOR_EMAILS.trim())) {
    throw new Error("legacy email remains");
  }
  const configuredIds = sources.map((source) => ids(source.PLATFORM_OPERATOR_USER_IDS)).filter(Boolean);
  if (configuredIds.length !== sources.length || new Set(configuredIds).size !== 1) throw new Error("ID sources differ");
  const databaseSources = sources.filter((source) => typeof source.DATABASE_URL === "string" && source.DATABASE_URL.length > 0);
  if (databaseSources.length < 1 || new Set(databaseSources.map((source) => databaseIdentity(source.DATABASE_URL))).size !== 1) {
    throw new Error("database sources differ");
  }
} catch {
  process.exit(2);
}
NODE
}

if [[ "$action" == noop ]]; then
  rm -f -- "$registry_backup" "$passenger_backup"
  if [[ -n "$environment_backup" ]]; then rm -f -- "$environment_backup"; fi
  verify_preflight || fail "the existing ID configuration failed the Staging preflight"
  probe_health 5 || fail "the idempotent Staging verification failed health checks"
  migration_completed=true
  log "the Staging operator configuration already uses active user IDs"
  exit 0
fi
[[ "$action" == migrate ]] || fail "the Staging operator migration plan is invalid"

cmp -s -- "$passenger_backup" "$passenger_config_file" \
  || fail "the Passenger configuration changed after planning"
if [[ "$environment_present" == true ]]; then
  cmp -s -- "$environment_backup" "$environment_file" \
    || fail "the protected environment changed after planning"
fi

chmod "$passenger_mode" -- "$passenger_candidate"
if [[ "$environment_present" == true ]]; then chmod "$environment_mode" -- "$environment_candidate"; fi

mutation_started=true
if [[ "$environment_present" == true ]]; then
  mv -f -- "$environment_candidate" "$environment_file"
  environment_candidate=
fi

candidate_environment=$(<"$candidate_environment_json")
set +e
timeout --kill-after=10s 60s "$selector" set --json --interpreter nodejs --user "$cloudlinux_user" \
  --app-root "$app_root" --env-vars "$candidate_environment" \
  > "$selector_set_result" 2>&1
selector_set_exit=$?
set -e
unset candidate_environment
validate_selector_result "$selector_set_result" "$selector_set_exit" \
  || fail "CloudLinux rejected the protected operator environment update"
verify_registry_environment "$candidate_environment_json" \
  || fail "CloudLinux did not persist the exact protected operator environment"

mv -f -- "$passenger_candidate" "$passenger_config_file"
passenger_candidate=

verify_preflight || fail "the updated configuration failed the Staging preflight"

set +e
timeout --kill-after=10s 60s "$selector" restart --json --interpreter nodejs --user "$cloudlinux_user" --app-root "$app_root" \
  > "$selector_restart_result" 2>&1
selector_restart_exit=$?
set -e
validate_selector_result "$selector_restart_result" "$selector_restart_exit" \
  || fail "CloudLinux could not restart the updated Staging registration"

touch -- "$current_release/tmp/restart.txt" "$passenger_config_file"
probe_health 30 || fail "the updated Staging application failed health checks"
verify_preflight || fail "the restarted configuration failed the final Staging preflight"

migration_completed=true
mutation_started=false
log "the Staging operator allowlist now uses active user IDs and retained protected rollback snapshots"
