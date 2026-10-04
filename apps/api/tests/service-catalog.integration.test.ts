import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ServiceCatalogRevenueAccountAdapter } from "../src/accounts/service-catalog-revenue-account-adapter.js";
import { createDatabase } from "../src/database.js";
import { ServiceCatalogService } from "../src/service-catalog/service-catalog-service.js";
import { ServiceCatalogOutputTaxAdapter } from "../src/tax/service-catalog-output-tax-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;
const key = () => randomUUID();
const page = { page: 1, pageSize: 25 };

describe.runIf(enabled)("standalone service catalog on isolated MySQL/MariaDB", () => {
  const companyIds: bigint[] = [];
  let organizationId: bigint;
  let userId: bigint;
  let catalog: ServiceCatalogService;
  let categoryId = "";
  const context = (companyId: bigint) => ({ companyId, userId });

  beforeAll(async () => {
    userId = (await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" }, select: { id: true },
    })).id;
    const currency = await prisma!.currency.findUniqueOrThrow({
      where: { scopeKey_code: { scopeKey: "GLOBAL", code: "SAR" } }, select: { id: true },
    });
    organizationId = (await prisma!.organization.create({ data: { name: `IT-SVC-${key()}` } })).id;
    for (let index = 0; index < 2; index += 1) {
      const company = await prisma!.company.create({ data: {
        organizationId, baseCurrencyId: currency.id, name: `IT-SVC-${index}-${key()}`,
        timezone: "Asia/Riyadh",
      } });
      companyIds.push(company.id);
    }
    catalog = new ServiceCatalogService(prisma!, new ServiceCatalogRevenueAccountAdapter(prisma!),
      new ServiceCatalogOutputTaxAdapter(prisma!));
  });

  afterAll(async () => {
    if (!prisma) return;
    if (companyIds.length) {
      const companyId = { in: companyIds };
      await prisma.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: [
        "CREATE_SERVICE_CATEGORY", "UPDATE_SERVICE_CATEGORY", "TRANSITION_SERVICE_CATEGORY",
        "CREATE_SERVICE_OFFERING", "UPDATE_SERVICE_OFFERING", "TRANSITION_SERVICE_OFFERING",
        "CREATE_SERVICE_VARIANT", "UPDATE_SERVICE_VARIANT", "TRANSITION_SERVICE_VARIANT",
      ] } } });
      await prisma.auditLog.deleteMany({ where: { companyId, entityType: { in: [
        "SERVICE_CATEGORY", "SERVICE_OFFERING", "SERVICE_OFFERING_VARIANT",
      ] } } });
      await prisma.serviceOfferingVariant.deleteMany({ where: { companyId } });
      await prisma.serviceOffering.deleteMany({ where: { companyId } });
      await prisma.serviceCategory.deleteMany({ where: { companyId } });
      await prisma.masterDataCodeSequence.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    if (organizationId !== undefined) await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("creates, activates, searches and scopes available services without coupling to projects", async () => {
    const first = context(companyIds[0]!);
    const other = context(companyIds[1]!);
    const createKey = key();
    const category = await catalog.createCategory(first, {
      nameAr: "خدمات اختبار عامة", description: "تصنيف مستقل للخدمات", idempotencyKey: createKey,
    });
    expect(await catalog.createCategory(first, {
      nameAr: "خدمات اختبار عامة", description: "تصنيف مستقل للخدمات", idempotencyKey: createKey,
    })).toEqual(category);
    categoryId = category.category.id;
    expect((await catalog.listCategories(other, page)).data).toHaveLength(0);
    await expect(catalog.getCategory(other, categoryId)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(catalog.createOffering(other, {
      nameAr: "مرجع شركة أخرى", categoryId, idempotencyKey: key(),
    })).rejects.toMatchObject({ reason: "CATEGORY_NOT_ACTIVE" });

    const offering = await catalog.createOffering(first, {
      nameAr: "خدمة هندسية عامة", categoryId, idempotencyKey: key(),
    });
    expect(offering.offering.code).toMatch(/^SVC-\d{6}$/u);
    await expect(catalog.getOffering(other, offering.offering.id)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(catalog.createVariant(first, offering.offering.id, {
      nameAr: "مرجع حساب خاطئ", pricingUnit: "EACH", defaultRevenueAccountId: 999999999n,
      idempotencyKey: key(),
    })).rejects.toMatchObject({ reason: "REVENUE_ACCOUNT_INVALID" });
    await expect(catalog.createVariant(first, offering.offering.id, {
      nameAr: "مرجع ضريبة خاطئ", pricingUnit: "EACH", defaultOutputTaxRateId: 999999999n,
      idempotencyKey: key(),
    })).rejects.toMatchObject({ reason: "OUTPUT_TAX_RATE_INVALID" });

    const active = await catalog.createVariant(first, offering.offering.id, {
      nameAr: "تنفيذ أساسي", pricingUnit: "SESSION", availableFrom: "2049-12-01",
      availableUntil: "2050-02-01", idempotencyKey: key(),
    });
    const expired = await catalog.createVariant(first, offering.offering.id, {
      nameAr: "عرض منتهٍ", pricingUnit: "EACH", availableUntil: "2049-12-31", idempotencyKey: key(),
    });
    await catalog.createVariant(first, offering.offering.id, {
      nameAr: "بديل مسودة", pricingUnit: "DAY", idempotencyKey: key(),
    });
    await catalog.transitionVariant(first, offering.offering.id, active.variant.id, {
      expectedVersion: 0, to: "ACTIVE", reason: "تجربة تفعيل البديل", idempotencyKey: key(),
    });
    await catalog.transitionVariant(first, offering.offering.id, expired.variant.id, {
      expectedVersion: 0, to: "ACTIVE", reason: "تجربة تفعيل قديم", idempotencyKey: key(),
    });
    await catalog.transitionOffering(first, offering.offering.id, {
      expectedVersion: 0, to: "ACTIVE", reason: "خدمة جاهزة للاختيار", idempotencyKey: key(),
    });

    const asOf = new Date("2050-01-01T08:00:00.000Z");
    const available = await catalog.listSelectionOptions(first, { ...page, search: "هندسية" }, asOf);
    expect(available.asOf).toBe("2050-01-01");
    expect(available.data.map((item) => item.id)).toEqual([active.variant.id]);
    expect(available.data[0]).not.toHaveProperty("defaultRevenueAccountId");
    expect((await catalog.listSelectionOptions(other, page, asOf)).data).toHaveLength(0);
    expect((await catalog.listRevenueAccountOptions(other, page)).meta.total).toBe(0);
    expect((await catalog.listOutputTaxOptions(other, page)).meta.total).toBe(0);
    expect((await catalog.listSelectionOptions(first, page, new Date("2050-02-01T08:00:00.000Z"))).data).toHaveLength(0);
  });

  it("accepts one of two competing category edits and rejects stale versions", async () => {
    const first = context(companyIds[0]!);
    const attempts = await Promise.allSettled([
      catalog.updateCategory(first, categoryId, { expectedVersion: 0, nameAr: "تعديل أول", idempotencyKey: key() }),
      catalog.updateCategory(first, categoryId, { expectedVersion: 0, nameAr: "تعديل ثانٍ", idempotencyKey: key() }),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((attempts.find((result) => result.status === "rejected") as PromiseRejectedResult).reason)
      .toMatchObject({ reason: "VERSION_CONFLICT" });
    expect((await catalog.getCategory(first, categoryId)).category.version).toBe(1);
  });
});
