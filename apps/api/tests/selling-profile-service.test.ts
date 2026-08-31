import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SellingProfileService } from "../src/sales/selling-profile-service.js";
import type { SellingProfileRecord } from "../src/sales/selling-profile-ports.js";

const context = { companyId: 7n, userId: 4n };
const item = { id: 11n, code: "ITM-11", nameAr: "حليب", nameEn: "Milk", description: null, isActive: true,
  unitOfMeasure: { id: 13n, code: "EA", nameAr: "حبة", nameEn: "Each", decimalPlaces: 0, isActive: true } };
const profile: SellingProfileRecord = { id: 17n, companyId: 7n, inventoryItemId: 11n, unitPrice: "0.0000", currencyId: 2n,
  revenueAccountId: 3n, taxRateId: 5n, isActive: true, version: 1 };
function harness(withProfile = true) {
  let saved: SellingProfileRecord | null = withProfile ? { ...profile } : null;
  const tx = { idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 1n }), update: vi.fn().mockResolvedValue({}) } };
  const prisma = { ...tx, $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  const ports = {
    inventory: { list: vi.fn().mockResolvedValue({ data: [item], total: 1 }), find: vi.fn().mockResolvedValue(item) },
    profiles: { findMany: vi.fn(async () => saved ? [saved] : []),
      create: vi.fn(async (_tx, companyId, inventoryItemId, values) => {
        saved = { ...values, id: 17n, companyId, inventoryItemId, version: 1 } as SellingProfileRecord; return saved;
      }),
      update: vi.fn(async (_tx, companyId, inventoryItemId, version, values) => {
        saved = { ...values, id: 17n, companyId, inventoryItemId, version: version + 1 } as SellingProfileRecord; return saved;
      }) },
    currencies: { enabled: vi.fn().mockResolvedValue(new Map([["2", { id: 2n, code: "SAR" }]])) },
    accounts: { findMany: vi.fn().mockResolvedValue(new Map([["3", { id: 3n, companyId: 7n, code: "REV",
      isActive: true, allowsPosting: true, accountClass: "REVENUE", childCount: 0 }]])) },
    tax: { readyIds: vi.fn().mockResolvedValue(new Set(["5"])) }, audit: { append: vi.fn().mockResolvedValue(undefined) },
  };
  return { service: new SellingProfileService(prisma as unknown as PrismaClient, ports), ports, tx };
}

describe("selling profile application boundary", () => {
  it("preserves zero and bigint strings and enriches one bounded page in batches", async () => {
    const { service, ports, tx } = harness();
    const result = await service.list(context, { page: 3, pageSize: 24, search: " milk " });
    expect(ports.inventory.list).toHaveBeenCalledWith(tx, 7n, { page: 3, pageSize: 24, search: "milk" });
    expect(result.data[0]).toMatchObject({ inventoryItemId: "11", isReady: true,
      sellingProfile: { unitPrice: "0.0000", currencyCode: "SAR", revenueAccountId: "3", taxRateId: "5" } });
    for (const fn of [ports.profiles.findMany, ports.currencies.enabled, ports.accounts.findMany, ports.tax.readyIds]) {
      expect(fn).toHaveBeenCalledTimes(1); expect(fn.mock.calls[0]?.[0]).toBe(tx); expect(fn.mock.calls[0]?.[1]).toBe(7n);
    }
  });
  it("does not expose a foreign item through a known id", async () => {
    const { service, ports, tx } = harness(); ports.inventory.find.mockResolvedValue(null);
    await expect(service.get({ ...context, companyId: 99n }, 11n)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    expect(ports.inventory.find).toHaveBeenCalledWith(tx, 99n, 11n);
    expect(ports.profiles.findMany).not.toHaveBeenCalled();
  });
  it("distinguishes missing defaults and unavailable currency", async () => {
    const missing = harness(false);
    expect((await missing.service.get(context, 11n)).data).toMatchObject({ sellingProfile: null, isReady: false, readinessReason: "PROFILE_MISSING" });
    const h = harness(); h.ports.currencies.enabled.mockResolvedValue(new Map());
    expect((await h.service.get(context, 11n)).data).toMatchObject({ isReady: false, readinessReason: "CURRENCY_UNAVAILABLE", sellingProfile: { currencyCode: null } });
  });
  it("creates only through its repository and audits inside the same idempotent transaction", async () => {
    const { service, ports, tx } = harness(false);
    const result = await service.create(context, 11n, { unitPrice: "2.1", currencyId: 2n, revenueAccountId: 3n, taxRateId: 5n }, "create-profile-1");
    expect(result.data.sellingProfile?.unitPrice).toBe("2.1000");
    expect(ports.profiles.create).toHaveBeenCalledWith(tx, 7n, 11n, expect.objectContaining({ unitPrice: "2.1000" }));
    expect(ports.audit.append).toHaveBeenCalledWith(tx, context, expect.objectContaining({ fromVersion: null, toVersion: 1 }));
    expect(tx.idempotencyRecord.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", responseBody: result }) }));
  });
  it("rejects stale versions before write or audit", async () => {
    const { service, ports } = harness();
    await expect(service.update(context, 11n, { version: 2, unitPrice: "3" }, "stale-version-1")).rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    expect(ports.profiles.update).not.toHaveBeenCalled(); expect(ports.audit.append).not.toHaveBeenCalled();
  });
  it("can disable stale references but never reactivate or replace them without validation", async () => {
    const { service, ports } = harness(); ports.accounts.findMany.mockResolvedValue(new Map());
    expect((await service.update(context, 11n, { version: 1, isActive: false }, "disable-profile-1")).data.sellingProfile?.version).toBe(2);
    await expect(service.update(context, 11n, { version: 2, isActive: true }, "reactivate-profile-1")).rejects.toMatchObject({ reason: "REVENUE_ACCOUNT_INVALID" });
    await expect(service.update(context, 11n, { version: 2, unitPrice: "4" }, "replace-profile-1")).rejects.toMatchObject({ reason: "REVENUE_ACCOUNT_INVALID" });
  });
  it("invalid references never complete idempotency or audit", async () => {
    const { service, ports, tx } = harness(false); ports.tax.readyIds.mockResolvedValue(new Set());
    await expect(service.create(context, 11n, { unitPrice: "2", currencyId: 2n, revenueAccountId: 3n, taxRateId: 5n }, "invalid-tax-1"))
      .rejects.toMatchObject({ reason: "TAX_RATE_INVALID" });
    expect(ports.profiles.create).not.toHaveBeenCalled(); expect(tx.idempotencyRecord.update).not.toHaveBeenCalled();
  });
});
