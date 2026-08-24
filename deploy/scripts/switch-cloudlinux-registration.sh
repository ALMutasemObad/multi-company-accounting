#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'mcap-cloudlinux-switch: %s\n' "$*" >&2; exit 1; }
log() { printf 'mcap-cloudlinux-switch: %s\n' "$*"; }

source_release=${1:-}
target_release=${2:-}
selector=${MCAP_CLOUDLINUX_SELECTOR:-/usr/sbin/cloudlinux-selector}
node_bin=${MCAP_NODE_BIN:-/opt/alt/alt-nodejs22/root/usr/bin/node}
cloudlinux_user=${MCAP_CLOUDLINUX_USER:-}
cloudlinux_home=${MCAP_CLOUDLINUX_HOME:-}
cloudlinux_domain=${MCAP_CLOUDLINUX_DOMAIN:-}
cloudlinux_version=${MCAP_CLOUDLINUX_VERSION:-22.23.2}
cloudlinux_venv_home=${MCAP_CLOUDLINUX_VENV_HOME:-}
startup_file=${MCAP_CLOUDLINUX_STARTUP_FILE:-apps/api/dist/server.js}
passenger_log_file=${MCAP_CLOUDLINUX_PASSENGER_LOG_FILE:-}
passenger_config_file=${MCAP_PASSENGER_CONFIG_FILE:-}
backup_directory=${MCAP_CLOUDLINUX_BACKUP_DIRECTORY:-}

