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
pipeline_lock_wait_seconds=${MCAP_PIPELINE_LOCK_WAIT_SECONDS:-900}
media_root=${MCAP_MEDIA_ROOT:-"$deploy_root/shared/media"}
[[ "$media_root" == "$deploy_root/shared/media" ]] || fail "MCAP_MEDIA_ROOT must equal the fixed persistent deployment media path"
script_directory=$(cd -- "$(dirname -- "$0")" && pwd -P)
cloudlinux_switcher="$script_directory/switch-cloudlinux-registration.sh"

[[ -n "$archive_input" && -n "$checksum_file_input" ]] || fail "usage: deploy-cpanel-release.sh <archive.tgz> <checksum-file>"
[[ "$deploy_root" == /* && "$deploy_root" != / ]] || fail "MCAP_DEPLOY_ROOT must be an explicit absolute non-root path"
[[ "$passenger_config_file" == /* && "$passenger_config_file" != / ]] || fail "MCAP_PASSENGER_CONFIG_FILE must be an explicit absolute non-root path"
[[ "$backup_directory" == /* && "$backup_directory" != / ]] || fail "MCAP_BACKUP_DIRECTORY must be an explicit absolute non-root path"
[[ -f "$passenger_config_file" && ! -L "$passenger_config_file" ]] || fail "Passenger configuration must be a regular non-symlink file"
[[ -x "$node_bin" ]] || fail "Node executable is unavailable: $node_bin"
[[ -f "$npx_cli" && ! -L "$npx_cli" ]] || fail "npm exec entrypoint is unavailable: $npx_cli"
[[ -x "$mysql_bin" ]] || fail "MySQL client is unavailable: $mysql_bin"
[[ -x "$mysqldump_bin" ]] || fail "MySQL dump client is unavailable: $mysqldump_bin"
[[ -f "$cloudlinux_switcher" && ! -L "$cloudlinux_switcher" ]] || fail "CloudLinux registration switcher is unavailable"
[[ "$pipeline_lock_wait_seconds" =~ ^[1-9][0-9]{0,3}$ ]] \
  && (( pipeline_lock_wait_seconds <= 1800 )) \
  || fail "MCAP_PIPELINE_LOCK_WAIT_SECONDS must be between 1 and 1800"

archive=$(readlink -f -- "$archive_input") || fail "release archive does not exist"
checksum_file=$(readlink -f -- "$checksum_file_input") || fail "release checksum file does not exist"
[[ -f "$archive" && ! -L "$archive_input" ]] || fail "release archive must be a regular non-symlink file"
[[ -f "$checksum_file" && ! -L "$checksum_file_input" ]] || fail "release checksum must be a regular non-symlink file"
expected_sha=$(awk 'NR == 1 { print $1 }' "$checksum_file")
[[ "$expected_sha" =~ ^[0-9a-fA-F]{64}$ ]] || fail "release checksum file is invalid"
actual_sha=$(sha256sum --binary "$archive" | awk '{ print $1 }')
[[ "${actual_sha,,}" == "${expected_sha,,}" ]] || fail "release checksum verification failed"

IFS= read -r backup_passphrase || fail "encrypted backup passphrase is required on standard input"
[[ ${#backup_passphrase} -ge 32 ]] || fail "encrypted backup passphrase must contain at least 32 characters"
IFS= read -r metrics_bearer_token || fail "metrics bearer token is required on standard input"
[[ ${#metrics_bearer_token} -ge 32 && ${#metrics_bearer_token} -le 500 ]] \
  || fail "metrics bearer token must contain between 32 and 500 characters"
IFS= read -r migration_database_url || fail "migration database URL is required on standard input"
[[ "$migration_database_url" == mysql://* && ${#migration_database_url} -le 2048 ]] \
  || fail "migration database URL must be a valid-length MySQL URL"
[[ ! "$migration_database_url" =~ [[:cntrl:]] ]] \
  || fail "migration database URL contains unsupported control characters"

metrics_token_file=$(mktemp /tmp/mcap-metrics-token.XXXXXX)
backup_helper_directory=$(mktemp -d /tmp/mcap-backup-helper.XXXXXX)
cleanup() {
  local status=$?
  rm -f -- "$metrics_token_file"
  rm -rf -- "$backup_helper_directory"
  unset database_url migration_database_url backup_passphrase
  exit "$status"
}
trap cleanup EXIT
printf '%s' "$metrics_bearer_token" > "$metrics_token_file"
unset metrics_bearer_token

database_url=$(awk '
  $1 == "SetEnv" && $2 == "DATABASE_URL" {
    $1 = ""; $2 = ""; sub(/^[[:space:]]+/, ""); print; exit
  }
' "$passenger_config_file")
[[ "$database_url" == mysql://* ]] || fail "DATABASE_URL is missing from the Passenger configuration"

mkdir -p -- "$deploy_root" "$backup_directory" "$media_root"
chmod 0700 -- "$backup_directory"
chmod 0750 -- "$media_root"
[[ -d "$media_root" && ! -L "$media_root" && "$(readlink -f -- "$media_root")" == "$media_root" ]] \
  || fail "the fixed persistent media path is unsafe"
exec 8>"$deploy_root/.pipeline.lock"
flock -w "$pipeline_lock_wait_seconds" 8 \
  || fail "timed out waiting for another production pipeline"

current_link="$deploy_root/current"
[[ -L "$current_link" ]] || fail "the current release link is unavailable"
current_release=$(readlink -f -- "$current_link") || fail "the current release link is broken"
case "$current_release" in
  "$deploy_root"/releases/*) ;;
  *) fail "the current release link escapes $deploy_root/releases" ;;
esac
[[ -f "$current_release/scripts/database-backup.mjs" ]] || fail "the current release cannot create a production backup"

tar -xzf "$archive" -C "$backup_helper_directory" -- \
  ./scripts/media-backup.mjs \
  ./scripts/lib/backup-format.mjs \
  ./scripts/lib/backup-pair-verifier.mjs \
  || fail "the verified incoming release does not contain media backup helpers"
incoming_media_backup="$backup_helper_directory/scripts/media-backup.mjs"
incoming_pair_verifier="$backup_helper_directory/scripts/lib/backup-pair-verifier.mjs"
[[ -f "$incoming_media_backup" && ! -L "$incoming_media_backup" ]] || fail "incoming media backup helper is unsafe"
[[ -f "$incoming_pair_verifier" && ! -L "$incoming_pair_verifier" ]] || fail "incoming pair verifier is unsafe"

log "creating an encrypted pre-deployment database backup"
database_backup_result=$(DATABASE_URL="$migration_database_url" \
BACKUP_DIRECTORY="$backup_directory" \
BACKUP_ENCRYPTION_PASSPHRASE="$backup_passphrase" \
MYSQL_BIN="$mysql_bin" \
MYSQLDUMP_BIN="$mysqldump_bin" \
  "$node_bin" "$current_release/scripts/database-backup.mjs")
log "creating the encrypted product-media member of the same recovery point"
media_backup_result=$(MEDIA_ROOT="$media_root" BACKUP_DIRECTORY="$backup_directory" BACKUP_ENCRYPTION_PASSPHRASE="$backup_passphrase" \
  "$node_bin" "$incoming_media_backup")
pair_manifest_path=$("$node_bin" -e '
    import(process.argv[1]).then(async ({sha256File}) => {
      const fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto");
      const [directory,dbText,mediaText]=process.argv.slice(2); const db=JSON.parse(dbText),media=JSON.parse(mediaText);
      for(const r of [db,media]) if(r.status!=="created"||!r.backupPath||!r.manifestPath)process.exit(2);
      const target=path.join(directory,`mcap-backup-pair-${Date.now()}-${process.pid}.json`),partial=`${target}.partial`;
      const member=async r=>({artifact:{file:path.basename(r.backupPath),sha256:await sha256File(r.backupPath)},manifest:{file:path.basename(r.manifestPath),sha256:await sha256File(r.manifestPath)}});
      const pair={format:"mcap-backup-pair-v1",pairId:randomUUID(),createdAt:new Date().toISOString(),database:await member(db),media:await member(media)};
      fs.writeFileSync(partial,JSON.stringify(pair,null,2)+"\n",{mode:0o600,flag:"wx"}); fs.renameSync(partial,target); process.stdout.write(target);
    }).catch(()=>process.exit(2));
  ' "file://$backup_helper_directory/scripts/lib/backup-format.mjs" "$backup_directory" "$database_backup_result" "$media_backup_result")
"$node_bin" -e 'import(process.argv[1]).then(m=>m.verifyBackupPair(process.argv[2])).catch(()=>process.exit(2))' \
  "file://$incoming_pair_verifier" "$pair_manifest_path" \
  || fail "the pre-deployment backup pair failed verification"
log "verified pre-deployment backup pair $(basename -- "$pair_manifest_path")"
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
MIGRATION_DATABASE_URL="$migration_database_url" \
MCAP_DEPLOY_ROOT="$deploy_root" \
MCAP_MEDIA_ROOT="$media_root" \
MCAP_NODE_BIN="$node_bin" \
MCAP_NPX_CLI="$npx_cli" \
MCAP_MYSQL_BIN="$mysql_bin" \
MCAP_HEALTH_URL="${MCAP_HEALTH_URL:-}" \
MCAP_APP_URL="${MCAP_APP_URL:-}" \
MCAP_PASSENGER_CONFIG_FILE="$passenger_config_file" \
MCAP_CLOUDLINUX_SWITCHER="$cloudlinux_switcher" \
MCAP_METRICS_TOKEN_FILE="$metrics_token_file" \
MCAP_DEPLOY_CONFIRM="DEPLOY:$release_id" \
MCAP_RUN_DATABASE_MIGRATIONS=true \
  bash "$script_directory/install-cpanel-release.sh" "$archive" "$expected_sha"

log "production deployment completed for $release_id"
