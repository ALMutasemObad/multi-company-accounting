#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() {
  printf 'mcap-offsite-backup: %s\n' "$1" >&2
  exit 1
}

deploy_root=${MCAP_DEPLOY_ROOT:-}
backup_directory=${MCAP_BACKUP_DIRECTORY:-}
passenger_config_file=${MCAP_PASSENGER_CONFIG_FILE:-}
node_bin=${MCAP_NODE_BIN:-/opt/alt/alt-nodejs22/root/usr/bin/node}
mysql_bin=${MCAP_MYSQL_BIN:-/usr/bin/mysql}
mysqldump_bin=${MCAP_MYSQLDUMP_BIN:-/usr/bin/mysqldump}
pipeline_lock_wait_seconds=${MCAP_PIPELINE_LOCK_WAIT_SECONDS:-900}
script_directory=$(cd -- "$(dirname -- "$0")" && pwd -P)
normalizer="$script_directory/normalize-cpanel-backup.mjs"
media_backup_script="$script_directory/media-backup.mjs"
pair_verifier="$script_directory/lib/backup-pair-verifier.mjs"
backup_format="$script_directory/lib/backup-format.mjs"
media_root=${MCAP_MEDIA_ROOT:-"$deploy_root/shared/media"}

[[ "$deploy_root" == /* && "$deploy_root" != / ]] \
  || fail "MCAP_DEPLOY_ROOT must be an explicit absolute non-root path"
[[ "$backup_directory" == /* && "$backup_directory" != / ]] \
  || fail "MCAP_BACKUP_DIRECTORY must be an explicit absolute non-root path"
[[ "$media_root" == /* && "$media_root" != / ]] \
  || fail "MCAP_MEDIA_ROOT must be an explicit absolute non-root path"
[[ "$media_root" == "$deploy_root/shared/media" ]] \
  || fail "MCAP_MEDIA_ROOT must equal the fixed persistent deployment media path"
[[ "$passenger_config_file" == /* && "$passenger_config_file" != / ]] \
  || fail "MCAP_PASSENGER_CONFIG_FILE must be an explicit absolute non-root path"
[[ -f "$passenger_config_file" && ! -L "$passenger_config_file" ]] \
  || fail "the Passenger configuration must be a regular non-symlink file"
[[ -x "$node_bin" ]] || fail "the production Node runtime is unavailable"
[[ -x "$mysql_bin" ]] || fail "the MySQL client is unavailable"
[[ -x "$mysqldump_bin" ]] || fail "the MySQL dump client is unavailable"
[[ -f "$normalizer" && ! -L "$normalizer" ]] || fail "the staged backup normalizer is unavailable"
[[ -f "$media_backup_script" && ! -L "$media_backup_script" ]] || fail "the staged media backup helper is unavailable"
[[ -f "$pair_verifier" && ! -L "$pair_verifier" ]] || fail "the staged backup pair verifier is unavailable"
[[ -f "$backup_format" && ! -L "$backup_format" ]] || fail "the staged backup format helper is unavailable"
[[ "$pipeline_lock_wait_seconds" =~ ^[1-9][0-9]{0,3}$ ]] \
  && (( pipeline_lock_wait_seconds <= 1800 )) \
  || fail "MCAP_PIPELINE_LOCK_WAIT_SECONDS must be between 1 and 1800"

backup_passphrase=
migration_database_url=
cleanup() {
  unset backup_passphrase migration_database_url runtime_database_url backup_result
}
trap cleanup EXIT

IFS= read -r backup_passphrase || fail "encrypted backup passphrase is required on standard input"
IFS= read -r migration_database_url || fail "migration database URL is required on standard input"
[[ ${#backup_passphrase} -ge 32 ]] || fail "encrypted backup passphrase is invalid"
[[ "$migration_database_url" == mysql://* && ${#migration_database_url} -le 2048 ]] \
  || fail "migration database URL is invalid"

[[ -d "$backup_directory" && ! -L "$backup_directory" ]] \
  || fail "the backup directory must already be a regular directory"
resolved_backup_directory=$(readlink -f -- "$backup_directory") \
  || fail "backup directory cannot be resolved"
[[ "$resolved_backup_directory" == "$backup_directory" ]] \
  || fail "the backup directory must not traverse symbolic links"
chmod 0700 -- "$backup_directory"

[[ -d "$deploy_root" && ! -L "$deploy_root" ]] || fail "the deployment root is invalid"
resolved_deploy_root=$(readlink -f -- "$deploy_root") || fail "the deployment root cannot be resolved"
[[ "$resolved_deploy_root" == "$deploy_root" ]] || fail "the deployment root must not traverse symbolic links"
pipeline_lock="$deploy_root/.pipeline.lock"
if [[ ! -e "$pipeline_lock" && ! -L "$pipeline_lock" ]]; then
  (set -o noclobber; umask 077; : > "$pipeline_lock") 2>/dev/null || true
fi
[[ -f "$pipeline_lock" && ! -L "$pipeline_lock" ]] || fail "the production pipeline lock is unsafe"
chmod 0600 -- "$pipeline_lock"
exec 8>>"$pipeline_lock"
flock -w "$pipeline_lock_wait_seconds" 8 \
  || fail "timed out waiting for another production database operation"

current_link="$deploy_root/current"
[[ -L "$current_link" ]] || fail "the production current link is unavailable"
current_release=$(readlink -f -- "$current_link") || fail "the production current link is broken"
case "$current_release" in
  "$deploy_root"/releases/*) ;;
  *) fail "the active release is outside the deployment release directory" ;;
esac
backup_script="$current_release/scripts/database-backup.mjs"
[[ -f "$backup_script" && ! -L "$backup_script" ]] \
  || fail "the active release cannot create a database backup"
identity_script="$current_release/scripts/verify-database-identities.mjs"
[[ -f "$identity_script" && ! -L "$identity_script" ]] \
  || fail "the active release cannot verify production database identities"

runtime_database_url=$(awk '
  $1 == "SetEnv" && $2 == "DATABASE_URL" {
    $1 = ""; $2 = ""; sub(/^[[:space:]]+/, ""); print; exit
  }
' "$passenger_config_file")
[[ "$runtime_database_url" == mysql://* && ${#runtime_database_url} -le 2048 ]] \
  || fail "the Passenger runtime database URL is unavailable"
DATABASE_URL="$runtime_database_url" \
MIGRATION_DATABASE_URL="$migration_database_url" \
MYSQL_BIN="$mysql_bin" \
  "$node_bin" "$identity_script" >/dev/null \
  || fail "the production runtime and migration database identities are not safely bound"
unset runtime_database_url

backup_result=$(
  DATABASE_URL="$migration_database_url" \
  BACKUP_DIRECTORY="$backup_directory" \
  BACKUP_FILE_PREFIX=mcap-production \
  BACKUP_ENCRYPTION_PASSPHRASE="$backup_passphrase" \
  MYSQL_BIN="$mysql_bin" \
  MYSQLDUMP_BIN="$mysqldump_bin" \
    "$node_bin" "$backup_script"
)
media_backup_result=$(
  MEDIA_ROOT="$media_root" \
  BACKUP_DIRECTORY="$backup_directory" \
  BACKUP_ENCRYPTION_PASSPHRASE="$backup_passphrase" \
    "$node_bin" "$media_backup_script"
) || fail "the encrypted product media backup failed"
unset backup_passphrase migration_database_url

backup_path=$(
  "$node_bin" -e '
    const result = JSON.parse(process.argv[1]);
    if (result.status !== "created" || typeof result.backupPath !== "string") process.exit(2);
    process.stdout.write(result.backupPath);
  ' "$backup_result"
) || fail "the backup command returned an invalid result"
manifest_path=$(
  "$node_bin" -e '
    const result = JSON.parse(process.argv[1]);
    if (result.status !== "created" || typeof result.manifestPath !== "string") process.exit(2);
    process.stdout.write(result.manifestPath);
  ' "$backup_result"
) || fail "the backup command returned an invalid manifest result"
media_backup_path=$("$node_bin" -e 'const r=JSON.parse(process.argv[1]); if(r.status!=="created"||typeof r.backupPath!=="string")process.exit(2); process.stdout.write(r.backupPath)' "$media_backup_result") \
  || fail "the media backup command returned an invalid result"
media_manifest_path=$("$node_bin" -e 'const r=JSON.parse(process.argv[1]); if(r.status!=="created"||typeof r.manifestPath!=="string")process.exit(2); process.stdout.write(r.manifestPath)' "$media_backup_result") \
  || fail "the media backup command returned an invalid manifest"
case "$media_backup_path" in "$backup_directory"/mcap-product-media-*.tar.gz.jwb) ;; *) fail "the media backup artifact path is unsafe" ;; esac
[[ "$media_manifest_path" == "$media_backup_path.json" && -f "$media_backup_path" && ! -L "$media_backup_path" && -f "$media_manifest_path" && ! -L "$media_manifest_path" ]] \
  || fail "the media backup artifact or manifest is unsafe"
[[ "$(stat -c '%a' -- "$media_backup_path")" == 600 && "$(stat -c '%a' -- "$media_manifest_path")" == 600 ]] \
  || fail "the media backup artifact permissions are not 0600"

case "$backup_path" in
  "$backup_directory"/mcap-*.sql.gz.jwb) ;;
  *) fail "the backup artifact path is outside the protected backup directory" ;;
esac
[[ "$manifest_path" == "$backup_path.json" ]] \
  || fail "the backup manifest path does not match the artifact"
[[ -f "$backup_path" && ! -L "$backup_path" ]] \
  || fail "the backup artifact is not a regular file"
[[ -f "$manifest_path" && ! -L "$manifest_path" ]] \
  || fail "the backup manifest is not a regular file"
[[ "$(stat -c '%a' -- "$backup_path")" == 600 ]] \
  || fail "the backup artifact permissions are not 0600"
[[ "$(stat -c '%a' -- "$manifest_path")" == 600 ]] \
  || fail "the backup manifest permissions are not 0600"

actual_sha256=$(sha256sum --binary "$backup_path" | awk '{ print $1 }')
safe_result=$(
  "$node_bin" "$normalizer" "$backup_path" "$manifest_path" "$actual_sha256"
) || fail "the completed backup failed manifest verification"
normalized_backup_file=$("$node_bin" -e 'const r=JSON.parse(process.argv[1]); if(r.status!=="created"||typeof r.file!=="string"||typeof r.manifest!=="string")process.exit(2); process.stdout.write(r.file)' "$safe_result") \
  || fail "the normalized backup result is invalid"
backup_path="$backup_directory/$normalized_backup_file"
manifest_path="$backup_path.json"
[[ -f "$backup_path" && ! -L "$backup_path" && -f "$manifest_path" && ! -L "$manifest_path" ]] \
  || fail "the normalized backup members are unsafe"

media_sha256=$(sha256sum --binary "$media_backup_path" | awk '{ print $1 }')
database_manifest_sha256=$(sha256sum --binary "$manifest_path" | awk '{ print $1 }')
media_manifest_sha256=$(sha256sum --binary "$media_manifest_path" | awk '{ print $1 }')
pair_manifest_path="$backup_directory/mcap-backup-pair-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
"$node_bin" -e '
  const { randomUUID } = require("node:crypto"); const fs=require("node:fs"); const path=require("node:path");
  const [target,dbPath,dbSha,dbManifest,dbManifestSha,mediaPath,mediaSha,mediaManifest,mediaManifestSha]=process.argv.slice(1); const partial=`${target}.partial`;
  const pair={format:"mcap-backup-pair-v1",pairId:randomUUID(),createdAt:new Date().toISOString(),database:{artifact:{file:path.basename(dbPath),sha256:dbSha},manifest:{file:path.basename(dbManifest),sha256:dbManifestSha}},media:{artifact:{file:path.basename(mediaPath),sha256:mediaSha},manifest:{file:path.basename(mediaManifest),sha256:mediaManifestSha}}};
  fs.writeFileSync(partial,`${JSON.stringify(pair,null,2)}\n`,{mode:0o600,flag:"wx"}); fs.renameSync(partial,target);
' "$pair_manifest_path" "$backup_path" "$actual_sha256" "$manifest_path" "$database_manifest_sha256" "$media_backup_path" "$media_sha256" "$media_manifest_path" "$media_manifest_sha256"
"$node_bin" -e 'import(process.argv[1]).then(m=>m.verifyBackupPair(process.argv[2])).catch(()=>process.exit(2))' \
  "file://$pair_verifier" "$pair_manifest_path" \
  || fail "the backup pair failed verification"

"$node_bin" -e 'const r=JSON.parse(process.argv[1]); const path=require("node:path"); console.log(JSON.stringify({...r,mediaFile:path.basename(process.argv[2]),mediaManifest:path.basename(process.argv[3]),pairManifest:path.basename(process.argv[4])}))' \
  "$safe_result" "$media_backup_path" "$media_manifest_path" "$pair_manifest_path"
