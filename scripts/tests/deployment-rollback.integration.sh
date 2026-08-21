#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

resolved_temp_root=$(readlink -f -- "${RUNNER_TEMP:-/tmp}")
test_root=$(mktemp -d "$resolved_temp_root/mcap-rollback-test.XXXXXXXX")
cleanup() {
  case "$test_root" in
    "$resolved_temp_root"/mcap-rollback-test.*) rm -r -- "$test_root" ;;
    *) echo "Refusing to clean an unexpected test path: $test_root" >&2 ;;
  esac
}
trap cleanup EXIT

deploy_root="$test_root/deploy"
bin_root="$test_root/bin"
mkdir -p "$deploy_root/releases/release-v1" "$deploy_root/releases/release-v2" "$bin_root"
touch "$deploy_root/releases/release-v1/ecosystem.config.cjs" "$deploy_root/releases/release-v2/ecosystem.config.cjs"
ln -s "$deploy_root/releases/release-v2" "$deploy_root/current"
ln -s "$deploy_root/releases/release-v1" "$deploy_root/previous"

printf '#!/usr/bin/env bash\nexit 0\n' > "$bin_root/node"
printf '#!/usr/bin/env bash\nexit 0\n' > "$bin_root/pm2"
printf '#!/usr/bin/env bash\nexit 0\n' > "$bin_root/curl"
chmod 700 "$bin_root/node" "$bin_root/pm2" "$bin_root/curl"

run_rollback() {
  MCAP_DEPLOY_ROOT="$deploy_root" \
  MCAP_NODE_BIN="$bin_root/node" \
  MCAP_PM2_BIN="$bin_root/pm2" \
  MCAP_CURL_BIN="$bin_root/curl" \
  MCAP_HEALTH_ATTEMPTS=1 \
  MCAP_ROLLBACK_CONFIRM=ROLLBACK:release-v1 \
  bash deploy/scripts/rollback-release.sh
}

run_rollback
[[ "$(readlink -f -- "$deploy_root/current")" == "$deploy_root/releases/release-v1" ]]
[[ "$(readlink -f -- "$deploy_root/previous")" == "$deploy_root/releases/release-v2" ]]

ln -sfn "$deploy_root/releases/release-v2" "$deploy_root/current"
ln -sfn "$deploy_root/releases/release-v1" "$deploy_root/previous"
counter_file="$test_root/curl-count"
printf '0\n' > "$counter_file"
cat > "$bin_root/curl" <<EOF
#!/usr/bin/env bash
count=\$(cat "$counter_file")
count=\$((count + 1))
printf '%s\n' "\$count" > "$counter_file"
[[ "\$count" -gt 1 ]]
EOF
chmod 700 "$bin_root/curl"

if run_rollback; then
  echo "Rollback unexpectedly succeeded when the target failed readiness" >&2
  exit 1
fi
[[ "$(readlink -f -- "$deploy_root/current")" == "$deploy_root/releases/release-v2" ]]
[[ "$(readlink -f -- "$deploy_root/previous")" == "$deploy_root/releases/release-v1" ]]
