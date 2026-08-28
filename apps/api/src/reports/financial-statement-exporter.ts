import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import {
  csvEscape,
  type TabularCell,
} from "../platform/tabular-file-exporter.js";
import type { StatementRow } from "./financial-statement-calculator.js";

export { tableToCsv, tableToXlsx } from "../platform/tabular-file-exporter.js";

type Cell = TabularCell;
type ExportReport = {
  company: { name: string };
  baseCurrency: { code: string; nameAr: string };
  sections: Record<string, { rows: StatementRow[]; total: string; comparisonTotal: string | null; variance: string | null; variancePercent: string | null }>;
};

const require = createRequire(import.meta.url);
const arabicFont = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff");
const arabicBoldFont = require.resolve("@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-700-normal.woff");
const money = (value: string | null) => value == null ? "" : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const arabicSafe = (value: string) => value
  .replace(/[0-9]+/g, (digits) => [...digits].reverse().map((digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!).join(""))
  .replaceAll("%", "بالمائة")
  .replace(/[—:-]/g, "،");

function flatten(rows: StatementRow[], depth = 0): Array<{ row: StatementRow; depth: number }> {
  return rows.flatMap((row) => [{ row, depth }, ...flatten(row.children, depth + 1)]);
}

export function financialPositionTable(report: ExportReport & { asOf: string; comparisonAsOf: string | null; reconciliation: { leftSide: string; rightSide: string; difference: string; balanced: boolean } }) {
  const rows: Cell[][] = [
    [{ value: report.company.name, style: 1 }],
    [{ value: "تقرير المركز المالي", style: 1 }],
    [{ value: `كما في ${report.asOf}` }, { value: `العملة: ${report.baseCurrency.code}` }],
    [{ value: "البند", style: 2 }, { value: "الرصيد الحالي", style: 2 }, { value: "رصيد المقارنة", style: 2 }, { value: "التغير", style: 2 }, { value: "نسبة التغير %", style: 2 }],
  ];
  const names: Record<string, string> = { assets: "الأصول", liabilities: "الالتزامات", equity: "حقوق الملكية" };
  for (const key of ["assets", "liabilities", "equity"]) {
    const section = report.sections[key]!;
    rows.push([{ value: names[key]!, style: 3 }]);
    for (const { row, depth } of flatten(section.rows)) rows.push([
      { value: `${"   ".repeat(depth)}${row.code === "CURRENT-EARNINGS" ? "" : `${row.code} - `}${row.nameAr}` },
      { value: row.amount, numeric: true, style: 4 }, { value: row.comparisonAmount ?? "", numeric: row.comparisonAmount != null, style: 4 },
      { value: row.variance ?? "", numeric: row.variance != null, style: 4 }, { value: row.variancePercent ?? "", numeric: row.variancePercent != null, style: 4 },
    ]);
    rows.push([{ value: `إجمالي ${names[key]}`, style: 3 }, { value: section.total, numeric: true, style: 5 }, { value: section.comparisonTotal ?? "", numeric: section.comparisonTotal != null, style: 5 }, { value: section.variance ?? "", numeric: section.variance != null, style: 5 }, { value: section.variancePercent ?? "", numeric: section.variancePercent != null, style: 5 }]);
  }
  rows.push([{ value: "فحص المعادلة المحاسبية", style: 3 }, { value: report.reconciliation.leftSide, numeric: true, style: 5 }, { value: report.reconciliation.rightSide, numeric: true, style: 5 }, { value: report.reconciliation.difference, numeric: true, style: 5 }, { value: report.reconciliation.balanced ? "متوازن" : "غير متوازن", style: 3 }]);
  return rows;
}

export function incomeStatementTable(report: ExportReport & { range: { dateFrom: string; dateTo: string }; comparisonRange: { dateFrom: string; dateTo: string } | null; totals: { revenues: string; expenses: string; netIncome: string; comparisonNetIncome: string | null } }) {
  const rows: Cell[][] = [
    [{ value: report.company.name, style: 1 }], [{ value: "قائمة الدخل", style: 1 }],
    [{ value: `من ${report.range.dateFrom} إلى ${report.range.dateTo}` }, { value: `العملة: ${report.baseCurrency.code}` }],
    [{ value: "البند", style: 2 }, { value: "الفترة الحالية", style: 2 }, { value: "فترة المقارنة", style: 2 }, { value: "التغير", style: 2 }, { value: "نسبة التغير %", style: 2 }],
  ];
  const names: Record<string, string> = { revenues: "الإيرادات", expenses: "المصروفات" };
  for (const key of ["revenues", "expenses"]) {
    const section = report.sections[key]!;
    rows.push([{ value: names[key]!, style: 3 }]);
    for (const { row, depth } of flatten(section.rows)) rows.push([{ value: `${"   ".repeat(depth)}${row.code} - ${row.nameAr}` }, { value: row.amount, numeric: true, style: 4 }, { value: row.comparisonAmount ?? "", numeric: row.comparisonAmount != null, style: 4 }, { value: row.variance ?? "", numeric: row.variance != null, style: 4 }, { value: row.variancePercent ?? "", numeric: row.variancePercent != null, style: 4 }]);
    rows.push([{ value: `إجمالي ${names[key]}`, style: 3 }, { value: section.total, numeric: true, style: 5 }, { value: section.comparisonTotal ?? "", numeric: section.comparisonTotal != null, style: 5 }, { value: section.variance ?? "", numeric: section.variance != null, style: 5 }, { value: section.variancePercent ?? "", numeric: section.variancePercent != null, style: 5 }]);
  }
  rows.push([{ value: "صافي الربح أو الخسارة", style: 3 }, { value: report.totals.netIncome, numeric: true, style: 5 }, { value: report.totals.comparisonNetIncome ?? "", numeric: report.totals.comparisonNetIncome != null, style: 5 }]);
  return rows;
}

export function indirectCashFlowTable(report: {
  company: { name: string };
  baseCurrency: { code: string; nameAr: string };
  range: { dateFrom: string; dateTo: string };
  sections: {
    operating: { netIncome: string; adjustments: Array<{ code: string; nameAr: string; amount: string }>; adjustmentsTotal: string; workingCapital: Array<{ code: string; nameAr: string; amount: string }>; workingCapitalTotal: string; total: string };
    investing: { rows: Array<{ code: string; nameAr: string; amount: string }>; total: string };
    financing: { rows: Array<{ code: string; nameAr: string; amount: string }>; total: string };
  };
  cash: { opening: string; calculatedNetChange: string; closing: string; difference: string; reconciled: boolean };
}) {
  const rows: Cell[][] = [
    [{ value: report.company.name, style: 1 }],
    [{ value: "قائمة التدفق النقدي بالطريقة غير المباشرة", style: 1 }],
    [{ value: `من ${report.range.dateFrom} إلى ${report.range.dateTo}` }, { value: `العملة: ${report.baseCurrency.code}` }],
    [{ value: "البند", style: 2 }, { value: "المبلغ", style: 2 }],
    [{ value: "التدفقات من الأنشطة التشغيلية", style: 3 }],
    [{ value: "صافي الربح أو الخسارة" }, { value: report.sections.operating.netIncome, numeric: true, style: 4 }],
    ...report.sections.operating.adjustments.map((row) => [{ value: `${row.code} - ${row.nameAr}` }, { value: row.amount, numeric: true, style: 4 }]),
    [{ value: "إجمالي التعديلات غير النقدية", style: 3 }, { value: report.sections.operating.adjustmentsTotal, numeric: true, style: 5 }],
    ...report.sections.operating.workingCapital.map((row) => [{ value: `${row.code} - ${row.nameAr}` }, { value: row.amount, numeric: true, style: 4 }]),
    [{ value: "إجمالي تغيرات رأس المال العامل", style: 3 }, { value: report.sections.operating.workingCapitalTotal, numeric: true, style: 5 }],
    [{ value: "صافي النقد من الأنشطة التشغيلية", style: 3 }, { value: report.sections.operating.total, numeric: true, style: 5 }],
    [{ value: "التدفقات من الأنشطة الاستثمارية", style: 3 }],
    ...report.sections.investing.rows.map((row) => [{ value: `${row.code} - ${row.nameAr}` }, { value: row.amount, numeric: true, style: 4 }]),
    [{ value: "صافي النقد من الأنشطة الاستثمارية", style: 3 }, { value: report.sections.investing.total, numeric: true, style: 5 }],
    [{ value: "التدفقات من الأنشطة التمويلية", style: 3 }],
    ...report.sections.financing.rows.map((row) => [{ value: `${row.code} - ${row.nameAr}` }, { value: row.amount, numeric: true, style: 4 }]),
    [{ value: "صافي النقد من الأنشطة التمويلية", style: 3 }, { value: report.sections.financing.total, numeric: true, style: 5 }],
    [{ value: "النقد أول الفترة", style: 3 }, { value: report.cash.opening, numeric: true, style: 5 }],
    [{ value: "صافي التغير المحسوب", style: 3 }, { value: report.cash.calculatedNetChange, numeric: true, style: 5 }],
    [{ value: "النقد آخر الفترة", style: 3 }, { value: report.cash.closing, numeric: true, style: 5 }],
    [{ value: report.cash.reconciled ? "مطابقة الرصيد النقدي: متطابق" : "مطابقة الرصيد النقدي: تحتاج مراجعة", style: 3 }, { value: report.cash.difference, numeric: true, style: 5 }],
  ];
  return rows;
}

export function taxSummaryTable(report: {
  company: { name: string };
  baseCurrency: { code: string; nameAr: string };
  range: { dateFrom: string; dateTo: string };
  filter: { status: string | null; basis: "LEDGER" | "STATUS_FILTER" };
  totals: { outputTaxable: string; outputTax: string; inputTaxable: string; inputTax: string; netTaxDue: string; documentCount: number };
  rows: Array<{ usage: string; documentType: string; status: string; taxCode: string | null; taxNameAr: string | null; rate: string; documentCount: number; taxableBase: string; taxBase: string }>;
}) {
  const usage = (value: string) => value === "OUTPUT" ? "مخرجات" : "مدخلات";
  const status = (value: string) => ({ POSTED: "مرحل", REVERSED: "عكس", DRAFT: "مسودة", CANCELLED: "ملغي" }[value] ?? value);
  const documentType = (value: string) => ({ SALES_INVOICE: "فاتورة مبيعات", SALES_CREDIT_NOTE: "إشعار دائن مبيعات", PURCHASE_INVOICE: "فاتورة مشتريات", PURCHASE_DEBIT_NOTE: "إشعار مدين مشتريات" }[value] ?? value);
  return [
    [{ value: report.company.name, style: 1 }],
    [{ value: "ملخص الضريبة", style: 1 }],
    [{ value: `من ${report.range.dateFrom} إلى ${report.range.dateTo}` }, { value: `العملة: ${report.baseCurrency.code}` }],
    [{ value: report.filter.basis === "LEDGER" ? "الأساس: الأثر المرحل والعكس" : `الحالة: ${status(report.filter.status ?? "")}` }],
    ["النوع", "المستند", "الحالة", "الضريبة", "النسبة", "المستندات", "الخاضع بعملة الأساس", "الضريبة بعملة الأساس"].map((value) => ({ value, style: 2 })),
    ...report.rows.map((row) => [
      { value: usage(row.usage) },
      { value: documentType(row.documentType) },
      { value: status(row.status) },
      { value: row.taxCode ? `${row.taxCode} - ${row.taxNameAr ?? ""}` : "بدون ضريبة" },
      { value: row.rate, numeric: true, style: 4 },
      { value: String(row.documentCount), numeric: true, style: 4 },
      { value: row.taxableBase, numeric: true, style: 4 },
      { value: row.taxBase, numeric: true, style: 4 },
    ]),
    [{ value: "إجمالي ضريبة المخرجات", style: 3 }, { value: report.totals.outputTax, numeric: true, style: 5 }],
    [{ value: "إجمالي ضريبة المدخلات", style: 3 }, { value: report.totals.inputTax, numeric: true, style: 5 }],
    [{ value: "صافي الضريبة المستحقة", style: 3 }, { value: report.totals.netTaxDue, numeric: true, style: 5 }],
  ] satisfies Cell[][];
}

export function costCenterActivityTable(report: {
  company: { name: string };
  baseCurrency: { code: string; nameAr: string };
  range: { dateFrom: string; dateTo: string };
  data: Array<{
    costCenter: { code: string; nameAr: string };
    accounts: Array<{ code: string; nameAr: string; movementLineCount: number; debit: string; credit: string; net: string }>;
    totals: { movementLineCount: number; debit: string; credit: string; net: string };
  }>;
  totals: { costCenterCount: number; accountCount: number; movementLineCount: number; debit: string; credit: string; net: string };
}) {
  const rows: Cell[][] = [
    [{ value: report.company.name, style: 1 }],
    [{ value: "تقرير حركة مراكز التكلفة الفعلية", style: 1 }],
    [{ value: `من ${report.range.dateFrom} إلى ${report.range.dateTo}` }, { value: `العملة: ${report.baseCurrency.code}` }],
    ["رمز مركز التكلفة", "مركز التكلفة", "رمز الحساب", "الحساب", "عدد الحركات", "مدين", "دائن", "الصافي"].map((value) => ({ value, style: 2 })),
  ];
  for (const center of report.data) {
    for (const account of center.accounts) rows.push([
      { value: center.costCenter.code },
      { value: center.costCenter.nameAr },
      { value: account.code },
      { value: account.nameAr },
      { value: String(account.movementLineCount), numeric: true, style: 4 },
      { value: account.debit, numeric: true, style: 4 },
      { value: account.credit, numeric: true, style: 4 },
      { value: account.net, numeric: true, style: 4 },
    ]);
    rows.push([
      { value: `إجمالي ${center.costCenter.code} - ${center.costCenter.nameAr}`, style: 3 },
      { value: "" }, { value: "" }, { value: "" },
      { value: String(center.totals.movementLineCount), numeric: true, style: 5 },
      { value: center.totals.debit, numeric: true, style: 5 },
      { value: center.totals.credit, numeric: true, style: 5 },
      { value: center.totals.net, numeric: true, style: 5 },
    ]);
  }
  rows.push([
    { value: "إجمالي الفترة", style: 3 },
    { value: `${report.totals.costCenterCount} مركز` },
    { value: `${report.totals.accountCount} حساب` },
    { value: "" },
    { value: String(report.totals.movementLineCount), numeric: true, style: 5 },
    { value: report.totals.debit, numeric: true, style: 5 },
    { value: report.totals.credit, numeric: true, style: 5 },
    { value: report.totals.net, numeric: true, style: 5 },
  ]);
  return rows;
}

export function ledgerReportTable(report: {
  company: { name: string };
  baseCurrency: { code: string; nameAr: string };
  subject: { code: string; nameAr: string; type: "ACCOUNT" | "CUSTOMER" | "SUPPLIER" };
  range: { dateFrom: string; dateTo: string };
  openingDebit: string;
  openingCredit: string;
  data: Array<{ date: string; documentNumber: string; description: string; debit: string; credit: string; runningDebit: string; runningCredit: string }>;
  closingDebit: string;
  closingCredit: string;
}) {
  const subjectType = report.subject.type === "CUSTOMER" ? "العميل" : report.subject.type === "SUPPLIER" ? "المورد" : "حساب الأستاذ";
  return [
    [{ value: report.company.name, style: 1 }],
    [{ value: `كشف حساب ${subjectType}: ${report.subject.code} - ${report.subject.nameAr}`, style: 1 }],
    [{ value: `من ${report.range.dateFrom} إلى ${report.range.dateTo}` }, { value: `العملة: ${report.baseCurrency.code}` }],
    ["التاريخ", "رقم المستند", "البيان", "مدين", "دائن", "الرصيد المدين", "الرصيد الدائن"].map((value) => ({ value, style: 2 })),
    [{ value: "الرصيد الافتتاحي", style: 3 }, { value: "" }, { value: "" }, { value: report.openingDebit, numeric: true, style: 5 }, { value: report.openingCredit, numeric: true, style: 5 }, { value: report.openingDebit, numeric: true, style: 5 }, { value: report.openingCredit, numeric: true, style: 5 }],
    ...report.data.map((row) => [
      { value: row.date }, { value: row.documentNumber }, { value: row.description },
      { value: row.debit, numeric: true, style: 4 }, { value: row.credit, numeric: true, style: 4 },
      { value: row.runningDebit, numeric: true, style: 4 }, { value: row.runningCredit, numeric: true, style: 4 },
    ]),
    [{ value: "الرصيد الختامي", style: 3 }, { value: "" }, { value: "" }, { value: "" }, { value: "" }, { value: report.closingDebit, numeric: true, style: 5 }, { value: report.closingCredit, numeric: true, style: 5 }],
  ] satisfies Cell[][];
}

export function journalReportToCsv(rows: Array<{ documentNumber: string; documentType: string; documentDate: string; status: string; entryNumber: number; entryDate: string; description: string; debitTotal: string; creditTotal: string; balanced: boolean }>) {
  const header = ["رقم المستند", "نوع المستند", "تاريخ المستند", "الحالة", "رقم القيد", "تاريخ القيد", "البيان", "إجمالي المدين", "إجمالي الدائن", "متوازن"];
  const data = rows.map((row) => [row.documentNumber, row.documentType, row.documentDate, row.status, String(row.entryNumber), row.entryDate, row.description, row.debitTotal, row.creditTotal, row.balanced ? "نعم" : "لا"]);
  return Buffer.from(`\uFEFF${[header, ...data].map((values) => values.map(csvEscape).join(",")).join("\r\n")}`, "utf8");
}

export function tableToPdf(rows: Cell[][], title: string, companyName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: title, Author: companyName } });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk) => chunks.push(Buffer.from(chunk))); pdf.on("error", reject); pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.registerFont("Arabic", arabicFont).registerFont("ArabicBold", arabicBoldFont);
    const pageHeader = () => { pdf.rect(0, 0, 842, 75).fill("#173f34"); pdf.font("ArabicBold").fontSize(17).fillColor("#ffffff").text(arabicSafe(companyName), 36, 18, { width: 770, align: "right", features: ["rtla"] }); pdf.font("Arabic").fontSize(10).fillColor("#d6e7df").text(arabicSafe(title), 36, 47, { width: 770, align: "right", features: ["rtla"] }); pdf.y = 92; };
    pageHeader();
    const columnCount = Math.max(1, ...rows.map((row) => row.length));
    const widths = columnCount === 8 ? [70, 115, 65, 140, 65, 65, 125, 125] : columnCount === 7 ? [80, 100, 250, 80, 80, 90, 90] : columnCount === 2 ? [600, 170] : [370, 100, 100, 100, 100];
    for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
      if (pdf.y > 530) { pdf.addPage(); pageHeader(); }
      const row = rows[rowIndex]!; const y = pdf.y; const isHeader = row.length > 0 && row.every((cell) => cell.style === 2); const isSection = row[0]?.style === 3;
      if (isHeader) pdf.rect(36, y, 770, 24).fill("#173f34"); else if (isSection) pdf.rect(36, y, 770, 24).fill("#e8f1ed");
      let x = 36;
      for (let index = 0; index < widths.length; index += 1) {
        const cell = row[index]; const value = cell?.value ?? ""; const arabic = /[\u0600-\u06ff]/.test(value); const display = arabic ? arabicSafe(value) : cell?.numeric ? money(value) : value;
        const font = arabic ? (isHeader || isSection ? "ArabicBold" : "Arabic") : (isHeader || isSection ? "Helvetica-Bold" : "Helvetica");
        pdf.font(font).fontSize(8).fillColor(isHeader ? "#ffffff" : "#263f37").text(display, x + 4, y + 7, { width: widths[index]! - 8, height: 14, align: index === 0 ? "right" : "center", features: arabic ? ["rtla"] : [], lineBreak: false });
        if (!isHeader) pdf.rect(x, y, widths[index]!, 24).stroke("#dce6e1"); x += widths[index]!;
      }
      pdf.y = y + 24;
    }
    const range = pdf.bufferedPageRange(); for (let index = 0; index < range.count; index += 1) { pdf.switchToPage(index); pdf.font("Arabic").fontSize(7).fillColor("#71827b").text(arabicSafe(`صفحة ${index + 1} من ${range.count}`), 36, 525, { width: 770, align: "center", features: ["rtla"], lineBreak: false }); }
    pdf.end();
  });
}
