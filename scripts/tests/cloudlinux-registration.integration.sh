#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

resolved_temp_root=$(readlink -f -- "${RUNNER_TEMP:-/tmp}")
test_root=$(mktemp -d "$resolved_temp_root/mcap-cloudlinux-switch.XXXXXXXX")
cleanup() {
  case "$test_root" in
    "$resolved_temp_root"/mcap-cloudlinux-switch.*) rm -r -- "$test_root" ;;
    *) printf 'Refusing to clean unexpected test path: %s\n' "$test_root" >&2 ;;
  esac
}
trap cleanup EXIT

home_root="$test_root/home/tester"
source_release="$home_root/apps/releases/source"
target_release="$home_root/apps/releases/target"
backup_directory="$home_root/apps/recovery-backups"
passenger_config="$home_root/site/.htaccess"
fake_bin="$test_root/bin"
state_root="$test_root/active-root"
state_environment="$test_root/environment.json"
metrics_token_file="$test_root/metrics-token"
mkdir -p -- "$source_release/apps/api/dist" "$target_release/apps/api/dist" \
  "$(dirname -- "$passenger_config")" "$fake_bin"
touch -- "$source_release/apps/api/dist/server.js" "$target_release/apps/api/dist/server.js"
printf 'PassengerAppRoot "%s"\n' "$source_release" > "$passenger_config"
chmod 0644 -- "$passenger_config"
printf '%s\n' 'apps/releases/source' > "$state_root"
printf '%s\n' '{"DATABASE_URL":"mysql://fixture","WEB_ORIGIN":"https://example.test","SESSION_COOKIE_SECURE":"true","TRUST_PROXY":"true","METRICS_ENABLED":"false"}' \
  > "$state_environment"
printf '%s' 'fixture-metrics-token-12345678901234567890' > "$metrics_token_file"
chmod 0600 -- "$metrics_token_file"

cat > "$fake_bin/cloudlinux-selector" <<'FAKE_SELECTOR'
#!/usr/bin/env bash
set -Eeuo pipefail

operation=${1:-get}
shift || true
app_root=
domain=example.test
startup_file=apps/api/dist/server.js
environment_json='{}'
while (($#)); do
  case "$1" in
    --app-root) app_root=$2; shift 2 ;;
    --domain) domain=$2; shift 2 ;;
    --startup-file) startup_file=$2; shift 2 ;;
    --env-vars) environment_json=$2; shift 2 ;;
    *) shift ;;
  esac
done

chmod 0600 -- "$FAKE_PASSENGER_CONFIG"
case "$operation" in
  get)
    active_root=$(<"$FAKE_STATE_ROOT")
    environment_json=$(<"$FAKE_STATE_ENVIRONMENT")
    "$FAKE_NODE_BIN" -e '
      const root = process.argv[1];
      const environment = JSON.parse(process.argv[2]);
      const applications = root ? {
        [root]: {
          app_mode: "production",
          app_status: "started",
          app_uri: "",
          domain: "example.test",
          env_vars: environment,
          startup_file: "apps/api/dist/server.js",
        },
      } : {};
      console.log(JSON.stringify({
        result: "success",
        available_versions: { "22.23.2": { users: { tester: { applications } } } },
      }));
    ' "$active_root" "$environment_json"
    ;;
  destroy)
    [[ "$(<"$FAKE_STATE_ROOT")" == "$app_root" ]] || { printf '%s\n' '{"result":"missing"}'; exit 2; }
    : > "$FAKE_STATE_ROOT"
    printf '%s\n' '{"result":"success"}'
    ;;
  create)
    if [[ -n "${FAKE_FAIL_CREATE_ROOT:-}" && "$app_root" == "$FAKE_FAIL_CREATE_ROOT" ]]; then
      printf '%s\n' '{"result":"fixture-create-failure"}'
      exit 3
    fi
    [[ -z "$(<"$FAKE_STATE_ROOT")" ]] || { printf '%s\n' '{"result":"conflict"}'; exit 4; }
    printf '%s\n' "$app_root" > "$FAKE_STATE_ROOT"
    printf '%s\n' "$environment_json" > "$FAKE_STATE_ENVIRONMENT"
    printf '%s\n' '{"result":"success"}'
    ;;
  restart)
    [[ "$(<"$FAKE_STATE_ROOT")" == "$app_root" ]] || { printf '%s\n' '{"result":"missing"}'; exit 5; }
    printf '%s\n' '{"result":"success"}'
    ;;
  *)
    printf '%s\n' '{"result":"unsupported"}'
    exit 6
    ;;
