import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  InventoryCatalogService,
  inventoryQuantityFitsUnit,
} from "../src/inventory/inventory-catalog-service.js";

function transaction(input?: {
  warehouse?: { id: bigint; code: string; nameAr: string } | null;
  items?: Array<{
    id: bigint;
    code: string;
    nameAr: string;
    description: string | null;
    unitOfMeasure: { code: string; decimalPlaces: number };
  }>;
}) {
  return {
    warehouse: { findFirst: vi.fn().mockResolvedValue(input?.warehouse ?? null) },
    inventoryItem: { findMany: vi.fn().mockResolvedValue(input?.items ?? []) },
  } as unknown as Prisma.TransactionClient;
}

describe("Inventory invoice catalog port", () => {
  const service = new InventoryCatalogService({} as PrismaClient);

  it("requires a warehouse as soon as an invoice line selects a catalog item", async () => {
    await expect(service.resolveInvoiceSelection(transaction(), {
      companyId: 7n,
      warehouseId: null,
      inventoryItemIds: [11n],
    })).rejects.toMatchObject({
      reason: "WAREHOUSE_REQUIRED",
    });
  });

  it("fails closed for inactive or cross-company warehouse and item references", async () => {
    await expect(service.resolveInvoiceSelection(transaction(), {
      companyId: 7n,
      warehouseId: 9n,
      inventoryItemIds: [],
    })).rejects.toMatchObject({ reason: "INVALID_WAREHOUSE" });

    await expect(service.resolveInvoiceSelection(transaction({
      warehouse: { id: 9n, code: "WH-000009", nameAr: "الرئيسي" },
    }), {
      companyId: 7n,
      warehouseId: 9n,
      inventoryItemIds: [11n],
    })).rejects.toMatchObject({ reason: "INVALID_INVENTORY_ITEM" });
  });

  it("deduplicates item identifiers and returns transport-neutral references", async () => {
    const tx = transaction({
      warehouse: { id: 9n, code: "WH-000009", nameAr: "الرئيسي" },
      items: [{
        id: 11n,
        code: "ITM-000011",
        nameAr: "قلم",
        description: "قلم أزرق",
        unitOfMeasure: { code: "EA", decimalPlaces: 0 },
      }],
    });
    const result = await service.resolveInvoiceSelection(tx, {
      companyId: 7n,
      warehouseId: 9n,
      inventoryItemIds: [11n, 11n],
    });

    expect(result.warehouse?.code).toBe("WH-000009");
    expect(result.items.get("11")?.unitOfMeasure).toEqual({ code: "EA", decimalPlaces: 0 });
    expect(tx.inventoryItem.findMany).toHaveBeenCalledOnce();
  });

  it("enforces the decimal precision declared by the unit of measure", () => {
    expect(inventoryQuantityFitsUnit("3.000000", 0)).toBe(true);
    expect(inventoryQuantityFitsUnit("3.125000", 3)).toBe(true);
    expect(inventoryQuantityFitsUnit("3.125001", 3)).toBe(false);
  });
});
