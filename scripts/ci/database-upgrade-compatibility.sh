#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'mcap-upgrade-compatibility: %s\n' "$*" >&2; exit 1; }
log() { printf 'mcap-upgrade-compatibility: %s\n' "$*"; }

workspace=${GITHUB_WORKSPACE:-$(pwd)}
baseline_commit=${PRODUCTION_BASELINE_COMMIT:-}
expected_baseline_migrations=${PRODUCTION_BASELINE_MIGRATION_COUNT:-}
baseline_mode=${PRODUCTION_BASELINE_MODE:-historical}
[[ "$baseline_mode" == historical || "$baseline_mode" == deployed ]] || fail "unsupported baseline mode"

[[ -n "$baseline_commit" && "$baseline_commit" =~ ^[0-9a-f]{40}$ ]] \
  || fail "PRODUCTION_BASELINE_COMMIT must be a full 40-character commit"
[[ "$expected_baseline_migrations" =~ ^[1-9][0-9]*$ ]] \
  || fail "PRODUCTION_BASELINE_MIGRATION_COUNT must be a positive integer"
[[ -d "$workspace/.git" && -f "$workspace/package.json" ]] \
  || fail "GITHUB_WORKSPACE must identify the repository root"

node "$workspace/scripts/ci/selling-profile-db-gate.mjs" preflight-upgrade

git -C "$workspace" cat-file -e "${baseline_commit}^{commit}" \
  || fail "the production baseline commit is unavailable; checkout must use fetch-depth: 0"
git -C "$workspace" merge-base --is-ancestor "$baseline_commit" HEAD \
  || fail "the production baseline is not an ancestor of the candidate commit"

baseline_directory=$(mktemp -d "$workspace/apps/api/.upgrade-baseline.XXXXXXXX")
runtime_media_directory=$(mktemp -d "${RUNNER_TEMP:-/tmp}/mcap-upgrade-media.XXXXXXXX")
previous_pid=""
cleanup() {
  if [[ -n "$previous_pid" ]]; then
    kill -TERM "$previous_pid" 2>/dev/null || true
    wait "$previous_pid" 2>/dev/null || true
  fi
  case "$baseline_directory" in
    "$workspace"/apps/api/.upgrade-baseline.*)
      rm -rf -- "$baseline_directory"
      ;;
    *)
      fail "refusing to remove an unexpected baseline directory"
      ;;
  esac
  case "$runtime_media_directory" in
    "${RUNNER_TEMP:-/tmp}"/mcap-upgrade-media.*)
      rm -rf -- "$runtime_media_directory"
      ;;
    *)
      fail "refusing to remove an unexpected runtime media directory"
      ;;
  esac
}
trap cleanup EXIT

log "materializing the documented production baseline"
git -C "$workspace" archive --format=tar "$baseline_commit" \
  | tar -xf - -C "$baseline_directory"

if [[ "$baseline_mode" == deployed ]]; then
  log "aligning the disposable baseline test's engine allowlist with the pinned deployed host"
  node --input-type=module - "$baseline_directory/apps/api/tests/selling-profile.integration.test.ts" <<'NODE'
import { readFile, writeFile } from "node:fs/promises";

const path = process.argv[2];
const source = await readFile(path, "utf8");
const original = "expect(engine?.version).toMatch(/^(?:10\\.11\\..*MariaDB|8\\.4\\.)/i);";
const compatible = "expect(engine?.version).toMatch(/^(?:10\\.11\\..*MariaDB|11\\.4\\.13-MariaDB(?:[-.]|$)|8\\.4\\.)/i);";
if (!source.includes(original) || source.indexOf(original) !== source.lastIndexOf(original)) {
  throw new Error("Expected exactly one historical engine allowlist in the disposable deployed-baseline test");
}
await writeFile(path, source.replace(original, compatible));
NODE
fi

actual_baseline_migrations=$(find "$baseline_directory/apps/api/prisma/migrations" -mindepth 2 -maxdepth 2 -name migration.sql -type f | wc -l | tr -d '[:space:]')
[[ "$actual_baseline_migrations" == "$expected_baseline_migrations" ]] \
  || fail "the production baseline migration count changed unexpectedly"

prisma="$workspace/node_modules/.bin/prisma"
[[ -x "$prisma" ]] || fail "the candidate Prisma CLI is unavailable"

log "installing the exact locked production-baseline toolchain"
(
  cd "$baseline_directory" || fail "cannot enter the materialized production baseline"
  npm ci
  npm run prisma:generate
)
baseline_prisma="$baseline_directory/node_modules/.bin/prisma"
baseline_tsx="$baseline_directory/node_modules/.bin/tsx"
baseline_tsc="$baseline_directory/node_modules/.bin/tsc"
baseline_vitest="$baseline_directory/node_modules/.bin/vitest"
for executable in "$baseline_prisma" "$baseline_tsx" "$baseline_tsc" "$baseline_vitest"; do
  [[ -x "$executable" ]] || fail "required production-baseline executable is unavailable: $executable"
done

