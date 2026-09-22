import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../src/platform/actor-context.js";
import type { InventoryMovementService } from "../src/inventory/inventory-movement-service.js";
import {
  currentInventoryValuationReport,
  inventoryValuationXlsx,
} from "../src/inventory/inventory-valuation-report/report.js";

const context = { companyId: 71n, userId: 8n } as ActorContext;
const balance = (id: bigint, initialized: boolean, nameAr = `صنف ${id}`) => ({
  id,
  companyId: context.companyId,
  warehouseId: 3n,
  inventoryItemId: id,
  onHand: new Prisma.Decimal("2.000000"),
  inventoryValueBase: new Prisma.Decimal(initialized ? "25.1250" : "0"),
  averageUnitCostBase: new Prisma.Decimal(initialized ? "12.56250000" : "0"),
  isValuationInitialized: initialized,
  version: 1,
  movementCount: 1,
  updatedAt: new Date("2026-09-21T12:00:00.000Z"),
  warehouse: { id: 3n, code: "MAIN", nameAr: "الرئيسي", nameEn: "Main" },
  inventoryItem: {
    id, code: `IT-${id}`, nameAr, nameEn: null,
    barcodes: [{ value: `978000000000${id}` }],
    unitOfMeasure: { id: 2n, code: "EA", nameAr: "حبة", nameEn: "Each", decimalPlaces: 0 },
  },
});

describe("current inventory valuation report", () => {
  it("passes the authorized company context, filters valuation status and excludes unvalued value", async () => {
    const listBalances = vi.fn().mockResolvedValue({ data: [balance(1n, true), balance(2n, false)], total: 2 });
    const report = await currentInventoryValuationReport(
      { listBalances } as unknown as InventoryMovementService,
      context,
      { valuationStatus: "ALL", warehouseId: 3n },
    );
    expect(listBalances).toHaveBeenCalledWith(context, expect.objectContaining({ warehouseId: 3n, nonZero: true }));
    expect(report.basis).toBe("CURRENT_BALANCE");
    expect(report.valuationPolicy).toBe("MOVING_WEIGHTED_AVERAGE");
    expect(report.totals).toMatchObject({ rowCount: 2, valuedRowCount: 1, unvaluedRowCount: 1, valuedInventoryValueBase: "25.1250" });
  });

  it("creates a real XLSX and keeps formula-looking item names as text", async () => {
    const listBalances = vi.fn().mockResolvedValue({ data: [balance(1n, true, "=HYPERLINK(1)")], total: 1 });
    const report = await currentInventoryValuationReport(
      { listBalances } as unknown as InventoryMovementService,
      context,
      { valuationStatus: "VALUED" },
    );
    const workbook = inventoryValuationXlsx(report);
    expect(workbook.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(workbook.toString("utf8")).toContain('t="inlineStr"');
    expect(workbook.toString("utf8")).not.toContain("<f>");
    expect(workbook.toString("utf8")).toContain("متوسط التكلفة المرجح المتحرك");
    expect(workbook.toString("utf8")).toContain("9780000000001");
  });
});