esac
FAKE_SELECTOR
chmod 0700 -- "$fake_bin/cloudlinux-selector"
[[ -x "$fake_bin/cloudlinux-selector" ]]

export FAKE_STATE_ROOT="$state_root"
export FAKE_STATE_ENVIRONMENT="$state_environment"
export FAKE_PASSENGER_CONFIG="$passenger_config"
FAKE_NODE_BIN=${NODE_BIN:-$(command -v node)}
export FAKE_NODE_BIN
[[ -x "$FAKE_NODE_BIN" ]]

run_switch() {
  MCAP_CLOUDLINUX_SELECTOR="$fake_bin/cloudlinux-selector" \
  MCAP_NODE_BIN="$FAKE_NODE_BIN" \
  MCAP_CLOUDLINUX_USER=tester \
  MCAP_CLOUDLINUX_HOME="$home_root" \
  MCAP_CLOUDLINUX_DOMAIN=example.test \
  MCAP_CLOUDLINUX_VERSION=22.23.2 \
  MCAP_CLOUDLINUX_PASSENGER_LOG_FILE="$home_root/logs/passenger.log" \
  MCAP_CLOUDLINUX_BACKUP_DIRECTORY="$backup_directory" \
  MCAP_PASSENGER_CONFIG_FILE="$passenger_config" \
  MCAP_METRICS_TOKEN_FILE="${3:-}" \
    bash deploy/scripts/switch-cloudlinux-registration.sh "$1" "$2"
}

run_switch "$source_release" "$target_release" "$metrics_token_file"
[[ "$(<"$state_root")" == apps/releases/target ]]
"$FAKE_NODE_BIN" -e '
  const fs = require("node:fs");
  const environment = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (environment.METRICS_ENABLED !== "true" || environment.METRICS_BEARER_TOKEN !== "fixture-metrics-token-12345678901234567890") process.exit(1);
' "$state_environment"
[[ "$(stat -c '%a' -- "$passenger_config")" == 644 ]]
[[ -n "$(find "$backup_directory" -maxdepth 1 -type f -name 'selector-before-target-*.json' -print -quit)" ]]
[[ "$(grep -Fc '# BEGIN MCAP HTTPS REDIRECT' "$passenger_config")" == 1 ]]
grep -Fq 'RewriteCond %{HTTPS} !=on' "$passenger_config"
grep -Fq 'RewriteCond %{HTTP:X-Forwarded-Proto} !^https$ [NC]' "$passenger_config"
grep -Fq 'RewriteRule ^ https://example.test%{REQUEST_URI} [R=308,L,NE]' "$passenger_config"
if grep -Fq '%{HTTP_HOST}' "$passenger_config"; then
  printf 'HTTPS redirect must not trust the incoming Host header\n' >&2
  exit 1
fi

rm -f -- "$metrics_token_file"
run_switch "$target_release" "$source_release"
[[ "$(<"$state_root")" == apps/releases/source ]]
[[ "$(stat -c '%a' -- "$passenger_config")" == 644 ]]
[[ "$(grep -Fc '# BEGIN MCAP HTTPS REDIRECT' "$passenger_config")" == 1 ]]

export FAKE_FAIL_CREATE_ROOT=apps/releases/target
config_before_failed_switch=$(sha256sum -- "$passenger_config" | awk '{print $1}')
if run_switch "$source_release" "$target_release"; then
  printf 'CloudLinux switch unexpectedly succeeded when target creation failed\n' >&2
  exit 1
fi
unset FAKE_FAIL_CREATE_ROOT
[[ "$(<"$state_root")" == apps/releases/source ]]
[[ "$(stat -c '%a' -- "$passenger_config")" == 644 ]]
[[ "$(sha256sum -- "$passenger_config" | awk '{print $1}')" == "$config_before_failed_switch" ]]
