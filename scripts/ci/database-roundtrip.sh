#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"
: "${CI_ROOT_DATABASE_PASSWORD:?CI_ROOT_DATABASE_PASSWORD is required}"
: "${CI_DATABASE_USER:?CI_DATABASE_USER is required}"

restore_database=${CI_RESTORE_DATABASE:-mcap_finance_restore_test}
mysql_bin=${MYSQL_BIN:-mysql}
temp_root=$(readlink -f -- "${RUNNER_TEMP:-/tmp}")

[[ "$restore_database" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Unsafe restore database name" >&2; exit 1; }
[[ "$CI_DATABASE_USER" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Unsafe database user name" >&2; exit 1; }
command -v "$mysql_bin" >/dev/null
command -v "${MYSQLDUMP_BIN:-mysqldump}" >/dev/null

work_directory=$(mktemp -d "$temp_root/mcap-database-roundtrip.XXXXXXXX")
cleanup() {
  case "$work_directory" in
    "$temp_root"/mcap-database-roundtrip.*) rm -r -- "$work_directory" ;;
    *) echo "Refusing to clean an unexpected CI path: $work_directory" >&2 ;;
  esac
}
trap cleanup EXIT

root_defaults="$work_directory/root.cnf"
printf '[client]\nhost=127.0.0.1\nport=3306\nuser=root\npassword=%s\ndefault-character-set=utf8mb4\n' \
  "$CI_ROOT_DATABASE_PASSWORD" > "$root_defaults"

"$mysql_bin" --defaults-extra-file="$root_defaults" --execute="
  CREATE DATABASE \`$restore_database\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  GRANT ALL PRIVILEGES ON \`$restore_database\`.* TO '$CI_DATABASE_USER'@'%';
  FLUSH PRIVILEGES;
"

export BACKUP_DIRECTORY="$work_directory/backups"
backup_result=$(node scripts/database-backup.mjs)
backup_file=$(node -e '
  const result = JSON.parse(process.argv[1]);
  if (result.status !== "created" || !result.backupPath) process.exit(2);
  process.stdout.write(result.backupPath);
' "$backup_result")

restore_url=$(node -e '
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${process.argv[1]}`;
  process.stdout.write(url.toString());
' "$restore_database")

DATABASE_URL="$restore_url" \
BACKUP_FILE="$backup_file" \
RESTORE_CONFIRM="RESTORE:$restore_database" \
node scripts/database-restore.mjs