[[ "$source_release" == /* && "$target_release" == /* && "$source_release" != "$target_release" ]] \
  || fail "source and target releases must be different explicit absolute paths"
[[ "$cloudlinux_home" == /* && "$cloudlinux_home" != / ]] || fail "MCAP_CLOUDLINUX_HOME must be an explicit absolute non-root path"
[[ "$cloudlinux_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "MCAP_CLOUDLINUX_USER is invalid"
[[ "$cloudlinux_domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail "MCAP_CLOUDLINUX_DOMAIN is invalid"
[[ "$cloudlinux_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "MCAP_CLOUDLINUX_VERSION is invalid"
[[ "$startup_file" =~ ^[A-Za-z0-9._/-]+$ && "$startup_file" != /* && "$startup_file" != *..* ]] \
  || fail "MCAP_CLOUDLINUX_STARTUP_FILE is invalid"
[[ "$passenger_log_file" == /* && "$passenger_log_file" != / ]] || fail "MCAP_CLOUDLINUX_PASSENGER_LOG_FILE must be absolute"
[[ "$passenger_config_file" == /* && "$passenger_config_file" != / ]] || fail "MCAP_PASSENGER_CONFIG_FILE must be absolute"
[[ "$backup_directory" == /* && "$backup_directory" != / ]] || fail "MCAP_CLOUDLINUX_BACKUP_DIRECTORY must be absolute"
[[ -x "$selector" && -x "$node_bin" ]] || fail "CloudLinux Selector and Node must be executable"
[[ -f "$passenger_config_file" && ! -L "$passenger_config_file" ]] || fail "Passenger configuration must be a regular file"
[[ -d "$source_release" && ! -L "$source_release" && "$(readlink -f -- "$source_release")" == "$source_release" ]] \
  || fail "source release is invalid"
[[ -d "$target_release" && ! -L "$target_release" && "$(readlink -f -- "$target_release")" == "$target_release" ]] \
  || fail "target release is invalid"
[[ -f "$source_release/$startup_file" && ! -L "$source_release/$startup_file" ]] || fail "source startup file is invalid"
[[ -f "$target_release/$startup_file" && ! -L "$target_release/$startup_file" ]] || fail "target startup file is invalid"

case "$source_release" in "$cloudlinux_home"/*) ;; *) fail "source release is outside MCAP_CLOUDLINUX_HOME" ;; esac
case "$target_release" in "$cloudlinux_home"/*) ;; *) fail "target release is outside MCAP_CLOUDLINUX_HOME" ;; esac
source_root=${source_release#"$cloudlinux_home"/}
target_root=${target_release#"$cloudlinux_home"/}
[[ "$source_root" != "$target_root" && "$source_root" != /* && "$target_root" != /* ]] || fail "relative application roots are invalid"

if [[ -z "$cloudlinux_venv_home" ]]; then cloudlinux_venv_home="$cloudlinux_home/nodevenv"; fi
[[ "$cloudlinux_venv_home" == /* && "$cloudlinux_venv_home" != / ]] || fail "MCAP_CLOUDLINUX_VENV_HOME must be absolute"
node_major=${cloudlinux_version%%.*}
target_venv="$cloudlinux_venv_home/$target_root/$node_major"
[[ ! -e "$target_venv" && ! -L "$target_venv" ]] || fail "target CloudLinux virtualenv already exists"

mkdir -p -- "$backup_directory"
chmod 0700 -- "$backup_directory"
config_mode=$(stat -c '%a' -- "$passenger_config_file")
[[ "$config_mode" =~ ^[0-7]{3,4}$ ]] || fail "Passenger configuration mode is invalid"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
state_file=$(mktemp /tmp/mcap-cloudlinux-state.XXXXXX)
environment_file=$(mktemp /tmp/mcap-cloudlinux-environment.XXXXXX)
destroy_result=$(mktemp /tmp/mcap-cloudlinux-destroy.XXXXXX)
create_result=$(mktemp /tmp/mcap-cloudlinux-create.XXXXXX)
restart_result=$(mktemp /tmp/mcap-cloudlinux-restart.XXXXXX)
registry_backup="$backup_directory/selector-before-$(basename -- "$target_release")-$timestamp.json"
config_backup="$backup_directory/htaccess-before-$(basename -- "$target_release")-$timestamp"
rollback_required=false
https_redirect_temp=""
config_restore_temp=""

registered_root() {
  "$selector" get --json --interpreter nodejs --user "$cloudlinux_user" > "$state_file"
  "$node_bin" -e '
    const fs = require("node:fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const [version, user, domain, startup] = process.argv.slice(2);
    const apps = payload.available_versions?.[version]?.users?.[user]?.applications || {};
    const matches = Object.entries(apps).filter(([, app]) => app.domain === domain);
    if (payload.result !== "success" || matches.length > 1) process.exit(2);
    if (matches.length === 1) {
      if (matches[0][1].startup_file !== startup) process.exit(3);
      process.stdout.write(matches[0][0]);
    }
  ' "$state_file" "$cloudlinux_version" "$cloudlinux_user" "$cloudlinux_domain" "$startup_file"
}

validate_registered_environment() {
  local expected_root=$1
  "$node_bin" -e '
    const fs = require("node:fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const [version, user, root, domain, startup] = process.argv.slice(2);
    const app = payload.available_versions?.[version]?.users?.[user]?.applications?.[root];
    if (!app || app.domain !== domain || app.startup_file !== startup) process.exit(2);
    for (const key of ["DATABASE_URL", "WEB_ORIGIN", "SESSION_COOKIE_SECURE", "TRUST_PROXY"]) {
      if (!(key in (app.env_vars || {}))) process.exit(3);
    }
  ' "$state_file" "$cloudlinux_version" "$cloudlinux_user" "$expected_root" "$cloudlinux_domain" "$startup_file"
}

write_environment_snapshot() {
  "$node_bin" -e '
    const fs = require("node:fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const [output, version, user, root] = process.argv.slice(2);
    const app = payload.available_versions?.[version]?.users?.[user]?.applications?.[root];
    if (!app) process.exit(2);
    const environment = { ...app.env_vars };
    fs.writeFileSync(output, JSON.stringify(environment), { mode: 0o600 });
  ' "$state_file" "$environment_file" "$cloudlinux_version" "$cloudlinux_user" "$source_root"
}

summarize_result() {
  local operation=$1 result_file=$2 exit_code=$3
  "$node_bin" -e '
    const fs = require("node:fs");
    let payload;
    try { payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch { payload = { result: "invalid-json" }; }
    console.log(JSON.stringify({
      operation: process.argv[2],
      exit: Number(process.argv[3]),
      result: payload.result,
      warning: payload.warning,
      contextKeys: Object.keys(payload.context || {}).sort(),
    }));
    if (Number(process.argv[3]) !== 0 || payload.result !== "success") process.exit(2);
  ' "$result_file" "$operation" "$exit_code"
}

destroy_registration() {
  local root=$1 result_file=$2 command_exit
  if "$selector" destroy --json --interpreter nodejs --user "$cloudlinux_user" --app-root "$root" > "$result_file" 2>&1; then
    command_exit=0
  else
    command_exit=$?
  fi
  chmod "$config_mode" -- "$passenger_config_file" 2>/dev/null || true
  summarize_result destroy "$result_file" "$command_exit"
}

create_registration() {
  local root=$1 result_file=$2 command_exit environment_json
  environment_json=$(<"$environment_file")
  if "$selector" create --json --interpreter nodejs --domain "$cloudlinux_domain" \
      --app-root "$root" --app-uri '' --version "$cloudlinux_version" --app-mode production \
      --startup-file "$startup_file" --passenger-log-file "$passenger_log_file" \
      --env-vars "$environment_json" > "$result_file" 2>&1; then
    command_exit=0
  else
    command_exit=$?
  fi
  chmod "$config_mode" -- "$passenger_config_file" 2>/dev/null || true
  summarize_result create "$result_file" "$command_exit"
}

restart_registration() {
  local root=$1 result_file=$2 command_exit
  if "$selector" restart --json --interpreter nodejs --user "$cloudlinux_user" --app-root "$root" > "$result_file" 2>&1; then
    command_exit=0
  else
    command_exit=$?
  fi
  chmod "$config_mode" -- "$passenger_config_file" 2>/dev/null || true
  summarize_result restart "$result_file" "$command_exit"
}

ensure_https_redirect() {
  https_redirect_temp=$(mktemp "${passenger_config_file}.mcap-https.XXXXXXXX")
  "$node_bin" -e '
    const fs = require("node:fs");
    const [source, destination, domain] = process.argv.slice(1);
    if (!/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain)) process.exit(2);
    const start = "# BEGIN MCAP HTTPS REDIRECT";
    const end = "# END MCAP HTTPS REDIRECT";
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sourceText = fs.readFileSync(source, "utf8");
    const startCount = sourceText.split(start).length - 1;
    const endCount = sourceText.split(end).length - 1;
    if (startCount !== endCount || startCount > 1) process.exit(3);
    if (startCount === 1 && sourceText.indexOf(start) > sourceText.indexOf(end)) process.exit(3);
    const withoutManagedBlock = sourceText
      .replace(new RegExp(`${escape(start)}[\\s\\S]*?${escape(end)}\\s*`, "g"), "")
      .trimEnd();
    const block = [
      start,
      "# Managed by the verified deployment pipeline.",
      "<IfModule mod_rewrite.c>",
      "  RewriteEngine On",
      "  RewriteCond %{HTTPS} !=on",
      "  RewriteCond %{HTTP:X-Forwarded-Proto} !^https$ [NC]",
      `  RewriteRule ^ https://${domain}%{REQUEST_URI} [R=308,L,NE]`,
      "</IfModule>",
      end,
    ].join("\n");
    const output = `${withoutManagedBlock}${withoutManagedBlock ? "\n\n" : ""}${block}\n`;
    if (output.includes("%{HTTP_HOST}")) process.exit(4);
    fs.writeFileSync(destination, output, { encoding: "utf8", mode: 0o600 });
  ' "$passenger_config_file" "$https_redirect_temp" "$cloudlinux_domain"
  chmod "$config_mode" -- "$https_redirect_temp"
  mv -f -- "$https_redirect_temp" "$passenger_config_file"
  https_redirect_temp=""
}

restore_passenger_config() {
  [[ -f "$config_backup" && ! -L "$config_backup" ]] || return 1
  config_restore_temp=$(mktemp "${passenger_config_file}.mcap-restore.XXXXXXXX")
  cp -- "$config_backup" "$config_restore_temp"
  chmod "$config_mode" -- "$config_restore_temp"
  mv -f -- "$config_restore_temp" "$passenger_config_file"
  config_restore_temp=""
}

restore_source_registration() {
  local active_root
  set +e
  active_root=$(registered_root 2>/dev/null)
  if [[ "$active_root" == "$target_root" ]]; then
    destroy_registration "$target_root" "$destroy_result" >/dev/null 2>&1
    active_root=$(registered_root 2>/dev/null)
  fi
  if [[ -z "$active_root" ]]; then
    create_registration "$source_root" "$create_result" >/dev/null 2>&1
    active_root=$(registered_root 2>/dev/null)
  fi
  chmod "$config_mode" -- "$passenger_config_file" 2>/dev/null || true
  if [[ "$active_root" == "$source_root" ]]; then
    restore_passenger_config || return 1
    restart_registration "$source_root" "$restart_result" >/dev/null 2>&1
    log "restored source registration $source_root"
    return 0
  fi
  log "could not restore source registration $source_root"
  return 1
}

cleanup() {
  local status=$1
  set +e
  if [[ "$status" != 0 && "$rollback_required" == true ]]; then restore_source_registration; fi
  rm -f -- "$state_file" "$environment_file" "$destroy_result" "$create_result" "$restart_result"
  [[ -z "$https_redirect_temp" ]] || rm -f -- "$https_redirect_temp"
  [[ -z "$config_restore_temp" ]] || rm -f -- "$config_restore_temp"
  exit "$status"
}
trap 'status=$?; trap - EXIT; cleanup "$status"' EXIT

[[ "$(registered_root)" == "$source_root" ]] || fail "registered production root does not match the source release"
validate_registered_environment "$source_root"
cp -p -- "$state_file" "$registry_backup"
chmod 0600 -- "$registry_backup"
cp -p -- "$passenger_config_file" "$config_backup"
chmod 0600 -- "$config_backup"
write_environment_snapshot
log "validated source registration without revealing environment values"

rollback_required=true
destroy_registration "$source_root" "$destroy_result"
[[ -z "$(registered_root)" ]] || fail "source registration still exists after destroy"
create_registration "$target_root" "$create_result"
[[ "$(registered_root)" == "$target_root" ]] || fail "target registration was not created"
validate_registered_environment "$target_root"
restart_registration "$target_root" "$restart_result"
ensure_https_redirect
rollback_required=false

log "registered $(basename -- "$target_release") and preserved recoverable configuration backups"
