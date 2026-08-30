import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaAuditAppendAdapter } from "../src/audit/prisma-audit-append-adapter.js";
import { createDatabase } from "../src/database.js";
import { PrismaCompanySubscriptionProvisioningAdapter } from "../src/platform-subscriptions/prisma-company-subscription-provisioning-adapter.js";
import {
  PlatformSubscriptionCatalogService,
  PlatformSubscriptionError,
  PlatformSubscriptionLifecycleService,
} from "../src/platform-subscriptions/platform-subscription-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const prisma = enabled ? createDatabase(process.env.DATABASE_URL ?? "") : null;

describe.runIf(enabled)("SUB-3 subscription lifecycle on a supported database", () => {
  const companyIds: bigint[] = [];
  const organizationIds: bigint[] = [];
  const catalogPlanIds: bigint[] = [];
  let userId: bigint;
  let coreModuleId: bigint;
  const now = new Date("2050-01-01T00:00:00.000Z");
  const operators = { isOperator: async (candidate: bigint) => candidate === userId };
  const audit = new PrismaAuditAppendAdapter();
  const catalog = () => new PlatformSubscriptionCatalogService(prisma!, operators, () => now);
  const lifecycle = () => new PlatformSubscriptionLifecycleService(prisma!, operators, audit, () => now);

  async function createCompany() {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
    const currency = await prisma!.currency.findFirstOrThrow({ where: { code: "SAR", scopeKey: "GLOBAL" } });
    const organization = await prisma!.organization.create({ data: { code: `SUB3-${suffix}`, name: `SUB3 ${suffix}` } });
    organizationIds.push(organization.id);
    const company = await prisma!.company.create({ data: {
      organizationId: organization.id, baseCurrencyId: currency.id,
      code: `SUB3-${suffix}`, name: `SUB3 company ${suffix}`, timezone: "Asia/Riyadh",
    } });
    companyIds.push(company.id);
    await prisma!.$transaction((tx) => new PrismaCompanySubscriptionProvisioningAdapter().provisionGrandfatheredAccess(tx, {
      companyId: company.id, baseCurrencyCode: "SAR", effectiveFrom: new Date("2049-01-01T00:00:00.000Z"),
    }));
    return company;
  }

  async function createPublishedPlan(input: { recurringFee: string; policy: "REQUEST_ONLY" | "IMMEDIATE_FREE"; code: string; trialDays?: number }) {
    const created = await catalog().createPlan({ userId }, {
      code: input.code, displayName: input.code, description: "SUB-3 integration plan",
      billingCycle: "MONTHLY", currencyCode: "SAR", recurringFee: input.recurringFee,
      includedUsers: 5, pricePerAdditionalUser: null,
      includedEmployees: 5, pricePerAdditionalEmployee: null,
      includedPostedDocuments: 100, pricePerAdditionalPostedDocument: null,
      taxRate: "0", paymentTermsDays: 0, trialDays: input.trialDays ?? 0,
      effectiveFrom: "2049-01-01T00:00:00.000Z", selfServicePolicy: input.policy,
      modules: [{ moduleId: coreModuleId, selectionMode: "INCLUDED", additionalRecurringFee: null }],
    });
    catalogPlanIds.push(BigInt(created.plan.id));
    const published = await catalog().publish({ userId }, BigInt(created.version.id), created.version.version);
    return published.version;
  }

  beforeAll(async () => {
    userId = (await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" }, select: { id: true } })).id;
    coreModuleId = (await prisma!.platformModule.findUniqueOrThrow({ where: { code: "CORE_ACCOUNTING" }, select: { id: true } })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    if (companyIds.length) {
      const companyId = { in: companyIds };
      const subscriptions = await prisma.platformSubscription.findMany({ where: { companyId }, select: { id: true, planVersion: { select: { id: true, planId: true } } } });
      const subscriptionIds = subscriptions.map((item) => item.id);
      const legacyVersionIds = subscriptions.map((item) => item.planVersion.id);
      const legacyPlanIds = subscriptions.map((item) => item.planVersion.planId);
      const changes = await prisma.platformSubscriptionChange.findMany({ where: { companyId }, select: { id: true } });
      await prisma.platformSubscriptionChangeModule.deleteMany({ where: { changeId: { in: changes.map((item) => item.id) } } });
      await prisma.platformSubscriptionChange.deleteMany({ where: { companyId } });
      await prisma.platformSubscriptionEntitlement.deleteMany({ where: { companyId } });
      await prisma.platformSubscription.deleteMany({ where: { id: { in: subscriptionIds } } });
      await prisma.idempotencyRecord.deleteMany({ where: { companyId } });
      await prisma.auditLog.deleteMany({ where: { companyId } });
      await prisma.platformPlanEntitlement.deleteMany({ where: { planVersionId: { in: legacyVersionIds } } });
      await prisma.platformPlanVersion.deleteMany({ where: { id: { in: legacyVersionIds } } });
      await prisma.platformPlan.deleteMany({ where: { id: { in: legacyPlanIds } } });
    }
    if (catalogPlanIds.length) {
      const versions = await prisma.platformPlanVersion.findMany({ where: { planId: { in: catalogPlanIds } }, select: { id: true } });
      await prisma.platformPlanEntitlement.deleteMany({ where: { planVersionId: { in: versions.map((item) => item.id) } } });
      await prisma.platformPlanVersion.deleteMany({ where: { planId: { in: catalogPlanIds } } });
      await prisma.platformPlan.deleteMany({ where: { id: { in: catalogPlanIds } } });
    }
    if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    if (organizationIds.length) await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  it("publishes immutable versions, keeps paid owner changes pending, and isolates company history", async () => {
    const [companyA, companyB] = await Promise.all([createCompany(), createCompany()]);
    const paid = await createPublishedPlan({
      recurringFee: "100.0000", policy: "REQUEST_ONLY", code: `PAID_${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    });
    const publishedActors = await prisma!.platformPlanVersion.findUniqueOrThrow({
      where: { id: BigInt(paid.id) },
      select: { createdById: true, updatedById: true, publishedById: true, plan: { select: { createdById: true, updatedById: true } } },
    });
    expect(publishedActors).toEqual({
      createdById: userId, updatedById: userId, publishedById: userId,
      plan: { createdById: userId, updatedById: userId },
    });

    await expect(catalog().updateDraft({ userId }, BigInt(paid.id), {
      displayName: paid.displayName, description: paid.description, billingCycle: paid.billingCycle,
      currencyCode: paid.currencyCode, recurringFee: paid.recurringFee,
      includedUsers: paid.includedUsers, pricePerAdditionalUser: paid.pricePerAdditionalUser,
      includedEmployees: paid.includedEmployees, pricePerAdditionalEmployee: paid.pricePerAdditionalEmployee,
      includedPostedDocuments: paid.includedPostedDocuments,
      pricePerAdditionalPostedDocument: paid.pricePerAdditionalPostedDocument,
      taxRate: paid.taxRate, paymentTermsDays: paid.paymentTermsDays, trialDays: paid.trialDays,
      effectiveFrom: paid.effectiveFrom, selfServicePolicy: paid.selfServicePolicy,
      modules: paid.modules.map((module) => ({ moduleId: BigInt(module.id), selectionMode: module.selectionMode, additionalRecurringFee: module.additionalRecurringFee })),
      version: paid.version,
    })).rejects.toEqual(new PlatformSubscriptionError("PUBLISHED_VERSION_IMMUTABLE"));

    const before = await prisma!.platformSubscription.findUniqueOrThrow({ where: { companyId: companyA.id } });
    const key = `paid-owner-${randomUUID()}`;
    const requested = await lifecycle().requestOwnerChange({ userId, companyId: companyA.id }, {
      targetPlanVersionId: BigInt(paid.id), optionalModuleIds: [], subscriptionVersion: before.version, idempotencyKey: key,
    });
    const repeated = await lifecycle().requestOwnerChange({ userId, companyId: companyA.id }, {
      targetPlanVersionId: BigInt(paid.id), optionalModuleIds: [], subscriptionVersion: before.version, idempotencyKey: key,
    });
    expect(requested).toMatchObject({ change: { state: "PENDING_APPROVAL" }, paymentCollected: false });
    expect(repeated).toEqual(requested);
    const afterRequest = await prisma!.platformSubscription.findUniqueOrThrow({ where: { companyId: companyA.id } });
    expect(afterRequest.planVersionId).toBe(before.planVersionId);
    expect(afterRequest.version).toBe(before.version + 1);
    expect(await prisma!.platformSubscriptionChange.count({ where: { companyId: companyA.id, state: "PENDING_APPROVAL" } })).toBe(1);

    await expect(lifecycle().requestOwnerChange({ userId, companyId: companyA.id }, {
      targetPlanVersionId: BigInt(paid.id), optionalModuleIds: [], subscriptionVersion: before.version,
      idempotencyKey: `stale-${randomUUID()}`,
    })).rejects.toEqual(new PlatformSubscriptionError("VERSION_CONFLICT"));

    const companyBSnapshot = await lifecycle().ownerCompany(companyB.id, { page: 1, pageSize: 20 });
    expect(companyBSnapshot.pending).toBeNull();
    expect(companyBSnapshot.current.plan.planCode).toBe(`LEGACY_COMPANY_${companyB.id}`);
    expect(companyBSnapshot.history.every((change) => change.plan.planCode !== paid.planCode)).toBe(true);
  });

  it("creates one idempotent scheduled change and uses database pagination", async () => {
    const company = await createCompany();
    const free = await createPublishedPlan({
      recurringFee: "0.0000", policy: "IMMEDIATE_FREE", code: `FREE_${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    });
    const subscription = await prisma!.platformSubscription.findUniqueOrThrow({ where: { companyId: company.id } });
    const command = {
      targetPlanVersionId: BigInt(free.id), optionalModuleIds: [],
      effectiveAt: "2050-02-01T00:00:00.000Z", subscriptionVersion: subscription.version,
      idempotencyKey: `schedule-${randomUUID()}`,
    };
    const first = await lifecycle().scheduleOperatorChange({ userId }, company.id, command);
    const second = await lifecycle().scheduleOperatorChange({ userId }, company.id, command);
    expect(second).toEqual(first);
    expect(await prisma!.platformSubscriptionChange.count({ where: { companyId: company.id, state: "APPROVED", effectiveAt: new Date(command.effectiveAt) } })).toBe(1);
    const snapshot = await lifecycle().ownerCompany(company.id, { page: 1, pageSize: 1 });
    expect(snapshot.scheduled?.plan.id).toBe(free.id);
    expect(snapshot.history).toHaveLength(1);
    expect(snapshot.meta.total).toBeGreaterThanOrEqual(2);

    const listed = await catalog().listPlans(userId, { page: 2, pageSize: 1, active: "ALL", publicationStatus: "ALL" });
    expect(listed.plans).toHaveLength(1);
    expect(listed.meta).toMatchObject({ page: 2, pageSize: 1 });
    expect(listed.meta.total).toBeGreaterThan(1);
  });

  it("rejects a plan bundle whose dependency closure is incomplete", async () => {
    const company = await createCompany();
    const pos = await prisma!.platformModule.findUniqueOrThrow({ where: { code: "POS" }, select: { id: true } });
    await expect(catalog().createPlan({ userId }, {
      code: `BROKEN_${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      displayName: "Broken dependency bundle", description: null, billingCycle: "MONTHLY", currencyCode: "SAR",
      recurringFee: "0", includedUsers: 1, pricePerAdditionalUser: null,
      includedEmployees: 1, pricePerAdditionalEmployee: null,
      includedPostedDocuments: 1, pricePerAdditionalPostedDocument: null,
      taxRate: "0", paymentTermsDays: 0, trialDays: 0,
      effectiveFrom: "2049-01-01T00:00:00.000Z", selfServicePolicy: "DISABLED",
      modules: [{ moduleId: pos.id, selectionMode: "INCLUDED", additionalRecurringFee: null }],
    })).rejects.toEqual(new PlatformSubscriptionError("MODULE_DEPENDENCY_MISSING"));
  });

  it("rejects an optional module selection when its dependency closure is incomplete", async () => {
    const company = await createCompany();
    const modules = await prisma!.platformModule.findMany({
      where: { isActive: true }, include: { dependencies: true }, orderBy: { id: "asc" },
    });
    const byId = new Map(modules.map((module) => [module.id.toString(), module]));
    const hasActiveClosure = (id: string, visiting = new Set<string>()): boolean => {
      const module = byId.get(id);
      if (!module || visiting.has(id)) return false;
      const next = new Set(visiting).add(id);
      return module.dependencies.every((dependency) => hasActiveClosure(dependency.dependsOnModuleId.toString(), next));
    };
    const source = modules.find((module) => module.dependencies.length > 0 && hasActiveClosure(module.id.toString()));
    if (!source) throw new Error("Expected at least one active module with active dependencies");
    const closure = new Set<string>();
    const visit = (id: string) => {
      if (closure.has(id)) return;
      const module = byId.get(id);
      if (!module) throw new Error("Expected active dependency closure");
      closure.add(id);
      module.dependencies.forEach((dependency) => visit(dependency.dependsOnModuleId.toString()));
    };
    visit(source.id.toString());

    const created = await catalog().createPlan({ userId }, {
      code: `OPTIONAL_${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      displayName: "Optional dependency plan", description: null, billingCycle: "MONTHLY", currencyCode: "SAR",
      recurringFee: "0", includedUsers: 1, pricePerAdditionalUser: null,
      includedEmployees: 1, pricePerAdditionalEmployee: null,
      includedPostedDocuments: 1, pricePerAdditionalPostedDocument: null,
      taxRate: "0", paymentTermsDays: 0, trialDays: 0,
      effectiveFrom: "2049-01-01T00:00:00.000Z", selfServicePolicy: "REQUEST_ONLY",
      modules: [...closure].map((moduleId) => ({
        moduleId: BigInt(moduleId), selectionMode: "OPTIONAL", additionalRecurringFee: "0",
      })),
    });
    catalogPlanIds.push(BigInt(created.plan.id));
    const published = await catalog().publish({ userId }, BigInt(created.version.id), created.version.version);
    const subscription = await prisma!.platformSubscription.findUniqueOrThrow({ where: { companyId: company.id } });
    await expect(lifecycle().requestOwnerChange({ userId, companyId: company.id }, {
      targetPlanVersionId: BigInt(published.version.id), optionalModuleIds: [source.id],
      subscriptionVersion: subscription.version, idempotencyKey: `missing-closure-${randomUUID()}`,
    })).rejects.toEqual(new PlatformSubscriptionError("MODULE_DEPENDENCY_MISSING"));
  });

  it("does not grant a second trial to a grandfathered trialing subscription", async () => {
    const company = await createCompany();
    await prisma!.platformSubscription.update({
      where: { companyId: company.id },
      data: { status: "TRIALING" },
    });
    const trial = await createPublishedPlan({
      recurringFee: "0.0000", policy: "IMMEDIATE_FREE", trialDays: 14,
      code: `TRIAL_${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    });
    const subscription = await prisma!.platformSubscription.findUniqueOrThrow({ where: { companyId: company.id } });
    await expect(lifecycle().requestOwnerChange({ userId, companyId: company.id }, {
      targetPlanVersionId: BigInt(trial.id), optionalModuleIds: [],
      subscriptionVersion: subscription.version, idempotencyKey: `second-trial-${randomUUID()}`,
    })).rejects.toEqual(new PlatformSubscriptionError("TRIAL_ALREADY_USED"));
  });
});
