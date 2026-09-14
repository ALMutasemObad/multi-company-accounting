import {
  csvEscape,
  type TabularCell,
} from "../platform/tabular-file-exporter.js";
import { renderTabularReportPdf } from "../document-output-kernel/pdf-profile.js";
import type { StatementRow } from "./financial-statement-calculator.js";

export { tableToCsv, tableToXlsx } from "../platform/tabular-file-exporter.js";

type Cell = TabularCell;
type ExportReport = {
  company: { name: string };
  baseCurrency: { code: string; nameAr: string };
  sections: Record<string, { rows: StatementRow[]; total: string; comparisonTotal: string | null; variance: string | null; variancePercent: string | null }>;
};

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
  // Legacy report tables reserve their first three rows for the PDF banner.
  // The neutral kernel receives only explicitly partitioned table content.
  const reportRows = rows.slice(3);
  const headerIndex = reportRows.findIndex((row) => row.length > 0 && row.every((cell) => cell.style === 2));
  return renderTabularReportPdf({
    title,
    companyName,
    direction: "RTL",
    metadataRows: headerIndex > 0 ? reportRows.slice(0, headerIndex) : [],
    headerRows: headerIndex >= 0 ? [reportRows[headerIndex]!] : [],
    bodyRows: headerIndex >= 0 ? reportRows.slice(headerIndex + 1) : reportRows,
  });
}
