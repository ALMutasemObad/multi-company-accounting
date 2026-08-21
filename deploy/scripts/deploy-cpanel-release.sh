#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'mcap-cpanel-pipeline: %s\n' "$*" >&2; exit 1; }
log() { printf 'mcap-cpanel-pipeline: %s\n' "$*"; }

archive_input=${1:-}
checksum_file_input=${2:-}
deploy_root=${MCAP_DEPLOY_ROOT:-}
node_bin=${MCAP_NODE_BIN:-/opt/alt/alt-nodejs22/root/usr/bin/node}
npx_cli=${MCAP_NPX_CLI:-/opt/alt/alt-nodejs22/root/usr/lib/node_modules/npm/bin/npx-cli.js}
passenger_config_file=${MCAP_PASSENGER_CONFIG_FILE:-}
backup_directory=${MCAP_BACKUP_DIRECTORY:-}
mysql_bin=${MCAP_MYSQL_BIN:-/usr/bin/mysql}
mysqldump_bin=${MCAP_MYSQLDUMP_BIN:-/usr/bin/mysqldump}

[[ -n "$archive_input" && -n "$checksum_file_input" ]] || fail "usage: deploy-cpanel-release.sh <archive.tgz> <checksum-file>"
[[ "$deploy_root" == /* && "$deploy_root" != / ]] || fail "MCAP_DEPLOY_ROOT must be an explicit absolute non-root path"
[[ "$passenger_config_file" == /* && "$passenger_config_file" != / ]] || fail "MCAP_PASSENGER_CONFIG_FILE must be an explicit absolute non-root path"
[[ "$backup_directory" == /* && "$backup_directory" != / ]] || fail "MCAP_BACKUP_DIRECTORY must be an explicit absolute non-root path"
[[ -f "$passenger_config_file" && ! -L "$passenger_config_file" ]] || fail "Passenger configuration must be a regular non-symlink file"
[[ -x "$node_bin" ]] || fail "Node executable is unavailable: $node_bin"
[[ -f "$npx_cli" && ! -L "$npx_cli" ]] || fail "npm exec entrypoint is unavailable: $npx_cli"
[[ -x "$mysql_bin" ]] || fail "MySQL client is unavailable: $mysql_bin"
[[ -x "$mysqldump_bin" ]] || fail "MySQL dump client is unavailable: $mysqldump_bin"

archive=$(readlink -f -- "$archive_input") || fail "release archive does not exist"
checksum_file=$(readlink -f -- "$checksum_file_input") || fail "release checksum file does not exist"
[[ -f "$archive" && ! -L "$archive_input" ]] || fail "release archive must be a regular non-symlink file"
[[ -f "$checksum_file" && ! -L "$checksum_file_input" ]] || fail "release checksum must be a regular non-symlink file"
expected_sha=$(awk 'NR == 1 { print $1 }' "$checksum_file")
[[ "$expected_sha" =~ ^[0-9a-fA-F]{64}$ ]] || fail "release checksum file is invalid"

IFS= read -r backup_passphrase || fail "encrypted backup passphrase is required on standard input"
[[ ${#backup_passphrase} -ge 32 ]] || fail "encrypted backup passphrase must contain at least 32 characters"

database_url=$(awk '
  $1 == "SetEnv" && $2 == "DATABASE_URL" {
    $1 = ""; $2 = ""; sub(/^[[:space:]]+/, ""); print; exit
  }
' "$passenger_config_file")
[[ "$database_url" == mysql://* ]] || fail "DATABASE_URL is missing from the Passenger configuration"

mkdir -p -- "$deploy_root" "$backup_directory"
chmod 0700 -- "$backup_directory"
exec 8>"$deploy_root/.pipeline.lock"
flock -n 8 || fail "another production pipeline is running"

current_link="$deploy_root/current"
[[ -L "$current_link" ]] || fail "the current release link is unavailable"
current_release=$(readlink -f -- "$current_link") || fail "the current release link is broken"
case "$current_release" in
  "$deploy_root"/releases/*) ;;
  *) fail "the current release link escapes $deploy_root/releases" ;;
esac
[[ -f "$current_release/scripts/database-backup.mjs" ]] || fail "the current release cannot create a production backup"

log "creating an encrypted pre-deployment database backup"
DATABASE_URL="$database_url" \
BACKUP_DIRECTORY="$backup_directory" \
BACKUP_ENCRYPTION_PASSPHRASE="$backup_passphrase" \
MYSQL_BIN="$mysql_bin" \
MYSQLDUMP_BIN="$mysqldump_bin" \
  "$node_bin" "$current_release/scripts/database-backup.mjs"
unset backup_passphrase

release_id=$(tar -xOzf "$archive" ./release-manifest.json | "$node_bin" -e '
  let input = "";
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    const manifest = JSON.parse(input);
    if (!/^[a-z0-9][a-z0-9._-]{0,159}$/.test(manifest.releaseId ?? "")) process.exit(2);
    process.stdout.write(manifest.releaseId);
  });
') || fail "release identifier is invalid"

log "installing verified release $release_id"
DATABASE_URL="$database_url" \
MCAP_DEPLOY_ROOT="$deploy_root" \
MCAP_NODE_BIN="$node_bin" \
MCAP_NPX_CLI="$npx_cli" \
MCAP_HEALTH_URL="${MCAP_HEALTH_URL:-}" \
MCAP_APP_URL="${MCAP_APP_URL:-}" \
MCAP_PASSENGER_CONFIG_FILE="$passenger_config_file" \
MCAP_DEPLOY_CONFIRM="DEPLOY:$release_id" \
MCAP_RUN_DATABASE_MIGRATIONS=true \
  bash "$(dirname -- "$0")/install-cpanel-release.sh" "$archive" "$expected_sha"

log "production deployment completed for $release_id"
