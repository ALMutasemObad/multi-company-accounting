#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

fail() { printf 'mcap-cpanel-deploy: %s\n' "$*" >&2; exit 1; }
log() { printf 'mcap-cpanel-deploy: %s\n' "$*"; }

archive_input=${1:-}
expected_sha=${2:-${MCAP_RELEASE_SHA256:-}}
deploy_root=${MCAP_DEPLOY_ROOT:-}
node_bin=${MCAP_NODE_BIN:-/opt/alt/alt-nodejs22/root/usr/bin/node}
npx_cli=${MCAP_NPX_CLI:-/opt/alt/alt-nodejs22/root/usr/lib/node_modules/npm/bin/npx-cli.js}
curl_bin=${MCAP_CURL_BIN:-/usr/bin/curl}
health_url=${MCAP_HEALTH_URL:-}
app_url=${MCAP_APP_URL:-}
passenger_config_file=${MCAP_PASSENGER_CONFIG_FILE:-}
cloudlinux_switcher=${MCAP_CLOUDLINUX_SWITCHER:-}
health_attempts=${MCAP_HEALTH_ATTEMPTS:-30}
run_database_migrations=${MCAP_RUN_DATABASE_MIGRATIONS:-false}

[[ -n "$archive_input" ]] || fail "usage: install-cpanel-release.sh <archive.tgz> <trusted-sha256>"
[[ "$deploy_root" == /* && "$deploy_root" != / ]] || fail "MCAP_DEPLOY_ROOT must be an explicit absolute non-root path"
[[ "$health_url" == https://* ]] || fail "MCAP_HEALTH_URL must be an HTTPS readiness URL"
[[ "$app_url" == https://* && "$app_url" != *\?* && "$app_url" != *\#* ]] || fail "MCAP_APP_URL must be an HTTPS application URL without a query or fragment"
app_url=${app_url%/}
http_app_url="http://${app_url#https://}"
[[ "$passenger_config_file" == /* && "$passenger_config_file" != / ]] || fail "MCAP_PASSENGER_CONFIG_FILE must be an explicit absolute non-root path"
[[ -f "$passenger_config_file" && ! -L "$passenger_config_file" ]] || fail "Passenger configuration must be a regular non-symlink file"
if [[ -n "$cloudlinux_switcher" ]]; then
  [[ "$cloudlinux_switcher" == /* && -f "$cloudlinux_switcher" && ! -L "$cloudlinux_switcher" ]] \
    || fail "MCAP_CLOUDLINUX_SWITCHER must be an explicit regular file"
fi
[[ "$expected_sha" =~ ^[0-9a-fA-F]{64}$ ]] || fail "a trusted SHA-256 value is required"
[[ "$health_attempts" =~ ^[1-9][0-9]{0,2}$ ]] || fail "MCAP_HEALTH_ATTEMPTS must be between 1 and 999"
[[ "$run_database_migrations" == true || "$run_database_migrations" == false ]] || fail "MCAP_RUN_DATABASE_MIGRATIONS must be true or false"
[[ -x "$node_bin" ]] || fail "Node executable is unavailable: $node_bin"
[[ -x "$curl_bin" ]] || fail "curl executable is unavailable: $curl_bin"
if [[ "$run_database_migrations" == true ]]; then
  [[ -f "$npx_cli" && ! -L "$npx_cli" ]] || fail "npm exec entrypoint is unavailable: $npx_cli"
  [[ "${DATABASE_URL:-}" == mysql://* ]] || fail "DATABASE_URL must be a MySQL URL when migrations are enabled"
fi

archive=$(readlink -f -- "$archive_input") || fail "release archive does not exist"
[[ -f "$archive" && ! -L "$archive_input" ]] || fail "release archive must be a regular non-symlink file"
actual_sha=$(sha256sum -- "$archive" | awk '{print $1}')
[[ "${actual_sha,,}" == "${expected_sha,,}" ]] || fail "release archive SHA-256 mismatch"

releases_dir="$deploy_root/releases"
current_link="$deploy_root/current"
previous_link="$deploy_root/previous"
mkdir -p -- "$releases_dir"
exec 9>"$releases_dir/.deploy.lock"
flock -n 9 || fail "another deployment operation is running"

tar -tzf "$archive" | while IFS= read -r entry; do
  clean=${entry#./}
  [[ -z "$clean" || "$clean" == . ]] && continue
  case "$clean" in
    /*|../*|*/../*|*/..) fail "archive contains an unsafe path: $entry" ;;
  esac
done

incoming=$(mktemp -d "$releases_dir/.incoming.XXXXXXXX")
cleanup() {
  case "${incoming:-}" in "$releases_dir"/.incoming.*) [[ -d "$incoming" ]] && rm -r -- "$incoming" ;; esac
}
trap cleanup EXIT
tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$incoming"
"$node_bin" "$incoming/scripts/release/verify-release.mjs" --root "$incoming"

