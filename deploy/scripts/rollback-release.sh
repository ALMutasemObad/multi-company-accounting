#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

fail() { printf 'mcap-rollback: %s\n' "$*" >&2; exit 1; }
log() { printf 'mcap-rollback: %s\n' "$*"; }

deploy_root=${MCAP_DEPLOY_ROOT:-/opt/mcap}
node_bin=${MCAP_NODE_BIN:-/usr/bin/node}
pm2_bin=${MCAP_PM2_BIN:-/usr/bin/pm2}
curl_bin=${MCAP_CURL_BIN:-/usr/bin/curl}
health_url=${MCAP_HEALTH_URL:-http://127.0.0.1:3000/ready}
health_attempts=${MCAP_HEALTH_ATTEMPTS:-30}

[[ "$deploy_root" == /* && "$deploy_root" != / ]] || fail "MCAP_DEPLOY_ROOT must be an absolute non-root path"
[[ "$health_attempts" =~ ^[1-9][0-9]{0,2}$ ]] || fail "MCAP_HEALTH_ATTEMPTS must be between 1 and 999"
[[ -x "$node_bin" && -x "$pm2_bin" && -x "$curl_bin" ]] || fail "Node, PM2, and curl must be executable"

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
  local target=$1 link=$2
  local temporary="${link}.next.$$"
  [[ ! -e "$temporary" && ! -L "$temporary" ]] || fail "temporary rollback link already exists: $temporary"
  ln -s -- "$target" "$temporary"
  mv -Tf -- "$temporary" "$link"
}

reload_api() {
  export MCAP_CURRENT_DIR="$current_link"
  "$pm2_bin" startOrReload "$current_link/ecosystem.config.cjs" --update-env
}

wait_until_ready() {
  local attempt
  for ((attempt = 1; attempt <= health_attempts; attempt += 1)); do
    if "$curl_bin" --silent --show-error --fail --max-time 3 "$health_url" >/dev/null; then return 0; fi
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
if reload_api && wait_until_ready; then
  atomic_link "$current_release" "$previous_link"
  log "release $rollback_id is active and ready; the replaced release remains available"
  exit 0
fi

atomic_link "$current_release" "$current_link"
reload_api || fail "rollback failed and PM2 could not restore the original release"
wait_until_ready || fail "rollback failed and the original release is not ready"
fail "rollback target failed readiness checks; restored $(basename -- "$current_release")"
