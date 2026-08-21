#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

fail() { printf 'mcap-cpanel-rollback: %s\n' "$*" >&2; exit 1; }
log() { printf 'mcap-cpanel-rollback: %s\n' "$*"; }

deploy_root=${MCAP_DEPLOY_ROOT:-}
node_bin=${MCAP_NODE_BIN:-/opt/alt/alt-nodejs22/root/usr/bin/node}
curl_bin=${MCAP_CURL_BIN:-/usr/bin/curl}
health_url=${MCAP_HEALTH_URL:-}
app_url=${MCAP_APP_URL:-}
passenger_config_file=${MCAP_PASSENGER_CONFIG_FILE:-}
health_attempts=${MCAP_HEALTH_ATTEMPTS:-30}

[[ "$deploy_root" == /* && "$deploy_root" != / ]] || fail "MCAP_DEPLOY_ROOT must be an explicit absolute non-root path"
[[ "$health_url" == https://* ]] || fail "MCAP_HEALTH_URL must be an HTTPS readiness URL"
[[ "$app_url" == https://* && "$app_url" != *\?* && "$app_url" != *\#* ]] || fail "MCAP_APP_URL must be an HTTPS application URL without a query or fragment"
app_url=${app_url%/}
[[ "$passenger_config_file" == /* && "$passenger_config_file" != / ]] || fail "MCAP_PASSENGER_CONFIG_FILE must be an explicit absolute non-root path"
[[ -f "$passenger_config_file" && ! -L "$passenger_config_file" ]] || fail "Passenger configuration must be a regular non-symlink file"
[[ "$health_attempts" =~ ^[1-9][0-9]{0,2}$ ]] || fail "MCAP_HEALTH_ATTEMPTS must be between 1 and 999"
[[ -x "$node_bin" && -x "$curl_bin" ]] || fail "Node and curl must be executable"

releases_dir="$deploy_root/releases"
current_link="$deploy_root/current"
previous_link="$deploy_root/previous"
[[ -d "$releases_dir" ]] || fail "release directory does not exist"
exec 9>"$releases_dir/.deploy.lock"
flock -n 9 || fail "another deployment operation is running"

resolve_release_link() {
  local link=$1 resolved
  [[ -L "$link" ]] || fail "required release link is missing: $link"
  resolved=$(readlink -f -- "$link") || fail "broken release link: $link"
  case "$resolved" in "$releases_dir"/*) printf '%s' "$resolved" ;; *) fail "release link escapes $releases_dir" ;; esac
}

atomic_link() {
  local target=$1 link=$2 temporary
  temporary="${link}.next.$$"
  [[ ! -e "$temporary" && ! -L "$temporary" ]] || fail "temporary rollback link already exists: $temporary"
  ln -s -- "$target" "$temporary"
  mv -Tf -- "$temporary" "$link"
}

restart_passenger() {
  touch -- "$current_link/tmp/restart.txt"
  touch -- "$passenger_config_file"
}
active_release_matches() {
  local expected_release=$1 expected_id=$2 expected_hash actual_hash
  [[ -f "$expected_release/apps/web/dist/index.html" && ! -L "$expected_release/apps/web/dist/index.html" ]] || return 1
  expected_hash=$(sha256sum -- "$expected_release/apps/web/dist/index.html" | awk '{print $1}')
  actual_hash=$("$curl_bin" --silent --show-error --fail --max-time 5 \
    "$app_url/?mcap_release_probe=$expected_id" | sha256sum | awk '{print $1}') || return 1
  [[ "$actual_hash" == "$expected_hash" ]]
}
wait_until_ready() {
  local expected_release=$1 expected_id=$2 attempt
  for ((attempt = 1; attempt <= health_attempts; attempt += 1)); do
    if "$curl_bin" --silent --show-error --fail --max-time 5 "$health_url" >/dev/null \
      && active_release_matches "$expected_release" "$expected_id"; then return 0; fi
    sleep 1
  done
  return 1
}

current_release=$(resolve_release_link "$current_link")
rollback_release=$(resolve_release_link "$previous_link")
[[ "$current_release" != "$rollback_release" ]] || fail "current and previous links point to the same release"
rollback_id=$(basename -- "$rollback_release")
[[ "${MCAP_ROLLBACK_CONFIRM:-}" == "ROLLBACK:$rollback_id" ]] || fail "set MCAP_ROLLBACK_CONFIRM=ROLLBACK:$rollback_id"
"$node_bin" "$rollback_release/scripts/release/verify-release.mjs" --root "$rollback_release"

atomic_link "$rollback_release" "$current_link"
if restart_passenger && wait_until_ready "$rollback_release" "$rollback_id"; then
  atomic_link "$current_release" "$previous_link"
  log "release $rollback_id is active and ready; the replaced release remains available"
  exit 0
fi

atomic_link "$current_release" "$current_link"
restart_passenger || fail "rollback failed and Passenger could not restart the original release"
wait_until_ready "$current_release" "$(basename -- "$current_release")" || fail "rollback failed and the original release is not ready"
fail "rollback target failed readiness checks; restored $(basename -- "$current_release")"
