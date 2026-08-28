import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../ci/database-upgrade-compatibility.sh", import.meta.url), "utf8");
const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const inventoryCostingMigration = await readFile(
  new URL("../../apps/api/prisma/migrations/20260826190000_inventory_weighted_average_costing/migration.sql", import.meta.url),
  "utf8",
);
const settlementFxMigration = await readFile(
  new URL("../../apps/api/prisma/migrations/20260826230000_realized_fx_settlements/migration.sql", import.meta.url),
  "utf8",
);

test("upgrade compatibility starts from a pinned production ancestor and populated fixtures", () => {
  assert.match(script, /PRODUCTION_BASELINE_COMMIT/u);
  assert.match(script, /PRODUCTION_BASELINE_MIGRATION_COUNT/u);
  assert.match(script, /merge-base --is-ancestor/u);
  assert.match(script, /git -C "\$workspace" archive/u);
  assert.match(script, /npm ci/u);
  assert.match(script, /npm run prisma:generate/u);
  assert.match(script, /"\$baseline_tsx" prisma\/seed\.ts/u);
  assert.match(script, /"\$baseline_tsx" prisma\/demo-seed\.ts/u);

  const baselineMigration = script.indexOf('"$baseline_prisma" migrate deploy --config prisma.config.ts');
  const candidateUpgrade = script.indexOf('cd "$workspace/apps/api"');
  assert.ok(baselineMigration > 0);
  assert.ok(candidateUpgrade > baselineMigration, "candidate migrations must follow the populated production baseline");
});

test("upgrade compatibility proves the previous application on the advanced schema", () => {
  const candidateUpgrade = script.indexOf('cd "$workspace/apps/api"');
  const previousTests = script.indexOf('"$baseline_vitest" run --no-file-parallelism');
  const previousRuntime = script.indexOf("node apps/api/dist/server.js");
  assert.ok(previousTests > candidateUpgrade);
  assert.ok(previousRuntime > previousTests);
  assert.match(script, /127\.0\.0\.1:3101\/ready/u);
  assert.match(script, /api_shutdown_completed/u);
  assert.doesNotMatch(script, /migrate reset|db push/u);
});

test("CI runs the upgrade gate on both supported release engines", () => {
  assert.match(workflow, /migration-upgrade-compatibility:/u);
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /MariaDB 10\.11/u);
  assert.match(workflow, /MySQL 8\.4/u);
  assert.match(workflow, /bash scripts\/ci\/database-upgrade-compatibility\.sh/u);
  assert.match(
    workflow,
    /needs: \[hosting-compatibility, migration-upgrade-compatibility, verify\]/u,
    "production deployment must wait for the populated upgrade gate",
  );
  assert.match(
    workflow,
    /shellcheck --shell=bash --severity=warning[\s\S]*scripts\/ci\/database-upgrade-compatibility\.sh/u,
  );
});

test("expand migrations preserve writes from the previous production application", () => {
  assert.match(inventoryCostingMigration, /unit_cost_base` DECIMAL\(19,8\) NOT NULL DEFAULT 0\.00000000/u);
  assert.match(inventoryCostingMigration, /total_cost_base` DECIMAL\(19,4\) NOT NULL DEFAULT 0\.0000/u);
  assert.match(inventoryCostingMigration, /is_cost_initialized` BOOLEAN NOT NULL DEFAULT FALSE/u);
  assert.doesNotMatch(
    inventoryCostingMigration,
    /MODIFY `is_valuation_initialized` BOOLEAN NOT NULL DEFAULT TRUE/u,
    "an old writer must not silently mark newly stocked balances as valued",
  );

  assert.match(settlementFxMigration, /original_base_amount` DECIMAL\(19,4\) NOT NULL DEFAULT 0\.0000/u);
  assert.match(settlementFxMigration, /outstanding_base_amount` DECIMAL\(19,4\) NOT NULL DEFAULT 0\.0000/u);
  assert.match(settlementFxMigration, /`original_base_amount` = 0 AND `outstanding_base_amount` = 0/u);
  assert.doesNotMatch(
    settlementFxMigration,
    /CREATE TRIGGER/u,
    "shared-host migration users must not require SUPER or trusted function creators",
  );
});
