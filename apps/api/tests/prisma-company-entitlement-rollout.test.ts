import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createDatabase } from "../src/database.js";
import { PrismaCompanySubscriptionProvisioningAdapter } from "../src/platform-subscriptions/prisma-company-subscription-provisioning-adapter.js";
import { PrismaCompanyEntitlementQueryAdapter } from "../src/platform-subscriptions/prisma-company-entitlement-query-adapter.js";
import { PLATFORM_WIDE_FREE_MODULE_CODES } from "../src/platform-subscriptions/platform-wide-free-module-policy.js";

const migrationRoot = new URL(
  "../prisma/migrations/20261009000000_platform_wide_free_modules/",
  import.meta.url,
);

function moduleRow(id: bigint, code: string, dependencies: Array<{ id: bigint; code: string; isActive: boolean }> = []) {
  return {
    id,
    code,
    isActive: true,
    dependencies: dependencies.map((dependsOnModule) => ({ dependsOnModule })),
  };
}

function subscriptionRow(entitlements: Array<{ id: bigint; code: string }>) {
  return {
    id: 71n,
    companyId: 41n,
    status: "ACTIVE",
    version: 2,
    planVersion: {
      versionNumber: 4,
      displayName: "Free",
      plan: { code: "FREE" },
    },
    changes: [],
    entitlements: entitlements.map(({ id, code }) => ({
      module: { ...moduleRow(id, code), dependencies: [] },
    })),
  };
}

function adapterFor(
  entitlements: Array<{ id: bigint; code: string }>,
  rolloutModules: ReturnType<typeof moduleRow>[],
) {
  const findUnique = vi.fn().mockResolvedValue(subscriptionRow(entitlements));
  const findMany = vi.fn().mockResolvedValue(rolloutModules);
  const prisma = {
    platformSubscription: { findUnique },
    platformModule: { findMany },
  } as unknown as Pick<PrismaClient, "platformSubscription">
    & Partial<Pick<PrismaClient, "platformModule">>;
  return { adapter: new PrismaCompanyEntitlementQueryAdapter(prisma), findUnique, findMany };
}

describe("PrismaCompanyEntitlementQueryAdapter global free-module grants", () => {
  it("adds the free modules for any company when its existing subscription satisfies dependencies", async () => {
    const { adapter, findMany } = adapterFor([
      { id: 3n, code: "HUMAN_RESOURCES" },
      { id: 4n, code: "APPROVALS" },
      { id: 5n, code: "SALES" },
    ], [
      moduleRow(101n, "GENERAL_PROJECTS", [{ id: 3n, code: "HUMAN_RESOURCES", isActive: true }]),
      moduleRow(102n, "SERVICE_CATALOG"),
      moduleRow(103n, "PAYROLL", [
        { id: 3n, code: "HUMAN_RESOURCES", isActive: true },
        { id: 4n, code: "APPROVALS", isActive: true },
      ]),
    ]);

    const result = await adapter.findCompanyEntitlements(41n, new Date("2026-10-05T12:00:00.000Z"));

    expect(result?.moduleCodes).toEqual([
      "APPROVALS",
      "GENERAL_PROJECTS",
      "HUMAN_RESOURCES",
      "PAYROLL",
      "SALES",
      "SERVICE_CATALOG",
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { code: { in: [...PLATFORM_WIDE_FREE_MODULE_CODES] }, isActive: true },
    }));
  });

  it("fails closed for a global module whose dependency is absent from a company's subscription", async () => {
    const { adapter } = adapterFor([
      { id: 3n, code: "HUMAN_RESOURCES" },
    ], [
      moduleRow(101n, "GENERAL_PROJECTS", [{ id: 3n, code: "HUMAN_RESOURCES", isActive: true }]),
      moduleRow(102n, "SERVICE_CATALOG"),
      moduleRow(103n, "PAYROLL", [
        { id: 3n, code: "HUMAN_RESOURCES", isActive: true },
        { id: 4n, code: "APPROVALS", isActive: true },
      ]),
    ]);

    const result = await adapter.findCompanyEntitlements(41n);

    expect(result?.moduleCodes).toEqual(["GENERAL_PROJECTS", "HUMAN_RESOURCES", "SERVICE_CATALOG"]);
  });

  it("does not alter plan history, prices, quotas, or company subscription rows", async () => {
    const [migration, rollback] = await Promise.all([
      readFile(new URL("migration.sql", migrationRoot), "utf8"),
      readFile(new URL("rollback.sql", migrationRoot), "utf8"),
    ]);

    expect(migration).toContain("UPDATE `platform_modules`");
    expect(migration).toContain("'services.view', 'service_catalog'");
    expect(migration).toContain("'services.manage', 'service_catalog'");
    expect(migration).toContain("INSERT IGNORE INTO `role_permissions`");
    expect(migration).toContain("`roles`.`code` = 'ADMINISTRATOR'");
    expect(migration).not.toMatch(/(?:UPDATE|INSERT|DELETE FROM)\s+`?(?:platform_plan_versions|platform_plan_entitlements|platform_subscriptions|platform_subscription_entitlements|platform_billing_accounts)`?/iu);
    expect(migration).toContain("'GENERAL_PROJECTS', 'SERVICE_CATALOG', 'PAYROLL'");
    expect(rollback).toContain("retain all user data and history");
    expect(rollback).not.toMatch(/DROP\s+(?:TABLE|COLUMN)/iu);
  });
});

