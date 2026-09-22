import { Prisma } from "@prisma/client";
import type { ActorContext } from "../../platform/actor-context.js";
import { tableToXlsx } from "../../document-output-kernel/tabular-profile.js";
import type { TabularRows } from "../../document-output-kernel/model.js";
import { InventoryMovementService } from "../inventory-movement-service.js";

export type InventoryValuationStatus = "ALL" | "VALUED" | "UNVALUED";

export type InventoryValuationFilters = {
  search?: string | undefined;
  warehouseId?: bigint | undefined;
  inventoryItemId?: bigint | undefined;
  valuationStatus: InventoryValuationStatus;
};

type BalanceRow = ReturnType<typeof InventoryMovementService.balanceJson>;

export type InventoryValuationReport = {
  generatedAt: string;
  basis: "CURRENT_BALANCE";
  valuationPolicy: "MOVING_WEIGHTED_AVERAGE";
  rows: BalanceRow[];
  totals: {
    rowCount: number;
    valuedRowCount: number;
    unvaluedRowCount: number;
    valuedInventoryValueBase: string;
  };
};

const MAX_REPORT_ROWS = 5_000;

export async function currentInventoryValuationReport(
  service: InventoryMovementService,
  context: ActorContext,
  filters: InventoryValuationFilters,
): Promise<InventoryValuationReport> {
  const rows: BalanceRow[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await service.listBalances(context, {
      page,
      pageSize: 100,
      search: filters.search,
      warehouseId: filters.warehouseId,
      inventoryItemId: filters.inventoryItemId,
      nonZero: true,
    });
    total = result.total;
    if (total > MAX_REPORT_ROWS) throw new Error("INVENTORY_VALUATION_REPORT_TOO_LARGE");
    rows.push(...result.data.map(InventoryMovementService.balanceJson));
    page += 1;
  } while (rows.length < total);

  const filtered = rows.filter((row) => filters.valuationStatus === "ALL"
    || (filters.valuationStatus === "VALUED" ? row.isValuationInitialized : !row.isValuationInitialized));
  const value = filtered.reduce(
    (sum, row) => row.isValuationInitialized ? sum.plus(row.inventoryValueBase) : sum,
    new Prisma.Decimal(0),
  );
  return {
    generatedAt: new Date().toISOString(),
    basis: "CURRENT_BALANCE",
    valuationPolicy: "MOVING_WEIGHTED_AVERAGE",
    rows: filtered,
    totals: {
      rowCount: filtered.length,
      valuedRowCount: filtered.filter((row) => row.isValuationInitialized).length,
      unvaluedRowCount: filtered.filter((row) => !row.isValuationInitialized).length,
      valuedInventoryValueBase: value.toFixed(4),
    },
  };
}

export function inventoryValuationXlsx(report: InventoryValuationReport) {
  const rows: TabularRows = [
    [{ value: "كشف تقييم المخزون الحالي", style: 1 }],
    [{ value: "وقت التوليد", style: 3 }, { value: report.generatedAt }],
    [{ value: "أساس التقرير", style: 3 }, { value: "الرصيد الحالي وقت التوليد (ليس تقريرًا تاريخيًا)" }],
    [{ value: "سياسة التقييم", style: 3 }, { value: "متوسط التكلفة المرجح المتحرك" }],
    ["الردمك / الباركود", "الصنف", "الوحدة", "رمز المستودع", "المستودع / الموقع", "الكمية", "متوسط تكلفة الوحدة", "القيمة الإجمالية", "حالة التقييم"].map((value) => ({ value, style: 2 })),
    ...report.rows.map((row) => [
      { value: row.inventoryItem.primaryBarcode ?? "" },
      { value: row.inventoryItem.nameAr },
      { value: row.inventoryItem.unitOfMeasure.code },
      { value: row.warehouse.code },
      { value: row.warehouse.nameAr },
      { value: row.onHand, numeric: true },
      { value: row.isValuationInitialized ? row.averageUnitCostBase : "" , numeric: row.isValuationInitialized },
      { value: row.isValuationInitialized ? row.inventoryValueBase : "", numeric: row.isValuationInitialized },
      { value: row.isValuationInitialized ? "مقيّم" : "غير مقيّم" },
    ]),
    [{ value: "إجمالي القيمة المقيّمة", style: 3 }, { value: report.totals.valuedInventoryValueBase, numeric: true, style: 5 }],
  ];
  return tableToXlsx(rows, "تقييم المخزون");
}
