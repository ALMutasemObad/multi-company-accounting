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
  const legible = value.replace(/\uFFFD/gu, "؟");
  // PDFKit reverses Latin runs inside RTL lines visually; reverse only those runs before shaping.
  return /[\u0600-\u06ff]/u.test(legible)
    ? legible.replace(/\d/gu, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!).replace(/[A-Za-z]+(?:\s+[A-Za-z]+)*/gu, (run) => [...run].reverse().join(""))
    : legible;
}

export function inventoryCountPdfProfile(report: InventoryCountReport, companyName: string): PdfTableProfile {
  const session = report.session;
  const committee = arabicTextDigits(session.committee.map((member) => member.role ? `${member.name}، ${member.role}` : member.name).join("؛ ") || "غير مسجلة");
  return {
    companyName,
    title: "محضر جرد المخزون",
    direction: "RTL",
    columnWidths: [180, 102, 95, 45, 62, 62, 55, 92, 77],
    metadataGroups: [
      [{ label: "الجلسة", value: session.id }, { label: "تاريخ الجرد", value: session.countDate }, { label: "المستودع", value: arabicTextDigits(session.warehouse.nameAr) }, { label: "الحالة", value: statusLabel[session.status] ?? session.status }],
      [{ label: "العناوين المجرودة", value: String(session.summary.counted) }, { label: "النسخ المجرودة", value: session.summary.countedCopies }, { label: "العناوين المتبقية", value: String(session.summary.remaining) }, { label: "إجمالي العناوين", value: String(session.summary.total) }],
      [{ label: "آخر استلام قبل الجرد", value: session.cutoff.receiptNumber ?? "لا يوجد" }, { label: "آخر صرف قبل الجرد", value: session.cutoff.issueNumber ?? "لا يوجد" }, { label: "المعتمد", value: session.approvedByName ? arabicTextDigits(session.approvedByName) : "لم يعتمد بعد" }],
    ],
    metadataLines: [`لجنة الجرد: ${committee}    |    التسوية: ${session.settlement?.date ?? "لم ترحّل"}`],
    headerRows: [["الصنف", "معرّف النشر", "الباركود", "الوحدة", "الدفتري", "الفعلي", "الفرق", "سبب الفرق", "الموقع"].map((value) => ({ value, style: 2 }))],
    bodyRows: report.rows.map((row) => [
      { value: arabicTextDigits(row.title) },
      { value: row.publicationIdentifier ?? "—" },
      { value: row.barcode ?? "—" },
      { value: row.unitCode },
      { value: row.bookQuantity, numeric: true },
      { value: row.countedQuantity, numeric: true },
      { value: row.varianceQuantity || "—", numeric: row.varianceQuantity !== "" },
      { value: varianceReason(row.varianceReason) },
      { value: arabicTextDigits(row.locationReference ?? "—") },
    ]),
    closingLines: [
      "يعرض هذا المحضر الأصناف المجرودة فقط؛ وتُراجع الفروقات قبل التسوية.",
    ],
    signatureLabels: ["توقيع أعضاء لجنة الجرد", "توقيع المعتمد"],
  };
}

export function inventoryCountReportPdf(report: InventoryCountReport, companyName: string) {
  return renderTabularReportPdf(inventoryCountPdfProfile(report, companyName));
}