log "applying the production baseline migrations and representative fixtures"
(
  cd "$baseline_directory/apps/api" || fail "cannot enter the production-baseline API"
  "$baseline_prisma" migrate deploy --config prisma.config.ts
  "$baseline_prisma" migrate status --config prisma.config.ts
  "$baseline_tsx" prisma/seed.ts
  "$baseline_tsx" prisma/demo-seed.ts
)

if [[ "$baseline_mode" == deployed ]]; then
  log "recording the deployed R2 Inventory sentinel before baseline compatibility tests"
  R2_UPGRADE_SENTINEL_ITEM_ID=$(node "$workspace/scripts/ci/selling-profile-db-gate.mjs" prepare-deployed-upgrade)
  [[ "$R2_UPGRADE_SENTINEL_ITEM_ID" =~ ^[1-9][0-9]*$ ]] \
    || fail "the deployed-baseline R2 sentinel was not created"
  export R2_UPGRADE_SENTINEL_ITEM_ID
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    printf 'R2_UPGRADE_SENTINEL_ITEM_ID=%s\n' "$R2_UPGRADE_SENTINEL_ITEM_ID" >> "$GITHUB_ENV"
  fi
fi

log "proving the unchanged baseline on its own schema before candidate migrations"
(
  cd "$baseline_directory/apps/api" || fail "cannot enter the production-baseline API"
  "$baseline_tsc" -p tsconfig.json
  if [[ "$baseline_mode" == deployed ]]; then
    "$baseline_vitest" run tests/selling-profile.integration.test.ts --no-file-parallelism
  else
    "$baseline_vitest" run --no-file-parallelism
  fi
)

if [[ "$baseline_mode" == historical ]]; then
  log "recording an Inventory sentinel before the R2 migration exists"
  R2_UPGRADE_SENTINEL_ITEM_ID=$(node "$workspace/scripts/ci/selling-profile-db-gate.mjs" prepare-upgrade)
  [[ "$R2_UPGRADE_SENTINEL_ITEM_ID" =~ ^[1-9][0-9]*$ ]] \
    || fail "the pre-migration R2 sentinel was not created"
  export R2_UPGRADE_SENTINEL_ITEM_ID
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    printf 'R2_UPGRADE_SENTINEL_ITEM_ID=%s\n' "$R2_UPGRADE_SENTINEL_ITEM_ID" >> "$GITHUB_ENV"
  fi
fi

log "upgrading the populated baseline with the candidate migration history"
(
  cd "$workspace/apps/api" || fail "cannot enter the candidate API"
  "$prisma" migrate deploy --config prisma.config.ts
  "$prisma" migrate status --config prisma.config.ts
)

log "proving the sentinel survived and every R2 database test executed"
node "$workspace/scripts/ci/selling-profile-db-gate.mjs" run

log "building and testing the previous application against the upgraded schema"
(
  cd "$baseline_directory/apps/api" || fail "cannot enter the production-baseline API"
  "$baseline_tsc" -p tsconfig.json
  if [[ "$baseline_mode" == deployed ]]; then
    "$baseline_vitest" run tests/selling-profile.integration.test.ts --no-file-parallelism
  else
    "$baseline_vitest" run --no-file-parallelism
  fi
)

previous_log="$baseline_directory/previous-runtime.log"
cd "$baseline_directory" || fail "cannot enter the materialized production baseline"
NODE_ENV=production \
PORT=3101 \
WEB_ORIGIN=https://upgrade-compatibility.mcap.example \
SESSION_COOKIE_SECURE=true \
TRUST_PROXY=true \
SELF_REGISTRATION_ENABLED=false \
SERVE_WEB_ASSETS=false \
MEDIA_ROOT="$runtime_media_directory" \
RATE_LIMIT_IDENTITY_SECRET=CI-only-upgrade-runtime-rate-limit-secret-2026 \
node apps/api/dist/server.js >"$previous_log" 2>&1 &
previous_pid=$!
cd "$workspace" || fail "cannot return to the candidate workspace"

for _ in $(seq 1 30); do
  if curl --silent --fail http://127.0.0.1:3101/ready >/dev/null; then
    break
  fi
  if ! kill -0 "$previous_pid" 2>/dev/null; then
    sed -n '1,200p' "$previous_log" >&2
    fail "the previous application stopped against the upgraded schema"
  fi
  sleep 1
done
curl --silent --fail http://127.0.0.1:3101/live >/dev/null \
  || { sed -n '1,200p' "$previous_log" >&2; fail "the previous application is not live against the upgraded schema"; }
curl --silent --fail http://127.0.0.1:3101/ready >/dev/null \
  || { sed -n '1,200p' "$previous_log" >&2; fail "the previous application is not ready against the upgraded schema"; }

kill -TERM "$previous_pid"
wait "$previous_pid"
previous_pid=""
grep --fixed-strings 'api_shutdown_completed' "$previous_log" >/dev/null \
  || fail "the previous application did not shut down cleanly"

log "production-baseline upgrade and previous-application compatibility succeeded"
