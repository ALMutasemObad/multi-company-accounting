import type { InventoryCountReport } from "../inventory/inventory-count/inventory-count-report.js";
import { renderTabularReportPdf } from "../document-output-kernel/pdf-profile.js";
import type { PdfTableProfile } from "../document-output-kernel/model.js";

const statusLabel: Record<string, string> = {
  DRAFT: "قيد الجرد", SUBMITTED: "بانتظار الاعتماد", APPROVED: "معتمد", SETTLED: "تمت التسوية",
};
const reasonLabel: Record<string, string> = {
  DAMAGED: "تالف", MISSING: "مفقود", MISPLACED: "في موقع آخر", BOOK_ERROR: "خطأ دفتري",
  UNRECORDED_RECEIPT: "استلام غير مسجل", UNRECORDED_ISSUE: "صرف غير مسجل", DUPLICATE_COUNT: "عد مكرر", OTHER: "أخرى",
};

function varianceReason(value: string) {
  if (!value) return "—";
  const [code, ...details] = value.split(":");
  return code === "OTHER" && details.length ? arabicTextDigits(`أخرى: ${details.join(":").trim()}`) : reasonLabel[code ?? ""] ?? arabicTextDigits(value);
}

function arabicTextDigits(value: string) {
  return /[\u0600-\u06ff]/u.test(value) ? value.replace(/\d/gu, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!) : value;
}

export function inventoryCountPdfProfile(report: InventoryCountReport, companyName: string): PdfTableProfile {
  const session = report.session;
  const counted = report.rows.filter((row) => row.countedQuantity !== "").length;
  const committee = arabicTextDigits(session.committee.map((member) => member.role ? `${member.name}، ${member.role}` : member.name).join("؛ ") || "غير مسجلة");
  return {
    companyName,
    title: "محضر جرد المخزون",
    direction: "RTL",
    columnWidths: [210, 120, 60, 70, 70, 60, 100, 80],
    metadataGroups: [
      [{ label: "رقم الجلسة", value: session.id }, { label: "تاريخ الجرد", value: session.countDate }, { label: "المستودع", value: arabicTextDigits(session.warehouse.nameAr) }, { label: "الحالة", value: statusLabel[session.status] ?? session.status }],
      [{ label: "إجمالي الأصناف", value: String(report.rows.length) }, { label: "تم جردها", value: String(counted) }, { label: "غير مجرودة", value: String(report.rows.length - counted) }, { label: "تاريخ التسوية", value: session.settlement?.date ?? "لم ترحّل" }],
      [{ label: "آخر سند إدخال قبل الجرد", value: session.cutoff.receiptNumber ?? "لا يوجد" }, { label: "آخر سند صرف قبل الجرد", value: session.cutoff.issueNumber ?? "لا يوجد" }],
      [{ label: "لجنة الجرد", value: committee }, { label: "المعتمد", value: session.approvedByName ? arabicTextDigits(session.approvedByName) : "لم يعتمد بعد" }, { label: "تاريخ الاعتماد", value: session.approvedAt?.slice(0, 10) ?? "—" }],
    ],
    headerRows: [["الصنف", "الردمك أو الباركود", "الوحدة", "الدفتري", "الفعلي", "الفرق", "سبب الفرق", "الموقع"].map((value) => ({ value, style: 2 }))],
    bodyRows: report.rows.map((row) => [
      { value: arabicTextDigits(row.title) },
      { value: row.barcode ?? "—" },
      { value: row.unitCode },
      { value: row.bookQuantity, numeric: true },
      { value: row.countedQuantity || "لم يُجرد", numeric: row.countedQuantity !== "" },
      { value: row.varianceQuantity || "—", numeric: row.varianceQuantity !== "" },
      { value: varianceReason(row.varianceReason) },
      { value: arabicTextDigits(row.locationReference ?? "—") },
    ]),
    closingLines: [
      "أُعد هذا المحضر من جميع بنود جلسة الجرد؛ وتُراجع الفروقات وأسبابها قبل التسوية.",
    ],
    signatureLabels: ["توقيع أعضاء لجنة الجرد", "توقيع المعتمد"],
  };
}

export function inventoryCountReportPdf(report: InventoryCountReport, companyName: string) {
  return renderTabularReportPdf(inventoryCountPdfProfile(report, companyName));
}