release_id=$("$node_bin" -e '
  const manifest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (!/^[a-z0-9][a-z0-9._-]{0,159}$/.test(manifest.releaseId ?? "")) process.exit(2);
  process.stdout.write(manifest.releaseId);
' "$incoming/release-manifest.json") || fail "release identifier is invalid"
[[ "${MCAP_DEPLOY_CONFIRM:-}" == "DEPLOY:$release_id" ]] || fail "set MCAP_DEPLOY_CONFIRM=DEPLOY:$release_id"

release_dir="$releases_dir/$release_id"
[[ ! -e "$release_dir" && ! -L "$release_dir" ]] || fail "release already exists: $release_id"

if [[ "$run_database_migrations" == true ]]; then
  log "applying forward-compatible database migrations for $release_id"
  (
    cd "$incoming/apps/api"
    PATH="$(dirname -- "$node_bin"):${PATH:-/usr/bin:/bin}" \
      "$node_bin" "$npx_cli" --yes prisma@7.9.1 migrate deploy
  )
  log "seeding production reference data for $release_id"
  (
    cd "$incoming"
    "$node_bin" apps/api/dist/platform/seed-reference-data.js
  )
fi

mv -- "$incoming" "$release_dir"
incoming=""

resolve_release_link() {
  local link=$1 resolved
  [[ -L "$link" ]] || { [[ ! -e "$link" ]] && return 1; fail "$link exists but is not a symbolic link"; }
  resolved=$(readlink -f -- "$link") || fail "broken release link: $link"
  case "$resolved" in "$releases_dir"/*) printf '%s' "$resolved" ;; *) fail "release link escapes $releases_dir" ;; esac
}

atomic_link() {
  local target=$1 link=$2 temporary
  temporary="${link}.next.$$"
  [[ ! -e "$temporary" && ! -L "$temporary" ]] || fail "temporary deployment link already exists: $temporary"
  ln -s -- "$target" "$temporary"
  mv -Tf -- "$temporary" "$link"
}

activate_release() {
  local source_release=$1 target_release=$2
  if [[ -n "$cloudlinux_switcher" ]]; then
    bash "$cloudlinux_switcher" "$source_release" "$target_release"
    return
  fi
  touch -- "$target_release/tmp/restart.txt"
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
https_redirect_matches() {
  local expected_id=$1 probe_path headers status location
  probe_path="/ready?mcap_https_redirect_probe=$expected_id"
  headers=$(mktemp /tmp/mcap-https-headers.XXXXXX) || return 1
  if status=$("$curl_bin" --silent --show-error --max-time 5 --max-redirs 0 \
      --proto '=http' --output /dev/null --dump-header "$headers" \
      --write-out '%{http_code}' "$http_app_url$probe_path"); then
    location=$(awk 'BEGIN { IGNORECASE=1 } /^Location:/ {
      sub(/\r$/, ""); sub(/^[^:]+:[[:space:]]*/, ""); print; exit
    }' "$headers")
  else
    rm -f -- "$headers"
    return 1
  fi
  rm -f -- "$headers"
  case "$status" in 301|308) ;; *) return 1 ;; esac
  [[ "$location" == "$app_url$probe_path" ]]
}
wait_until_ready() {
  local expected_release=$1 expected_id=$2 require_https_redirect=${3:-true} attempt
  for ((attempt = 1; attempt <= health_attempts; attempt += 1)); do
    if "$curl_bin" --silent --show-error --fail --max-time 5 "$health_url" >/dev/null \
      && active_release_matches "$expected_release" "$expected_id"; then
      if [[ "$require_https_redirect" != true ]] || https_redirect_matches "$expected_id"; then return 0; fi
    fi
    sleep 1
  done
  return 1
}

old_release=""
if [[ -L "$current_link" ]]; then
  old_release=$(resolve_release_link "$current_link")
elif [[ -e "$current_link" ]]; then
  fail "$current_link exists but is not a symbolic link"
fi
if [[ -n "$old_release" ]]; then atomic_link "$old_release" "$previous_link"; fi
atomic_link "$release_dir" "$current_link"

activation_completed=false
if [[ -n "$old_release" ]] && activate_release "$old_release" "$release_dir"; then
  activation_completed=true
elif [[ -z "$old_release" && -z "$cloudlinux_switcher" ]] && activate_release "$release_dir" "$release_dir"; then
  activation_completed=true
fi

if [[ "$activation_completed" == true ]] && wait_until_ready "$release_dir" "$release_id"; then
  log "release $release_id is active and ready"
  exit 0
fi

log "release $release_id failed readiness checks"
if [[ -n "$old_release" ]]; then
  atomic_link "$old_release" "$current_link"
  if [[ "$activation_completed" == true ]]; then
    activate_release "$release_dir" "$old_release" || fail "automatic rollback could not restore the CloudLinux registration"
  else
    touch -- "$old_release/tmp/restart.txt"
    touch -- "$passenger_config_file"
  fi
  wait_until_ready "$old_release" "$(basename -- "$old_release")" false \
    || fail "automatic rollback completed but the previous release is not ready"
  log "rolled back automatically to $(basename -- "$old_release")"
else
  log "no previous release was available for automatic rollback"
fi
exit 1
