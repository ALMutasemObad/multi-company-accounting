import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { PlatformOperationsService } from "../src/platform-operations/platform-operations-service.js";
import { PrismaPlatformAnalyticsQueryAdapter } from "../src/platform-operations/prisma-platform-analytics-query-adapter.js";
import { PlatformIdentityQueryAdapter } from "../src/users/platform-identity-query-adapter.js";
import {
  initializePlatformOperatorAuthorization,
  PlatformOperatorInitializationError,
} from "../src/platform-operations/platform-operator-authorization.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const prisma = enabled ? createDatabase(process.env.DATABASE_URL ?? "") : null;

describe.runIf(enabled)("platform operations with a supported database", () => {
  afterAll(async () => {
    await prisma!.$disconnect();
  });

  it("aggregates all tenants without returning personal or financial detail", async () => {
    const admin = await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" },
      select: { id: true },
    });
    const identities = new PlatformIdentityQueryAdapter(prisma!);
    const authorization = await initializePlatformOperatorAuthorization(identities, {
      operatorUserIds: [admin.id],
    });
    const service = new PlatformOperationsService(
      authorization,
      new PrismaPlatformAnalyticsQueryAdapter(prisma!),
      () => new Date("2026-08-28T06:00:00.000Z"),
    );

    const result = await service.overview(admin.id, 30);

    expect(result.metrics.totalCompanies).toBeGreaterThan(0);
    expect(result.metrics.totalUsers).toBeGreaterThan(0);
    expect(result.modules).toHaveLength(9);
    expect(result.trends).toHaveLength(6);
    expect(result.topCompanies.length).toBeLessThanOrEqual(5);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/email|displayName|ipAddress|userAgent|password|amount/iu);
    expect(serialized).not.toContain("@");
  });

  it("builds the financial analytics dashboard through bounded billing batches", async () => {
    const adapter = new PrismaPlatformAnalyticsQueryAdapter(prisma!);
    const result = await adapter.analytics({
      now: new Date("2048-06-30T00:00:00.000Z"),
      from: new Date("2048-06-01T00:00:00.000Z"),
      toExclusive: new Date("2048-07-01T00:00:00.000Z"),
      comparison: "PREVIOUS_PERIOD",
      comparisonFrom: new Date("2048-05-02T00:00:00.000Z"),
      comparisonToExclusive: new Date("2048-06-01T00:00:00.000Z"),
    });

    expect(result).not.toBeNull();
    expect(result!.activityTimeline).toHaveLength(12);
    expect(result!.companies.length).toBeLessThanOrEqual(12);
    expect(result!.financials.every((currency) =>
      currency.timeline.length === 12
      && /^-?\d+\.\d{4}$/u.test(currency.recurringMonthly)
      && /^-?\d+\.\d{4}$/u.test(currency.outstanding))).toBe(true);
    expect(result!.alerts.overdueInvoices).toBeGreaterThanOrEqual(0);
    expect(result!.alerts.dueSoonInvoices).toBeGreaterThanOrEqual(0);
  });

  it("validates configured operator IDs against Identity before serving requests", async () => {
    const identities = new PlatformIdentityQueryAdapter(prisma!);
    const admin = await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" },
      select: { id: true },
    });
    const authorization = await initializePlatformOperatorAuthorization(identities, {
      operatorUserIds: [admin.id],
    });

    await expect(authorization.isActiveOperator(admin.id)).resolves.toBe(true);
    await expect(initializePlatformOperatorAuthorization(identities, {
      operatorUserIds: [9_999_999_999_999n],
    })).rejects.toEqual(new PlatformOperatorInitializationError(
      "CONFIGURED_USER_IDS_NOT_FOUND",
      ["9999999999999"],
    ));
  });

  it("excludes globally disabled users from every tenant active-user metric", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const [currency, organization] = await Promise.all([
      prisma!.currency.findFirstOrThrow({ where: { code: "SAR", scopeKey: "GLOBAL" }, select: { id: true } }),
      prisma!.organization.create({ data: { code: `PLT-USR-${suffix}`, name: `Platform user metric ${suffix}` } }),
    ]);
    const company = await prisma!.company.create({
      data: {
        organizationId: organization.id,
        baseCurrencyId: currency.id,
        code: `PLT-USR-${suffix}`,
        name: `Platform user metric ${suffix}`,
        timezone: "Asia/Riyadh",
      },
    });
    const user = await prisma!.user.create({
      data: {
        emailNormalized: `platform-disabled-${suffix}@example.test`,
        passwordHash: "not-used-by-this-test",
        displayName: "Disabled metric fixture",
        isActive: false,
        assignments: { create: { companyId: company.id, isActive: true } },
      },
    });
    try {
      const adapter = new PrismaPlatformAnalyticsQueryAdapter(prisma!);
      const now = new Date("2048-06-30T00:00:00.000Z");
      const [list, details, usage] = await Promise.all([
        adapter.listCompanies({ now, days: 30, search: company.code, status: "ALL", page: 1, pageSize: 25 }),
        adapter.companyDetails({ companyId: company.id, now, days: 30 }),
        adapter.companyUsage({
          companyId: company.id,
          periodStart: new Date("2048-06-01T00:00:00.000Z"),
          periodEndExclusive: new Date("2048-07-01T00:00:00.000Z"),
        }),
      ]);

      expect(list.data).toHaveLength(1);
      expect(list.data[0]!.activeUsers).toBe(0);
      expect(details?.metrics.totalUsers).toBe(1);
      expect(details?.metrics.activeUsers).toBe(0);
      expect(usage?.users).toBe(0);
    } finally {
      await prisma!.userCompany.deleteMany({ where: { userId: user.id, companyId: company.id } });
      await prisma!.user.delete({ where: { id: user.id } });
      await prisma!.company.delete({ where: { id: company.id } });
      await prisma!.organization.delete({ where: { id: organization.id } });
    }
  });
});
