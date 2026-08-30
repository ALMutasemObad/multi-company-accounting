import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../prisma/migrations/20260830150000_platform_subscription_lifecycle/", import.meta.url);

describe("SUB-3 platform subscription lifecycle migration", () => {
  it("adds draft publication state, effective-dated history, frozen bundles, and guarded rollback", async () => {
    const [migration, rollback, schema] = await Promise.all([
      readFile(new URL("migration.sql", root), "utf8"),
      readFile(new URL("rollback.sql", root), "utf8"),
      readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    ]);
    expect(migration).toContain("CREATE TABLE `platform_subscription_changes`");
    expect(migration).toContain("CREATE TABLE `platform_subscription_change_modules`");
    expect(migration).toContain("`self_service_policy` ENUM('DISABLED', 'REQUEST_ONLY', 'IMMEDIATE_FREE')");
    expect(migration).toContain("MODIFY `published_at` DATETIME(3) NULL DEFAULT NULL");
    expect(migration).toContain("'Grandfathered effective state before SUB-3'");
    expect(migration).toContain("platform_subscription_changes_company_state_effective_idx");
    expect(migration).toContain("platform_plan_entitlements_selection_chk");
    expect(migration).toContain("platform_plans_created_by_fkey");
    expect(migration).toContain("platform_plan_versions_published_by_fkey");
    expect(schema).toContain("publishedAt                      DateTime?");
    expect(schema).toContain("publishedById                    BigInt?");
    expect(schema).toContain("version                          Int");
    expect(rollback).toContain("platform_subscription_lifecycle_rollback_refused_changes_exist");
    expect(rollback).toContain("platform_subscription_lifecycle_rollback_refused_catalog_changed");
  });

  it("seeds only unconfigured drafts and never invents a Basic price or publishes a template", async () => {
    const migration = await readFile(new URL("migration.sql", root), "utf8");
    expect(migration).toContain("CASE WHEN plan.`code` IN ('FREE', 'TRIAL') THEN 0 ELSE NULL END");
    expect(migration).toContain("'DISABLED', NULL, CURRENT_TIMESTAMP(3)");
    expect(migration).toContain("Configurable draft template");
    expect(migration).not.toMatch(/BASIC[^\n]{0,120}(?:[1-9][0-9]*\.[0-9]{1,4})/iu);
  });

  it("does not mutate platform billing, add payment secrets, or create an outbox without a consumer", async () => {
    const migration = await readFile(new URL("migration.sql", root), "utf8");
    expect(migration).not.toMatch(/(?:UPDATE|DELETE\s+FROM|ALTER\s+TABLE)\s+`platform_billing_/iu);
    expect(migration).not.toMatch(/(?:payment_secret|card_number|refund|dispute|webhook|outbox)/iu);
  });
});
