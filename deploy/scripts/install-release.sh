#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

fail() { printf 'mcap-deploy: %s\n' "$*" >&2; exit 1; }
log() { printf 'mcap-deploy: %s\n' "$*"; }

archive_input=${1:-}
expected_sha=${2:-${MCAP_RELEASE_SHA256:-}}
deploy_root=${MCAP_DEPLOY_ROOT:-/opt/mcap}
node_bin=${MCAP_NODE_BIN:-/usr/bin/node}
pm2_bin=${MCAP_PM2_BIN:-/usr/bin/pm2}
curl_bin=${MCAP_CURL_BIN:-/usr/bin/curl}
health_url=${MCAP_HEALTH_URL:-http://127.0.0.1:3000/ready}
health_attempts=${MCAP_HEALTH_ATTEMPTS:-30}

[[ -n "$archive_input" ]] || fail "usage: install-release.sh <archive.tgz> <trusted-sha256>"
[[ "$deploy_root" == /* && "$deploy_root" != / ]] || fail "MCAP_DEPLOY_ROOT must be an absolute non-root path"
[[ "$expected_sha" =~ ^[0-9a-fA-F]{64}$ ]] || fail "a trusted SHA-256 value is required"
[[ "$health_attempts" =~ ^[1-9][0-9]{0,2}$ ]] || fail "MCAP_HEALTH_ATTEMPTS must be between 1 and 999"
[[ -x "$node_bin" ]] || fail "Node executable is unavailable: $node_bin"
[[ -x "$pm2_bin" ]] || fail "PM2 executable is unavailable: $pm2_bin"
[[ -x "$curl_bin" ]] || fail "curl executable is unavailable: $curl_bin"

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
mv -- "$incoming" "$release_dir"
incoming=""

resolve_release_link() {
  local link=$1 resolved
  [[ -L "$link" ]] || { [[ ! -e "$link" ]] && return 1; fail "$link exists but is not a symbolic link"; }
  resolved=$(readlink -f -- "$link") || fail "broken release link: $link"
  case "$resolved" in "$releases_dir"/*) printf '%s' "$resolved" ;; *) fail "release link escapes $releases_dir" ;; esac
}

atomic_link() {
  local target=$1 link=$2
  local temporary="${link}.next.$$"
  [[ ! -e "$temporary" && ! -L "$temporary" ]] || fail "temporary deployment link already exists: $temporary"
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

old_release=""
if [[ -L "$current_link" ]]; then
  old_release=$(resolve_release_link "$current_link")
elif [[ -e "$current_link" ]]; then
  fail "$current_link exists but is not a symbolic link"
fi
if [[ -n "$old_release" ]]; then atomic_link "$old_release" "$previous_link"; fi
atomic_link "$release_dir" "$current_link"

if reload_api && wait_until_ready; then
  log "release $release_id is active and ready"
  exit 0
fi

log "release $release_id failed readiness checks"
if [[ -n "$old_release" ]]; then
  atomic_link "$old_release" "$current_link"
  reload_api || fail "automatic rollback could not reload PM2"
  wait_until_ready || fail "automatic rollback completed but the previous release is not ready"
  log "rolled back automatically to $(basename -- "$old_release")"
else
  log "no previous release was available for automatic rollback"
fi
exit 1
