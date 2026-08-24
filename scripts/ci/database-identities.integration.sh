#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${CI_ROOT_DATABASE_PASSWORD:?CI_ROOT_DATABASE_PASSWORD is required}"

mysql_bin=${MYSQL_BIN:-mysql}
temp_root=$(readlink -f -- "${RUNNER_TEMP:-/tmp}")
database_name=$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).pathname.slice(1))')
runtime_user=mcap_runtime_policy
migration_user=mcap_migration_policy
runtime_password=runtime_policy_password_2026
migration_password=migration_policy_password_2026

[[ "$database_name" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Unsafe database name" >&2; exit 1; }
command -v "$mysql_bin" >/dev/null

work_directory=$(mktemp -d "$temp_root/mcap-database-identities.XXXXXXXX")
root_defaults="$work_directory/root.cnf"
runtime_defaults="$work_directory/runtime.cnf"
cleanup() {
  if [[ -f "$root_defaults" ]]; then
    "$mysql_bin" --defaults-extra-file="$root_defaults" --execute="
      DROP TABLE IF EXISTS \`$database_name\`.mcap_identity_policy_probe;
      DROP USER IF EXISTS '$runtime_user'@'%';
      DROP USER IF EXISTS '$migration_user'@'%';
    " >/dev/null 2>&1 || true
  fi
  case "$work_directory" in
    "$temp_root"/mcap-database-identities.*) rm -r -- "$work_directory" ;;
    *) echo "Refusing to clean an unexpected CI path: $work_directory" >&2 ;;
  esac
}
trap cleanup EXIT

printf '[client]\nhost=127.0.0.1\nport=3306\nuser=root\npassword=%s\ndefault-character-set=utf8mb4\n' \
  "$CI_ROOT_DATABASE_PASSWORD" > "$root_defaults"
printf '[client]\nhost=127.0.0.1\nport=3306\nuser=%s\npassword=%s\ndefault-character-set=utf8mb4\n' \
  "$runtime_user" "$runtime_password" > "$runtime_defaults"

"$mysql_bin" --defaults-extra-file="$root_defaults" --execute="
  DROP USER IF EXISTS '$runtime_user'@'%';
  DROP USER IF EXISTS '$migration_user'@'%';
  CREATE USER '$runtime_user'@'%' IDENTIFIED BY '$runtime_password';
  CREATE USER '$migration_user'@'%' IDENTIFIED BY '$migration_password';
  GRANT SELECT, INSERT, UPDATE, DELETE ON \`$database_name\`.* TO '$runtime_user'@'%';
  GRANT ALL PRIVILEGES ON \`$database_name\`.* TO '$migration_user'@'%';
"

runtime_url="mysql://$runtime_user:$runtime_password@127.0.0.1:3306/$database_name"
migration_url="mysql://$migration_user:$migration_password@127.0.0.1:3306/$database_name"
report=$(DATABASE_URL="$runtime_url" MIGRATION_DATABASE_URL="$migration_url" MYSQL_BIN="$mysql_bin" \
  node scripts/verify-database-identities.mjs)
node -e '
  const report = JSON.parse(process.argv[1]);
  if (report.status !== "verified" || !report.sameDatabase || !report.distinctIdentities) process.exit(1);
' "$report"

if "$mysql_bin" --defaults-extra-file="$runtime_defaults" "$database_name" \
    --execute='CREATE TABLE mcap_identity_policy_probe (id INT PRIMARY KEY)' >/dev/null 2>&1; then
  echo "Runtime identity unexpectedly created a table" >&2
  exit 1
fi

failure_output="$work_directory/failure.log"
if DATABASE_URL="$runtime_url" MIGRATION_DATABASE_URL="$runtime_url" MYSQL_BIN="$mysql_bin" \
    node scripts/verify-database-identities.mjs >"$failure_output" 2>&1; then
  echo "Shared runtime and migration identities were unexpectedly accepted" >&2
  exit 1
fi
grep --fixed-strings 'DATABASE_IDENTITIES_NOT_DISTINCT' "$failure_output" >/dev/null
for sensitive_value in "$runtime_user" "$migration_user" "$runtime_password" "$migration_password" "127.0.0.1"; do
  if grep --fixed-strings "$sensitive_value" "$failure_output" >/dev/null; then
    echo "Database identity verifier leaked connection details" >&2
    exit 1
  fi
done

printf '%s\n' "$report"
