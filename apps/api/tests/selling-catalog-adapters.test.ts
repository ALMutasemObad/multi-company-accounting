import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SellingCatalogInventoryAdapter } from "../src/inventory/selling-catalog-inventory-adapter.js";
import { SellingCatalogAccountAdapter } from "../src/accounts/selling-catalog-account-adapter.js";
import { SellingCatalogCurrencyAdapter } from "../src/companies/selling-catalog-currency-adapter.js";
import { SellingCatalogTaxAdapter } from "../src/tax/selling-catalog-tax-adapter.js";
import { PrismaSellingProfileRepository } from "../src/sales/prisma-selling-profile-repository.js";

describe("selling catalog owner-side batching", () => {
  it("paginates/searches/counts Inventory in the DB with stable order and no barcode lookup", async () => {
    const inventoryItem = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(301) };
    const tx = { inventoryItem } as unknown as Prisma.TransactionClient;
    const adapter = new SellingCatalogInventoryAdapter();
    expect(await adapter.list(tx, 7n, { page: 3, pageSize: 24, search: "milk" })).toEqual({ data: [], total: 301 });
    expect(inventoryItem.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { companyId: 7n, OR: [{ code: { contains: "milk" } }, { nameAr: { contains: "milk" } }, { nameEn: { contains: "milk" } }] },
      orderBy: [{ code: "asc" }, { id: "asc" }], skip: 48, take: 24,
    }));
    await expect(adapter.list(tx, 7n, { page: 1, pageSize: 101 })).rejects.toThrow("UNBOUNDED_CATALOG_QUERY");
  });
  it("uses one query per reference owner for a maximum batch and scopes every query", async () => {
    const account = { findMany: vi.fn().mockResolvedValue([]) };
    const companyCurrency = { findMany: vi.fn().mockResolvedValue([]) };
    const taxRate = { findMany: vi.fn().mockResolvedValue([]) };
    const salesItemSellingProfile = { findMany: vi.fn().mockResolvedValue([]) };
    const tx = { account, companyCurrency, taxRate, salesItemSellingProfile } as unknown as Prisma.TransactionClient;
    const ids = Array.from({ length: 100 }, (_, i) => BigInt(i + 1));
    await new SellingCatalogAccountAdapter().findMany(tx, 7n, ids);
    await new SellingCatalogCurrencyAdapter().enabled(tx, 7n, ids);
    await new SellingCatalogTaxAdapter().readyIds(tx, 7n, ids);
    await new PrismaSellingProfileRepository().findMany(tx, 7n, ids);
    for (const owner of [account, companyCurrency, taxRate, salesItemSellingProfile]) {
      expect(owner.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: expect.objectContaining({ companyId: 7n }) }));
    }
    expect(companyCurrency.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isActive: true,
      currency: { isActive: true, OR: [{ scope: "GLOBAL", ownerCompanyId: null }, { scope: "COMPANY", ownerCompanyId: 7n }] } }) }));
  });
  it("delegates output-tax readiness to Tax, including zero and inactive rates", async () => {
    const rate = { id: 5n, companyId: 7n, code: "TAX", nameAr: "Tax", rate: new Prisma.Decimal(0),
      isActive: true, version: 1, outputTaxAccountId: null, inputTaxAccountId: null, outputTaxAccount: null, inputTaxAccount: null };
    const tx = { taxRate: { findMany: vi.fn().mockResolvedValue([rate, { ...rate, id: 6n, isActive: false },
      { ...rate, id: 8n, rate: new Prisma.Decimal(15) }]) } } as unknown as Prisma.TransactionClient;
    expect(await new SellingCatalogTaxAdapter().readyIds(tx, 7n, [5n, 6n, 8n])).toEqual(new Set(["5"]));
  });
  it("guards repository updates with company + item + version and reports conflict", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = { salesItemSellingProfile: { updateMany } } as unknown as Prisma.TransactionClient;
    const values = { unitPrice: "2.0000", currencyId: 2n, revenueAccountId: 3n, taxRateId: null, isActive: true };
    await expect(new PrismaSellingProfileRepository().update(tx, 7n, 11n, 1, values)).rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    expect(updateMany).toHaveBeenCalledWith({ where: { companyId: 7n, inventoryItemId: 11n, version: 1 }, data: { ...values, version: { increment: 1 } } });
  });
});
