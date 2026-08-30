import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  PLATFORM_MODULE_CODES,
} from "../src/platform-subscriptions/platform-entitlement-ports.js";
import { PrismaCompanyEntitlementQueryAdapter } from "../src/platform-subscriptions/prisma-company-entitlement-query-adapter.js";

const migrationRoot = new URL(
  "../prisma/migrations/20260830060000_platform_subscription_foundation/",
  import.meta.url,
);

describe("platform subscription SUB-1 foundation", () => {
  it("adds isolated catalog, immutable plan-version, subscription, and entitlement models", async () => {
    const [migration, rollback, schema] = await Promise.all([
      readFile(new URL("migration.sql", migrationRoot), "utf8"),
      readFile(new URL("rollback.sql", migrationRoot), "utf8"),
      readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    ]);

    for (const table of [
      "platform_modules",
      "platform_module_dependencies",
      "platform_plans",
      "platform_plan_versions",
      "platform_plan_entitlements",
      "platform_subscriptions",
      "platform_subscription_entitlements",
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }
    for (const model of [
      "PlatformModule",
      "PlatformPlanVersion",
      "PlatformSubscription",
      "PlatformSubscriptionEntitlement",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(migration).toContain("platform_subscription_entitlements_subscription_fkey");
    expect(migration).toContain("REFERENCES `platform_subscriptions` (`id`, `company_id`)");
    expect(migration).not.toMatch(/DROP\s+(?:COLUMN|TABLE)\s+`?platform_billing/iu);
    expect(rollback).toContain("platform_subscription_rollback_refused_retain_plan_and_entitlement_history");
  });

  it("keeps stable module codes aligned with the seeded catalog and explicit dependencies", async () => {
    const migration = await readFile(new URL("migration.sql", migrationRoot), "utf8");
    const seededCodes = [...migration.matchAll(/^\s*\('([A-Z][A-Z0-9_]+)',\s*'[^']+',\s*(?:TRUE|FALSE),/gmu)]
      .map((match) => match[1]!)
      .sort();

    expect(seededCodes).toEqual([...PLATFORM_MODULE_CODES].sort());
    expect(migration).toContain("UNION ALL SELECT 'POS', 'SALES'");
    expect(migration).toContain("UNION ALL SELECT 'POS', 'TREASURY'");
    expect(migration).toContain("UNION ALL SELECT 'POS', 'INVENTORY'");
  });

  it("grandfathers every current company without changing its legacy billing history", async () => {
    const migration = await readFile(new URL("migration.sql", migrationRoot), "utf8");

    expect(migration).toContain("FROM `companies` company");
    expect(migration).toContain("LEFT JOIN `platform_billing_accounts` account");
    expect(migration).toContain("CONCAT('LEGACY_COMPANY_', company.`id`)");
    expect(migration).toContain("'GRANDFATHERED'");
    expect(migration).toContain("module.`is_active` = TRUE");
    expect(migration).not.toMatch(/(?:UPDATE|DELETE FROM)\s+`platform_billing_/iu);
  });
});

describe("PrismaCompanyEntitlementQueryAdapter", () => {
  it("reads one company scope and returns only active, effective, canonical modules", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 10n,
      companyId: 20n,
      status: "ACTIVE",
      version: 3,
      planVersion: {
        versionNumber: 2,
        displayName: "Basic",
        plan: { code: "BASIC" },
      },
      entitlements: [
        { module: { code: "SALES", dependencies: [] } },
        { module: { code: "SALES", dependencies: [] } },
        { module: { code: "UNKNOWN_FROM_FUTURE_DEPLOYMENT", dependencies: [] } },
      ],
    });
    const prisma = {
      platformSubscription: { findUnique },
    } as unknown as Pick<PrismaClient, "platformSubscription">;
    const adapter = new PrismaCompanyEntitlementQueryAdapter(prisma);
    const effectiveAt = new Date("2026-08-30T00:00:00.000Z");

    await expect(adapter.findCompanyEntitlements(20n, effectiveAt)).resolves.toEqual({
      subscriptionId: 10n,
      companyId: 20n,
      status: "ACTIVE",
      version: 3,
      plan: { code: "BASIC", versionNumber: 2, displayName: "Basic" },
      moduleCodes: ["SALES"],
    });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: 20n },
      select: expect.objectContaining({
        entitlements: expect.objectContaining({
          where: expect.objectContaining({
            effectiveFrom: { lte: effectiveAt },
            module: { isActive: true },
          }),
        }),
      }),
    }));
  });

  it("returns null when the selected company has no subscription", async () => {
    const prisma = {
      platformSubscription: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Pick<PrismaClient, "platformSubscription">;

    await expect(
      new PrismaCompanyEntitlementQueryAdapter(prisma).findCompanyEntitlements(999n),
    ).resolves.toBeNull();
  });

  it('fails closed when an entitled module is missing an active dependency', async () => {
    const baseSubscription = {
      id: 10n,
      companyId: 20n,
      status: 'ACTIVE',
      version: 3,
      planVersion: {
        versionNumber: 2,
        displayName: 'Point of sale',
        plan: { code: 'POS' },
      },
    };
    const incomplete = {
      platformSubscription: { findUnique: vi.fn().mockResolvedValue({
        ...baseSubscription,
        entitlements: [{ module: {
          code: 'POS',
          dependencies: [{ dependsOnModule: { code: 'SALES', isActive: true } }],
        } }],
      }) },
    } as unknown as Pick<PrismaClient, 'platformSubscription'>;
    const complete = {
      platformSubscription: { findUnique: vi.fn().mockResolvedValue({
        ...baseSubscription,
        entitlements: [
          { module: {
            code: 'POS',
            dependencies: [{ dependsOnModule: { code: 'SALES', isActive: true } }],
          } },
          { module: { code: 'SALES', dependencies: [] } },
        ],
      }) },
    } as unknown as Pick<PrismaClient, 'platformSubscription'>;

    await expect(new PrismaCompanyEntitlementQueryAdapter(incomplete)
      .findCompanyEntitlements(20n)).resolves.toMatchObject({ moduleCodes: [] });
    await expect(new PrismaCompanyEntitlementQueryAdapter(complete)
      .findCompanyEntitlements(20n)).resolves.toMatchObject({ moduleCodes: ['POS', 'SALES'] });
  });
});
