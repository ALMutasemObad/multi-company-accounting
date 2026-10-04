import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ServiceCatalogRevenueAccountAdapter } from "../src/accounts/service-catalog-revenue-account-adapter.js";
import { ServiceCatalogOutputTaxAdapter } from "../src/tax/service-catalog-output-tax-adapter.js";
import { TaxService } from "../src/tax/tax-service.js";
import { ServiceCatalogService } from "../src/service-catalog/service-catalog-service.js";

describe("service catalog reference owner adapters", () => {
  it("accepts only active posting revenue leaves in the owning company", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 1n, isActive: true, allowsPosting: true, accountType: { class: "REVENUE" }, _count: { children: 0 } },
      { id: 2n, isActive: false, allowsPosting: true, accountType: { class: "REVENUE" }, _count: { children: 0 } },
      { id: 3n, isActive: true, allowsPosting: true, accountType: { class: "ASSET" }, _count: { children: 0 } },
      { id: 4n, isActive: true, allowsPosting: true, accountType: { class: "REVENUE" }, _count: { children: 1 } },
    ]);
    const tx = { account: { findMany } } as never;
    expect(await new ServiceCatalogRevenueAccountAdapter({} as never).readyIds(tx, 9n, [1n, 2n, 3n, 4n])).toEqual(new Set(["1"]));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 9n, id: { in: [1n, 2n, 3n, 4n] } } }));
    await expect(new ServiceCatalogRevenueAccountAdapter({} as never).readyIds(tx, 9n, Array(101).fill(1n))).rejects.toThrow("UNBOUNDED_ACCOUNT_QUERY");
  });

  it("delegates OUTPUT tax readiness to the tax owner and bounds the query", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 5n }, { id: 6n }]);
    const readiness = vi.spyOn(TaxService, "json").mockImplementation((rate) => ({ isReady: rate.id === 5n }) as never);
    try {
      const tx = { taxRate: { findMany } } as never;
      expect(await new ServiceCatalogOutputTaxAdapter({} as never).readyIds(tx, 9n, [5n, 6n])).toEqual(new Set(["5"]));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 9n, id: { in: [5n, 6n] } } }));
      expect(readiness).toHaveBeenCalledWith(expect.anything(), "OUTPUT");
      await expect(new ServiceCatalogOutputTaxAdapter({} as never).readyIds(tx, 9n, Array(101).fill(5n))).rejects.toThrow("UNBOUNDED_TAX_QUERY");
    } finally {
      readiness.mockRestore();
    }
  });

  it("rejects invalid defaults and keeps omitted, clear and valid references distinct", async () => {
    const accounts = { readyIds: vi.fn().mockResolvedValue(new Set(["31"])), listOptions: vi.fn() };
    const tax = { readyIds: vi.fn().mockResolvedValue(new Set(["41"])), listOptions: vi.fn() };
    const service = new ServiceCatalogService({} as never, accounts, tax) as unknown as {
      resolveDefaultReferences(tx: never, companyId: bigint, accountId: bigint | null | undefined, taxId: bigint | null | undefined):
        Promise<{ defaultRevenueAccountId: bigint | null | undefined; defaultOutputTaxRateId: bigint | null | undefined }>;
    };
    expect(await service.resolveDefaultReferences({} as never, 9n, undefined, null))
      .toEqual({ defaultRevenueAccountId: undefined, defaultOutputTaxRateId: null });
    expect(await service.resolveDefaultReferences({} as never, 9n, 31n, 41n))
      .toEqual({ defaultRevenueAccountId: 31n, defaultOutputTaxRateId: 41n });
    expect(accounts.readyIds).toHaveBeenCalledWith(expect.anything(), 9n, [31n]);
    accounts.readyIds.mockResolvedValueOnce(new Set());
    await expect(service.resolveDefaultReferences({} as never, 9n, 31n, null))
      .rejects.toMatchObject({ reason: "REVENUE_ACCOUNT_INVALID" });
    tax.readyIds.mockResolvedValueOnce(new Set());
    await expect(service.resolveDefaultReferences({} as never, 9n, null, 41n))
      .rejects.toMatchObject({ reason: "OUTPUT_TAX_RATE_INVALID" });
  });

  it("lists only company-scoped eligible revenue accounts with bounded pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 31n, code: "4101", nameAr: "إيراد", nameEn: "Revenue" }]);
    const count = vi.fn().mockResolvedValue(1);
    const adapter = new ServiceCatalogRevenueAccountAdapter({ account: { findMany, count } } as never);
    expect(await adapter.listOptions(9n, { page: 2, pageSize: 20, search: "إيراد" })).toEqual({
      data: [{ id: "31", code: "4101", nameAr: "إيراد", nameEn: "Revenue" }],
      meta: { page: 2, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: 9n, isActive: true, allowsPosting: true,
        accountType: { is: { class: "REVENUE" } }, children: { none: {} } }), skip: 20, take: 20,
    }));
    expect(count).toHaveBeenCalledWith({ where: findMany.mock.calls[0]![0].where });
  });

  it("lists only ready OUTPUT taxes, including zero rates without an account", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 41n, code: "TAX-1", nameAr: "ضريبة", rate: new Prisma.Decimal("15") }]);
    const count = vi.fn().mockResolvedValue(1);
    const adapter = new ServiceCatalogOutputTaxAdapter({ taxRate: { findMany, count } } as never);
    expect(await adapter.listOptions(9n, { page: 1, pageSize: 20 })).toEqual({
      data: [{ id: "41", code: "TAX-1", nameAr: "ضريبة", rate: "15.0000" }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: 9n, isActive: true,
        AND: [{ OR: [{ rate: new Prisma.Decimal(0) }, { outputTaxAccount: { is: {
          isActive: true, allowsPosting: true, accountType: { is: { class: "LIABILITY" } }, children: { none: {} },
        } } }] }],
      }),
    }));
    expect(count).toHaveBeenCalledWith({ where: findMany.mock.calls[0]![0].where });
  });
});
