import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { openApiResponseBodySchemas } from "../src/generated/openapi-request-guards.js";
import { PUBLIC_PLAN_MAX_PAGE, PUBLIC_PLAN_PAGE_SIZE, publicPlanWhere, readPublicPlanCatalog } from "../src/platform-subscriptions/public-plan-catalog.js";
import { PlatformSubscriptionCatalogService } from "../src/platform-subscriptions/platform-subscription-service.js";

const now = new Date("2026-08-31T00:00:00.000Z");
const row = {
  id: 9007199254740993n, displayName: "Public plan", description: null, billingCycle: "MONTHLY", currencyCode: "SAR",
  recurringFee: new Prisma.Decimal("999999999999.1234"), taxRate: new Prisma.Decimal("15.0000"), trialDays: 14,
  includedUsers: 5, includedEmployees: 10, includedPostedDocuments: 100,
  pricePerAdditionalUser: new Prisma.Decimal("0.0001"), pricePerAdditionalEmployee: null, pricePerAdditionalPostedDocument: null,
  selfServicePolicy: "REQUEST_ONLY",
  entitlements: [{ selectionMode: "INCLUDED", additionalRecurringFee: null, module: { code: "CORE_ACCOUNTING", displayName: "Accounting" } }],
};

describe("public subscription plan catalog", () => {
  it("uses one bounded database page and a matching count with an explicit public projection", async () => {
    const count = vi.fn().mockResolvedValue(20);
    const findMany = vi.fn().mockResolvedValue([row]);
    const result = await readPublicPlanCatalog({ platformPlanVersion: { count, findMany } } as never, 2, now);
    expect(count).toHaveBeenCalledExactlyOnceWith({ where: publicPlanWhere(now) });
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: publicPlanWhere(now), select: expect.any(Object),
      skip: 9, take: PUBLIC_PLAN_PAGE_SIZE,
      orderBy: [{ planId: "asc" }, { versionNumber: "desc" }, { id: "desc" }],
    });
    const select = findMany.mock.calls[0]![0].select;
    expect(Object.keys(select).sort()).toEqual([
      "id", "displayName", "description", "billingCycle", "currencyCode", "recurringFee", "includedUsers",
      "includedEmployees", "includedPostedDocuments", "pricePerAdditionalUser", "pricePerAdditionalEmployee",
      "pricePerAdditionalPostedDocument", "trialDays", "taxRate", "selfServicePolicy", "entitlements",
    ].sort());
    expect(select.entitlements.take).toBe(100);
    expect(select.entitlements.select.module).toEqual({ select: { code: true, displayName: true } });
    expect(result.meta).toEqual({ page: 2, pageSize: 9, total: 20, totalPages: 3 });
    expect(result.plans[0]).toMatchObject({ id: "9007199254740993", recurringFee: "999999999999.1234", pricePerAdditionalUser: "0.0001", requiresApproval: true });
    expect(openApiResponseBodySchemas.listPublicSubscriptionPlans[200].safeParse(result).success).toBe(true);
  });

  it("requires opt-in, publication, availability and full prices at query time", () => {
    expect(publicPlanWhere(now)).toEqual({
      publiclyListed: true, publishedAt: { not: null }, retiredAt: null, effectiveFrom: { lte: now },
      selfServicePolicy: { not: "DISABLED" }, recurringFee: { not: null },
      includedUsers: { not: null }, includedEmployees: { not: null }, includedPostedDocuments: { not: null },
      plan: { isActive: true, code: { not: { startsWith: "LEGACY_COMPANY_" } } },
      entitlements: { none: { module: { isActive: false } } },
    });
  });

  it.each([0, -1, 1.5, NaN, Infinity, PUBLIC_PLAN_MAX_PAGE + 1])("rejects invalid page %s before any database read", async (page) => {
    await expect(readPublicPlanCatalog({} as never, page, now)).rejects.toThrow(RangeError);
  });

  it("does not serialize private data even when a repository stub returns extra fields", async () => {
    const result = await readPublicPlanCatalog({ platformPlanVersion: {
      count: async () => 1,
      findMany: async () => [{ ...row, createdById: 7n, planId: 8n, companyId: 9n, internalNotes: "private",
        plan: { code: "PRIVATE_CODE" }, entitlements: [{ ...row.entitlements[0], module: { code: "CORE_ACCOUNTING", displayName: "Accounting", id: 12n, permissions: ["secret"] } }] }],
    } } as never, 1, now);
    expect(JSON.stringify(result)).not.toMatch(/createdById|companyId|planId|PRIVATE_CODE|private|permissions|secret/);
  });

  it("rejects visibility writes by non-operators before starting a transaction", async () => {
    const transaction = vi.fn();
    const service = new PlatformSubscriptionCatalogService({ $transaction: transaction } as never, { isOperator: async () => false });
    await expect(service.setPublicListing({ userId: 3n }, 1n, { publiclyListed: true, version: 0 })).rejects.toMatchObject({ reason: "FORBIDDEN" });
    expect(transaction).not.toHaveBeenCalled();
  });

  function visibilityFixture(overrides: Record<string, unknown> = {}) {
    const module = { id: 1n, code: "CORE_ACCOUNTING", displayName: "Accounting", isActive: true, dependencies: [] };
    const version = {
      ...row, id: 12n, planId: 4n, versionNumber: 1, version: 3, publiclyListed: false,
      plan: { code: "BASIC", isActive: true }, publishedAt: now, retiredAt: null, effectiveFrom: now,
      entitlements: [{ moduleId: 1n, module, selectionMode: "INCLUDED", additionalRecurringFee: null }],
      ...overrides,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]),
      platformPlanVersion: { findUnique: vi.fn().mockResolvedValue(version), updateMany },
      platformModule: { findMany: vi.fn().mockResolvedValue([module]) },
    };
    const service = new PlatformSubscriptionCatalogService(
      { $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx) } as never,
      { isOperator: async () => true }, () => now,
    );
    return { service, tx, updateMany };
  }

  it.each([
    [{ publishedAt: null }, "PLAN_NOT_PUBLISHED"], [{ retiredAt: now }, "PLAN_NOT_PUBLISHED"],
    [{ selfServicePolicy: "DISABLED" }, "SELF_SERVICE_DISABLED"],
    [{ plan: { code: "LEGACY_COMPANY_123", isActive: true } }, "SELF_SERVICE_DISABLED"],
    [{ plan: { code: "BASIC", isActive: false } }, "SELF_SERVICE_DISABLED"],
    [{ effectiveFrom: new Date("2027-01-01") }, "PLAN_NOT_EFFECTIVE"],
    [{ recurringFee: null }, "DRAFT_INCOMPLETE"], [{ includedUsers: null }, "DRAFT_INCOMPLETE"],
  ] as const)("rejects ineligible public listing %j", async (overrides, reason) => {
    const { service, updateMany } = visibilityFixture(overrides);
    await expect(service.setPublicListing({ userId: 7n }, 12n, { publiclyListed: true, version: 3 })).rejects.toMatchObject({ reason });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("checks missing/stale versions and revalidates modules before publication", async () => {
    const { service, tx, updateMany } = visibilityFixture();
    tx.platformPlanVersion.findUnique.mockResolvedValueOnce(null);
    await expect(service.setPublicListing({ userId: 7n }, 12n, { publiclyListed: true, version: 3 })).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(service.setPublicListing({ userId: 7n }, 12n, { publiclyListed: true, version: 2 })).rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    tx.platformModule.findMany.mockResolvedValueOnce([]);
    await expect(service.setPublicListing({ userId: 7n }, 12n, { publiclyListed: true, version: 3 })).rejects.toMatchObject({ reason: "INVALID_MODULE" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("only changes visibility, actor and optimistic version, and permits hiding an unavailable plan", async () => {
    const { service, updateMany, tx } = visibilityFixture();
    const result = await service.setPublicListing({ userId: 7n }, 12n, { publiclyListed: true, version: 3 });
    expect(result.version).toMatchObject({ publiclyListed: true, version: 4, recurringFee: "999999999999.1234" });
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 12n, version: 3 },
      data: { publiclyListed: true, updatedById: 7n, version: { increment: 1 } },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const hidden = await visibilityFixture({ retiredAt: now, publiclyListed: true }).service
      .setPublicListing({ userId: 7n }, 12n, { publiclyListed: false, version: 3 });
    expect(hidden.version.publiclyListed).toBe(false);
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.setPublicListing({ userId: 7n }, 12n, { publiclyListed: true, version: 3 })).rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
  });

  it("migrates existing plans to private by default without changing subscription or billing data", async () => {
    const root = new URL("../prisma/migrations/20260831090000_public_subscription_plans/", import.meta.url);
    const sql = await readFile(new URL("migration.sql", root), "utf8");
    const rollback = await readFile(new URL("rollback.sql", root), "utf8");
    expect(sql).toMatch(/publicly_listed.*BOOLEAN NOT NULL DEFAULT FALSE/);
    expect(sql).toContain("platform_plan_versions_public_catalog_idx");
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/);
    expect(rollback).toContain("DROP COLUMN");
  });
});
