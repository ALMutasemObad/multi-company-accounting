import { tableToXlsx } from "../../document-output-kernel/tabular-profile.js";
import type { TabularRows } from "../../document-output-kernel/model.js";

export type InventoryCountReport = {
  session: {
    id: string; countDate: string; status: string; warehouse: { code: string; nameAr: string };
    cutoff: { receiptNumber: string | null; issueNumber: string | null };
    committee: Array<{ name: string; role: string | null }>;
    approvedByName: string | null; approvedAt: string | null;
    settlement: { date: string; surplusMovementId: string | null; shortageMovementId: string | null } | null;
  };
  rows: Array<{
    code: string; barcode: string | null; title: string; unitCode: string; locationReference: string | null;
    bookQuantity: string; countedQuantity: string; varianceQuantity: string;
    unitCostBase: string; varianceValueBase: string; varianceReason: string; countedBy: string;
  }>;
};

const reasonLabel = (value: string) => {
  const [rawCode, ...details] = value.split(":");
  const code = rawCode ?? "";
  const labels: Record<string, string> = {
    DAMAGED: "تالف",
    MISSING: "مفقود",
    MISPLACED: "في موقع خاطئ",
    BOOK_ERROR: "خطأ في الرصيد الدفتري",
    UNRECORDED_RECEIPT: "استلام غير مسجل",
    UNRECORDED_ISSUE: "صرف غير مسجل",
    DUPLICATE_COUNT: "عد مكرر",
    OTHER: "أخرى",
  };
  const label = labels[code] ?? value;
  return code === "OTHER" && details.length ? `${label}: ${details.join(":").trim()}` : label;
};

export function inventoryCountReportXlsx(report: InventoryCountReport) {
  const rows: TabularRows = [
    [{ value: "محضر جرد وتسوية فروقات المخزون", style: 1 }],
    [{ value: "المستودع", style: 3 }, { value: `${report.session.warehouse.code} - ${report.session.warehouse.nameAr}` }],
    [{ value: "تاريخ الجرد", style: 3 }, { value: report.session.countDate }, { value: "الحالة", style: 3 }, { value: report.session.status }],
    [{ value: "آخر سند إدخال حتى تاريخ الجرد", style: 3 }, { value: report.session.cutoff.receiptNumber ?? "لا يوجد" }, { value: "آخر سند صرف حتى تاريخ الجرد", style: 3 }, { value: report.session.cutoff.issueNumber ?? "لا يوجد" }],
    [{ value: "لجنة الجرد", style: 3 }, { value: report.session.committee.map((member) => member.role ? `${member.name} (${member.role})` : member.name).join("، ") || "غير مسجلة" }],
    [{ value: "الاعتماد", style: 3 }, { value: report.session.approvedByName ? `${report.session.approvedByName}${report.session.approvedAt ? ` - ${report.session.approvedAt}` : ""}` : "غير معتمد" }],
    [{ value: "التسوية", style: 3 }, { value: report.session.settlement ? `تاريخ ${report.session.settlement.date}؛ حركة الزيادة ${report.session.settlement.surplusMovementId ?? "لا يوجد"}؛ حركة النقص ${report.session.settlement.shortageMovementId ?? "لا يوجد"}` : "لم ترحّل" }],
    ["الردمك / الباركود", "الصنف", "الوحدة", "مرجع الموقع/المجموعة", "الرصيد الدفتري", "الرصيد الفعلي", "فرق الكمية", "تكلفة الوحدة", "قيمة الفرق", "سبب الفرق", "آخر من أدخل"].map((value) => ({ value, style: 2 })),
    ...report.rows.map((row) => [
      { value: row.barcode ?? "" }, { value: row.title }, { value: row.unitCode }, { value: row.locationReference ?? "" },
      { value: row.bookQuantity, numeric: true }, { value: row.countedQuantity, numeric: Boolean(row.countedQuantity) },
      { value: row.varianceQuantity, numeric: Boolean(row.varianceQuantity) }, { value: row.unitCostBase, numeric: true },
      { value: row.varianceValueBase, numeric: Boolean(row.varianceValueBase) }, { value: reasonLabel(row.varianceReason) }, { value: row.countedBy },
    ]),
  ];
  return tableToXlsx(rows, "فروقات الجرد");
}