const dbTestsEnabled = process.env.RUN_DB_TESTS === "true";
const db = dbTestsEnabled ? createDatabase(process.env.DATABASE_URL ?? "") : null;

describe.runIf(dbTestsEnabled)("platform-wide free-module rollout on MariaDB/MySQL", () => {
  const companyIds: bigint[] = [];
  const organizationIds: bigint[] = [];

  async function createCompany(label: string) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase();
    const currency = await db!.currency.findFirstOrThrow({ where: { code: "SAR", scopeKey: "GLOBAL" } });
    const organization = await db!.organization.create({
      data: { code: `FREE-MODULE-${suffix}`, name: `Free module ${label} ${suffix}` },
    });
    organizationIds.push(organization.id);
    const company = await db!.company.create({
      data: {
        organizationId: organization.id,
        baseCurrencyId: currency.id,
        code: `FREE-MODULE-${suffix}`,
        name: `Free module ${label} ${suffix}`,
        timezone: "Asia/Riyadh",
      },
    });
    companyIds.push(company.id);
    await db!.$transaction((tx) => new PrismaCompanySubscriptionProvisioningAdapter().provisionGrandfatheredAccess(tx, {
      companyId: company.id,
      baseCurrencyCode: "SAR",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
    }));
    return company;
  }

  afterAll(async () => {
    if (!db) return;
    try {
      if (companyIds.length) {
        const companyId = { in: companyIds };
        const subscriptions = await db.platformSubscription.findMany({
          where: { companyId },
          select: { id: true, planVersion: { select: { id: true, planId: true } } },
        });
        const subscriptionIds = subscriptions.map(({ id }) => id);
        const versionIds = subscriptions.map(({ planVersion }) => planVersion.id);
        const planIds = subscriptions.map(({ planVersion }) => planVersion.planId);
        const changes = await db.platformSubscriptionChange.findMany({ where: { companyId }, select: { id: true } });
        await db.platformSubscriptionChangeModule.deleteMany({ where: { changeId: { in: changes.map(({ id }) => id) } } });
        await db.platformSubscriptionChange.deleteMany({ where: { companyId } });
        await db.platformSubscriptionEntitlement.deleteMany({ where: { companyId } });
        await db.platformSubscription.deleteMany({ where: { id: { in: subscriptionIds } } });
        await db.platformPlanEntitlement.deleteMany({ where: { planVersionId: { in: versionIds } } });
        await db.platformPlanVersion.deleteMany({ where: { id: { in: versionIds } } });
        await db.platformPlan.deleteMany({ where: { id: { in: planIds } } });
        await db.company.deleteMany({ where: { id: companyId } });
        await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
      }
    } finally {
      await db.$disconnect();
    }
  });

  it("exposes the free modules to pre-existing and newly created companies without rewriting their subscriptions", async () => {
    const administratorRoles = await db!.role.findMany({
      where: { code: "ADMINISTRATOR", isSystemRole: true },
      select: { id: true },
    });
    expect(administratorRoles.length).toBeGreaterThan(0);
    const catalogGrants = await db!.rolePermission.findMany({
      where: {
        roleId: { in: administratorRoles.map(({ id }) => id) },
      permission: { code: { in: ["services.view", "services.manage"] } },
      },
      select: { roleId: true, permission: { select: { code: true } } },
    });
    for (const role of administratorRoles) {
      expect(catalogGrants.filter(({ roleId }) => roleId === role.id).map(({ permission }) => permission.code).sort())
        .toEqual(["services.manage", "services.view"]);
    }

    const platformModules = await db!.platformModule.findMany({
      where: { code: { in: [...PLATFORM_WIDE_FREE_MODULE_CODES] } },
      select: { id: true, code: true, isActive: true },
    });
    expect(platformModules.map(({ code }) => code).sort()).toEqual([...PLATFORM_WIDE_FREE_MODULE_CODES].sort());
    expect(platformModules.every(({ isActive }) => isActive)).toBe(true);
    const moduleIds = platformModules.map(({ id }) => id);

    const existingCompany = await createCompany("existing");
    const existingSubscription = await db!.platformSubscription.findUniqueOrThrow({
      where: { companyId: existingCompany.id },
      select: { id: true, version: true, planVersionId: true },
    });
    await db!.platformSubscriptionEntitlement.deleteMany({
      where: { subscriptionId: existingSubscription.id, moduleId: { in: moduleIds } },
    });
    await db!.platformPlanEntitlement.deleteMany({
      where: { planVersionId: existingSubscription.planVersionId, moduleId: { in: moduleIds } },
    });
    const existingPlanBefore = await db!.platformPlanVersion.findUniqueOrThrow({
      where: { id: existingSubscription.planVersionId },
      select: {
        version: true,
        recurringFee: true,
        includedUsers: true,
        includedEmployees: true,
        includedPostedDocuments: true,
      },
    });
    const oldPlanEntitlementCount = await db!.platformPlanEntitlement.count({
      where: { planVersionId: existingSubscription.planVersionId },
    });

    const query = new PrismaCompanyEntitlementQueryAdapter(db!);
    const existingSnapshot = await query.findCompanyEntitlements(existingCompany.id);
    expect(existingSnapshot?.moduleCodes).toEqual(expect.arrayContaining([...PLATFORM_WIDE_FREE_MODULE_CODES]));
    const existingSubscriptionAfter = await db!.platformSubscription.findUniqueOrThrow({
      where: { companyId: existingCompany.id },
      select: { id: true, version: true, planVersionId: true },
    });
    const existingPlanAfter = await db!.platformPlanVersion.findUniqueOrThrow({
      where: { id: existingSubscription.planVersionId },
      select: {
        version: true,
        recurringFee: true,
        includedUsers: true,
        includedEmployees: true,
        includedPostedDocuments: true,
      },
    });
    expect(existingSubscriptionAfter).toEqual(existingSubscription);
    expect(existingPlanAfter).toEqual(existingPlanBefore);
    expect(await db!.platformPlanEntitlement.count({
      where: { planVersionId: existingSubscription.planVersionId },
    })).toBe(oldPlanEntitlementCount);
    expect(await db!.platformSubscriptionEntitlement.count({
      where: { subscriptionId: existingSubscription.id, moduleId: { in: moduleIds } },
    })).toBe(0);

    const newCompany = await createCompany("new");
    const newSnapshot = await query.findCompanyEntitlements(newCompany.id);
    expect(newSnapshot?.moduleCodes).toEqual(expect.arrayContaining([...PLATFORM_WIDE_FREE_MODULE_CODES]));
  });
});
