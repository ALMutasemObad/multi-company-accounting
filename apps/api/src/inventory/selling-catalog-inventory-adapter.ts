import type { Prisma } from "@prisma/client";
import type { SellingCatalogInventoryPort, SellingCatalogQuery } from "../sales/selling-profile-ports.js";

const select = {
  id: true, code: true, nameAr: true, nameEn: true, description: true, isActive: true,
  unitOfMeasure: { select: { id: true, code: true, nameAr: true, nameEn: true, decimalPlaces: true, isActive: true } },
} as const;

/** Inventory-owned identity projection. No pricing, barcode parser or stock availability claim. */
export class SellingCatalogInventoryAdapter implements SellingCatalogInventoryPort {
  async list(tx: Prisma.TransactionClient, companyId: bigint, query: SellingCatalogQuery) {
    if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 10000
      || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100
      || (query.search?.length ?? 0) > 100) throw new RangeError("UNBOUNDED_CATALOG_QUERY");
    const where: Prisma.InventoryItemWhereInput = { companyId,
      ...(query.search ? { OR: [{ code: { contains: query.search } },
        { nameAr: { contains: query.search } }, { nameEn: { contains: query.search } }] } : {}) };
    const data = await tx.inventoryItem.findMany({ where, select,
      orderBy: [{ code: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
    return { data, total: await tx.inventoryItem.count({ where }) };
  }
  find(tx: Prisma.TransactionClient, companyId: bigint, itemId: bigint) {
    return tx.inventoryItem.findFirst({ where: { companyId, id: itemId }, select });
  }
}
