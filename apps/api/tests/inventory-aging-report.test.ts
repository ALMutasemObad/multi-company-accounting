import { describe, expect, it, vi } from "vitest";
import {
  classifyInventoryAge,
  InventoryAgingReportService,
  type InventoryAgingReportPort,
} from "../src/inventory/inventory-aging-report/index.js";

const policy = { slowMovingDays: 30, stagnantDays: 90 };

describe("inventory aging report", () => {
  it("classifies exact policy boundaries and inventory with no movement", () => {
    expect(classifyInventoryAge(29, policy)).toBe("ACTIVE");
    expect(classifyInventoryAge(30, policy)).toBe("SLOW_MOVING");
    expect(classifyInventoryAge(89, policy)).toBe("SLOW_MOVING");
    expect(classifyInventoryAge(90, policy)).toBe("STAGNANT");
    expect(classifyInventoryAge(null, policy)).toBe("NO_MOVEMENT");
  });

  it("rejects overlapping or non-positive aging thresholds", () => {
    expect(() => classifyInventoryAge(1, { slowMovingDays: 0, stagnantDays: 90 }))
      .toThrow("INVALID_INVENTORY_AGING_POLICY");
    expect(() => classifyInventoryAge(1, { slowMovingDays: 90, stagnantDays: 90 }))
      .toThrow("INVALID_INVENTORY_AGING_POLICY");
  });

  it("isolates the company, derives the last movement per warehouse, and excludes unvalued totals", async () => {
    const port: InventoryAgingReportPort = {
      listPositiveBalances: vi.fn().mockResolvedValue([
        {
          balanceId: 1n,
          inventoryItemId: 11n,
          itemCode: "ITM-11",
          itemName: "صنف مقيم",
          unitOfMeasureCode: "EA",
          warehouseId: 101n,
          warehouseCode: "WH-1",
          warehouseName: "الرئيسي",
          onHand: "4",
          averageUnitCostBase: "5.00000000",
          inventoryValueBase: "20.0000",
          isValuationInitialized: true,
        },
        {
          balanceId: 2n,
          inventoryItemId: 12n,
          itemCode: "ITM-12",
          itemName: "صنف غير مقيم",
          unitOfMeasureCode: "EA",
          warehouseId: 102n,
          warehouseCode: "WH-2",
          warehouseName: "الفرعي",
          onHand: "2",
          averageUnitCostBase: "0",
          inventoryValueBase: "0",
          isValuationInitialized: false,
        },
      ]),
      listMovementFacts: vi.fn().mockResolvedValue([
        {
          inventoryItemId: 11n,
          fromWarehouseId: 101n,
          toWarehouseId: 999n,
          movementDate: new Date("2026-06-17T00:00:00.000Z"),
        },
        {
          inventoryItemId: 11n,
          fromWarehouseId: null,
          toWarehouseId: 101n,
          movementDate: new Date("2026-08-17T00:00:00.000Z"),
        },
      ]),
    };

    const report = await new InventoryAgingReportService(port).generate(
      { companyId: 7n, userId: 3n },
      { ...policy, asOf: new Date("2026-09-16T18:00:00.000Z") },
    );

    expect(port.listPositiveBalances).toHaveBeenCalledWith(7n);
    expect(port.listMovementFacts).toHaveBeenCalledWith(
      7n,
      new Date("2026-09-16T18:00:00.000Z"),
      expect.any(Array),
    );
    expect(report.rows[0]).toMatchObject({
      lastMovementDate: "2026-08-17",
      ageDays: 30,
      classification: "SLOW_MOVING",
      averageUnitCostBase: "5.00000000",
      inventoryValueBase: "20.0000",
      valuationWarning: null,
    });
    expect(report.rows[1]).toMatchObject({
      lastMovementDate: null,
      ageDays: null,
      classification: "NO_MOVEMENT",
      averageUnitCostBase: null,
      inventoryValueBase: null,
      valuationWarning: "UNVALUED_BALANCE_EXCLUDED_FROM_TOTALS",
    });
    expect(report.summary).toEqual({
      balanceCount: 2,
      unvaluedBalanceCount: 1,
      valuedInventoryTotalBase: "20.0000",
    });
  });
});
