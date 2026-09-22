import type { PrismaClient } from "@prisma/client";
import type {
  InventoryAgingBalance,
  InventoryAgingReportPort,
} from "./types.js";

export class PrismaInventoryAgingReportPort implements InventoryAgingReportPort {
  constructor(private readonly prisma: PrismaClient) {}

  async listPositiveBalances(companyId: bigint): Promise<InventoryAgingBalance[]> {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { companyId, onHand: { gt: 0 } },
      select: {
        id: true,
        inventoryItemId: true,
        warehouseId: true,
        onHand: true,
        averageUnitCostBase: true,
        inventoryValueBase: true,
        isValuationInitialized: true,
        inventoryItem: {
          select: {
            nameAr: true,
            unitOfMeasure: { select: { code: true } },
            barcodes: {
              where: { isPrimary: true, isActive: true },
              select: { value: true },
              take: 1,
            },
          },
        },
        warehouse: { select: { code: true, nameAr: true } },
      },
      orderBy: [{ warehouse: { code: "asc" } }, { inventoryItem: { nameAr: "asc" } }],
    });

    return balances.map((balance) => ({
      balanceId: balance.id,
      inventoryItemId: balance.inventoryItemId,
      barcode: balance.inventoryItem.barcodes[0]?.value ?? null,
      itemName: balance.inventoryItem.nameAr,
      unitOfMeasureCode: balance.inventoryItem.unitOfMeasure.code,
      warehouseId: balance.warehouseId,
      warehouseCode: balance.warehouse.code,
      warehouseName: balance.warehouse.nameAr,
      onHand: balance.onHand.toFixed(),
      averageUnitCostBase: balance.averageUnitCostBase.toFixed(),
      inventoryValueBase: balance.inventoryValueBase.toFixed(),
      isValuationInitialized: balance.isValuationInitialized,
    }));
  }

  async listMovementFacts(
    companyId: bigint,
    asOf: Date,
    balances: ReadonlyArray<Pick<InventoryAgingBalance, "inventoryItemId" | "warehouseId">>,
  ) {
    if (balances.length === 0) return [];
    const inventoryItemIds = [...new Set(balances.map((balance) => balance.inventoryItemId))];
    const warehouseIds = [...new Set(balances.map((balance) => balance.warehouseId))];
    return this.prisma.inventoryMovementLine.findMany({
      where: {
        companyId,
        inventoryItemId: { in: inventoryItemIds },
        OR: [
          { fromWarehouseId: { in: warehouseIds } },
          { toWarehouseId: { in: warehouseIds } },
        ],
        movement: {
          companyId,
          status: "POSTED",
          movementDate: { lte: asOf },
        },
      },
      select: {
        inventoryItemId: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        movement: { select: { movementDate: true } },
      },
      orderBy: [{ movement: { movementDate: "desc" } }, { id: "desc" }],
    }).then((lines) => lines.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      fromWarehouseId: line.fromWarehouseId,
      toWarehouseId: line.toWarehouseId,
      movementDate: line.movement.movementDate,
    })));
  }
}
