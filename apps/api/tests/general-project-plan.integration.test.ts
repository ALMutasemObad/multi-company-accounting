import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { auditGeneralProjectRollout } from "../src/general-projects/general-project-rollout-audit.js";
import { PrismaNewCompanySubscriptionProvisioningAdapter } from "../src/platform-subscriptions/prisma-new-company-subscription-provisioning-adapter.js";
import { PlatformSubscriptionCatalogService } from "../src/platform-subscriptions/platform-subscription-service.js";
import { configuredStartPlanVersions, validateNewCompanyStartPlan } from "../src/platform-subscriptions/new-company-start-policy.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;
const currencies = ["AED", "BHD", "EGP", "EUR", "GBP", "KWD", "OMR", "QAR", "SAR", "USD", "YER"];
const now = new Date("2050-01-01T00:00:00.000Z");

describe.runIf(enabled)("general projects in immutable free start-plan versions", () => {
  const planIds: bigint[] = [];
  const companyIds: bigint[] = [];
  const organizationIds: bigint[] = [];
  let operatorId: bigint;
  let originalPublishedId: bigint;
  let projectModuleInitiallyActive: boolean;
  let moduleIds: { core: bigint; hr: bigint; projects: bigint };
  const catalog = () => new PlatformSubscriptionCatalogService(prisma!, {
    isOperator: async (candidate) => candidate === operatorId,
  }, () => now);

  const freeInput = (code: string, currencyCode: string, includeProjects: boolean) => ({
    code, displayName: code, description: "Isolated project release acceptance",
    billingCycle: "MONTHLY" as const, currencyCode, recurringFee: "0",
    includedUsers: 1_000_000, pricePerAdditionalUser: "0",
    includedEmployees: 1_000_000, pricePerAdditionalEmployee: "0",
    includedPostedDocuments: 1_000_000, pricePerAdditionalPostedDocument: "0",
    taxRate: "0", paymentTermsDays: 0, trialDays: 0,
    effectiveFrom: "2049-01-01T00:00:00.000Z", selfServicePolicy: "IMMEDIATE_FREE" as const,
    modules: [moduleIds.core, moduleIds.hr, ...(includeProjects ? [moduleIds.projects] : [])]
      .map((moduleId) => ({ moduleId, selectionMode: "INCLUDED" as const, additionalRecurringFee: null })),
  });

  beforeAll(async () => {
    operatorId = (await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" }, select: { id: true },
    })).id;
    const modules = await prisma!.platformModule.findMany({
      where: { code: { in: ["CORE_ACCOUNTING", "HUMAN_RESOURCES", "GENERAL_PROJECTS"] } },
      select: { id: true, code: true, isActive: true },
    });
    expect(modules).toHaveLength(3);
    expect(modules.filter((module) => module.code !== "GENERAL_PROJECTS").every((module) => module.isActive)).toBe(true);
    const id = (code: string) => modules.find((module) => module.code === code)!.id;
    moduleIds = { core: id("CORE_ACCOUNTING"), hr: id("HUMAN_RESOURCES"), projects: id("GENERAL_PROJECTS") };
    projectModuleInitiallyActive = modules.find((module) => module.code === "GENERAL_PROJECTS")!.isActive;
    if (!projectModuleInitiallyActive) {
      await prisma!.platformModule.update({ where: { id: moduleIds.projects }, data: { isActive: true } });
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    if (companyIds.length) {
      const companyId = { in: companyIds };
      const changes = await prisma.platformSubscriptionChange.findMany({ where: { companyId }, select: { id: true } });
      await prisma.platformSubscriptionChangeModule.deleteMany({ where: { changeId: { in: changes.map((item) => item.id) } } });
      await prisma.platformSubscriptionChange.deleteMany({ where: { companyId } });
      await prisma.platformSubscriptionEntitlement.deleteMany({ where: { companyId } });
      await prisma.platformSubscription.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    if (planIds.length) {
      const versions = await prisma.platformPlanVersion.findMany({ where: { planId: { in: planIds } }, select: { id: true } });
      await prisma.platformPlanEntitlement.deleteMany({ where: { planVersionId: { in: versions.map((item) => item.id) } } });
      await prisma.platformPlanVersion.deleteMany({ where: { planId: { in: planIds } } });
      await prisma.platformPlan.deleteMany({ where: { id: { in: planIds } } });
    }
    if (moduleIds?.projects !== undefined && !projectModuleInitiallyActive) {
      await prisma.platformModule.update({ where: { id: moduleIds.projects }, data: { isActive: false } });
    }
    await prisma.$disconnect();
  });

  it("clones rather than mutates a published version to include general projects", async () => {
    const created = await catalog().createPlan({ userId: operatorId }, freeInput(`GPMCLONE_${randomUUID().slice(0, 8)}`, "SAR", false));
    planIds.push(BigInt(created.plan.id));
    const original = (await catalog().publish({ userId: operatorId }, BigInt(created.version.id), created.version.version)).version;
    originalPublishedId = BigInt(original.id);
    const draft = (await catalog().createDraft({ userId: operatorId }, BigInt(created.plan.id))).version;
    const input = freeInput(created.plan.code, "SAR", true);
    const updated = (await catalog().updateDraft({ userId: operatorId }, BigInt(draft.id), {
      ...input, version: draft.version,
    })).version;
    const published = (await catalog().publish({ userId: operatorId }, BigInt(draft.id), updated.version)).version;
    expect(original.modules.some((module) => module.code === "GENERAL_PROJECTS")).toBe(false);
    expect(published.modules.some((module) => module.code === "GENERAL_PROJECTS" && module.selectionMode === "INCLUDED")).toBe(true);
    expect(published.versionNumber).toBe(original.versionNumber + 1);
    expect(published.recurringFee).toBe("0.0000");
    expect(published.pricePerAdditionalUser).toBe("0.0000");
    const unchanged = await prisma!.platformPlanVersion.findUniqueOrThrow({
      where: { id: BigInt(original.id) }, include: { entitlements: true },
    });
    expect(unchanged.entitlements.some((item) => item.moduleId === moduleIds.projects)).toBe(false);
    expect(unchanged.publishedAt).not.toBeNull();
  });

  it("provisions a free general-project entitlement in each supported start currency", async () => {
    const mapping = new Map<string, bigint>();
    for (const currencyCode of currencies) {
      const code = `GPMFREE_${currencyCode}_${randomUUID().slice(0, 8)}`;
      const created = await catalog().createPlan({ userId: operatorId }, freeInput(code, currencyCode, true));
      planIds.push(BigInt(created.plan.id));
      const published = (await catalog().publish({ userId: operatorId }, BigInt(created.version.id), created.version.version)).version;
      mapping.set(currencyCode, BigInt(published.id));
      const graph = await prisma!.platformPlanVersion.findUniqueOrThrow({
        where: { id: BigInt(published.id) },
        include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
      });
      expect(validateNewCompanyStartPlan(graph, now, currencyCode).modules.map((item) => item.moduleId))
        .toContain(moduleIds.projects);
    }
    const serialized = [...mapping].map(([code, id]) => `${code}:${id}`).join(",");
    expect(configuredStartPlanVersions(undefined, serialized)).toMatchObject({ kind: "currency-map" });
    const ready = await auditGeneralProjectRollout(prisma!, undefined, serialized, now);
    expect(ready.status).toBe("READY");
    expect(ready.moduleActive).toBe(true);
    expect(ready.currencies).toHaveLength(currencies.length);
    expect(ready.currencies.every((item) => item.finding === null)).toBe(true);
    const missing = [...mapping].filter(([code]) => code !== "USD").map(([code, id]) => `${code}:${id}`).join(",");
    expect((await auditGeneralProjectRollout(prisma!, undefined, missing, now)).currencies)
      .toContainEqual({ code: "USD", finding: "CURRENCY_NOT_CONFIGURED" });
    const olderSar = [...mapping].map(([code, id]) => `${code}:${code === "SAR" ? originalPublishedId : id}`).join(",");
    expect((await auditGeneralProjectRollout(prisma!, undefined, olderSar, now)).currencies)
      .toContainEqual({ code: "SAR", finding: "PROJECTS_NOT_INCLUDED" });
    const extra = await auditGeneralProjectRollout(prisma!, undefined, `${serialized},JPY:999999`, now);
    expect(extra).toMatchObject({ status: "NOT_READY", configuration: "EXTRA_CURRENCY_CONFIGURED" });
    const adapter = new PrismaNewCompanySubscriptionProvisioningAdapter(undefined, serialized);
    const available = await prisma!.$transaction((tx) => adapter.eligibleStartCurrencies(tx, now));
    expect(available.sort()).toEqual([...currencies].sort());
    for (const currencyCode of currencies) {
      const suffix = randomUUID().slice(0, 8);
      const currency = await prisma!.currency.findUniqueOrThrow({
        where: { scopeKey_code: { scopeKey: "GLOBAL", code: currencyCode } },
      });
      const organization = await prisma!.organization.create({ data: { code: `GPM-${suffix}`, name: `GPM ${suffix}` } });
      organizationIds.push(organization.id);
      const company = await prisma!.company.create({ data: {
        organizationId: organization.id, baseCurrencyId: currency.id,
        code: `GPM-${suffix}`, name: `GPM company ${suffix}`, timezone: "Asia/Riyadh",
      } });
      companyIds.push(company.id);
      await prisma!.$transaction((tx) => adapter.provisionNewCompanyAccess(tx, {
        companyId: company.id, baseCurrencyCode: currencyCode, effectiveFrom: now,
      }));
      const subscription = await prisma!.platformSubscription.findUniqueOrThrow({
        where: { companyId: company.id }, include: { entitlements: true },
      });
      expect(subscription.planVersionId).toBe(mapping.get(currencyCode));
      expect(subscription.entitlements.some((item) => item.moduleId === moduleIds.projects)).toBe(true);
      const change = await prisma!.platformSubscriptionChange.findFirstOrThrow({ where: { companyId: company.id } });
      expect(change.totalRecurringFee.toFixed(4)).toBe("0.0000");
    }
  });
});
