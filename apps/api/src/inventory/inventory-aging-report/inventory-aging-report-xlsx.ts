import { tableToXlsx } from "../../document-output-kernel/tabular-profile.js";
import type { TabularRows } from "../../document-output-kernel/model.js";
import type { InventoryAgingRow } from "./types.js";

type InventoryAgingReport = {
  asOf: string;
  policy: { slowMovingDays: number; stagnantDays: number };
  rows: InventoryAgingRow[];
  summary: {
    balanceCount: number;
    unvaluedBalanceCount: number;
    valuedInventoryTotalBase: string;
    classificationTotals: Record<"ACTIVE" | "SLOW_MOVING" | "STAGNANT" | "NO_MOVEMENT", { balanceCount: number; valuedInventoryValueBase: string }>;
  };
};

const classificationAr = {
  ACTIVE: "نشط",
  SLOW_MOVING: "بطيء الحركة",
  STAGNANT: "راكد",
  NO_MOVEMENT: "دون حركة مسجلة",
} as const;

export function inventoryAgingReportXlsx(report: InventoryAgingReport) {
  const rows: TabularRows = [
    [{ value: "تقرير تقادم وبطء حركة المخزون", style: 1 }],
    [{ value: "حتى تاريخ", style: 3 }, { value: report.asOf }],
    [{ value: "سياسة التصنيف", style: 3 }, { value: `بطيء من ${report.policy.slowMovingDays} يوم، راكد من ${report.policy.stagnantDays} يوم` }],
    [{ value: "قيمة الأصناف بطيئة الحركة", style: 3 }, { value: report.summary.classificationTotals.SLOW_MOVING.valuedInventoryValueBase, numeric: true }, { value: "قيمة الأصناف الراكدة", style: 3 }, { value: report.summary.classificationTotals.STAGNANT.valuedInventoryValueBase, numeric: true }],
    [{ value: "قيمة الأصناف دون حركة مسجلة", style: 3 }, { value: report.summary.classificationTotals.NO_MOVEMENT.valuedInventoryValueBase, numeric: true }],
    ["الردمك / الباركود", "الصنف", "الوحدة", "رمز المستودع", "المستودع", "الكمية", "آخر حركة", "العمر بالأيام", "التصنيف", "متوسط التكلفة", "قيمة المخزون", "ملاحظة التقييم"].map((value) => ({ value, style: 2 })),
    ...report.rows.map((row) => [
      { value: row.barcode ?? "" },
      { value: row.itemName },
      { value: row.unitOfMeasureCode },
      { value: row.warehouseCode },
      { value: row.warehouseName },
      { value: row.onHand, numeric: true },
      { value: row.lastMovementDate ?? "" },
      { value: row.ageDays === null ? "" : String(row.ageDays), numeric: row.ageDays !== null },
      { value: classificationAr[row.classification] },
      { value: row.averageUnitCostBase ?? "", numeric: row.averageUnitCostBase !== null },
      { value: row.inventoryValueBase ?? "", numeric: row.inventoryValueBase !== null },
      { value: row.valuationWarning ? "الرصيد غير مقيّم ومستبعد من الإجمالي" : "" },
    ]),
    [{ value: "إجمالي القيمة المقيّمة", style: 3 }, { value: report.summary.valuedInventoryTotalBase, numeric: true, style: 5 }],
  ];
  return tableToXlsx(rows, "تقادم المخزون");
}
