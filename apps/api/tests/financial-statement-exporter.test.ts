import { describe, expect, it } from "vitest";
import { financialPositionTable, indirectCashFlowTable, journalReportToCsv, ledgerReportTable, tableToCsv, tableToPdf, tableToXlsx, taxSummaryTable } from "../src/reports/financial-statement-exporter.js";

const report = {
  company: { name: "الشركة التجريبية" }, baseCurrency: { code: "SAR", nameAr: "ريال سعودي" }, asOf: "2026-08-11", comparisonAsOf: null,
  sections: {
    assets: { rows: [], total: "100.0000", comparisonTotal: null, variance: null, variancePercent: null },
    liabilities: { rows: [], total: "0.0000", comparisonTotal: null, variance: null, variancePercent: null },
    equity: { rows: [], total: "100.0000", comparisonTotal: null, variance: null, variancePercent: null },
  }, reconciliation: { leftSide: "100.0000", rightSide: "100.0000", difference: "0.0000", balanced: true },
};

describe("financial statement exports", () => {
  it("creates UTF-8 CSV and a valid XLSX zip container", () => {
    const table = financialPositionTable(report);
    expect(tableToCsv(table).subarray(0, 3).toString("hex")).toBe("efbbbf");
    expect(tableToCsv([[{ value: "=1+1" }]]).toString("utf8")).toContain("'=1+1");
    const xlsx = tableToXlsx(table, "المركز المالي");
    expect(xlsx.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(xlsx.includes(Buffer.from("xl/worksheets/sheet1.xml"))).toBe(true);
  });
  it("creates an Arabic PDF", async () => {
    const pdf = await tableToPdf(financialPositionTable(report), "المركز المالي", "الشركة التجريبية");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });
  it("exports a safe Arabic journal CSV", () => {
    const csv = journalReportToCsv([{ documentNumber: "JV-1", documentType: "MANUAL_JOURNAL", documentDate: "2026-01-01", status: "POSTED", entryNumber: 1, entryDate: "2026-01-01", description: "=صيغة", debitTotal: "25.0000", creditTotal: "25.0000", balanced: true }]).toString("utf8");
    expect(csv).toContain("رقم المستند");
    expect(csv).toContain("'=صيغة");
    expect(csv).toContain("25.0000");
  });
  it("exports a complete customer account statement table", async () => {
    const table = ledgerReportTable({
      company: { name: "الشركة التجريبية" }, baseCurrency: { code: "SAR", nameAr: "ريال سعودي" },
      subject: { code: "CUS-000001", nameAr: "عميل تجريبي", type: "CUSTOMER" },
      range: { dateFrom: "2026-01-01", dateTo: "2026-08-11" },
      openingDebit: "100.0000", openingCredit: "0.0000",
      data: [{ date: "2026-02-01", documentNumber: "SI-1", description: "فاتورة مبيعات", debit: "50.0000", credit: "0.0000", runningDebit: "150.0000", runningCredit: "0.0000" }],
      closingDebit: "150.0000", closingCredit: "0.0000",
    });
    expect(table[1]?.[0]?.value).toContain("CUS-000001");
    expect(table[3]).toHaveLength(7);
    expect(tableToCsv(table).toString("utf8")).toContain("الرصيد الافتتاحي");
    expect(tableToXlsx(table, "كشف الحساب").includes(Buffer.from("xl/worksheets/sheet1.xml"))).toBe(true);
    const pdf = await tableToPdf(table, "كشف الحساب", "الشركة التجريبية");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
  it("exports the indirect cash-flow reconciliation in every supported format", async () => {
    const table = indirectCashFlowTable({
      company: { name: "الشركة التجريبية" },
      baseCurrency: { code: "SAR", nameAr: "ريال سعودي" },
      range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
      sections: {
        operating: { netIncome: "80.0000", adjustments: [], adjustmentsTotal: "0.0000", workingCapital: [{ code: "1210", nameAr: "الذمم", amount: "-40.0000" }], workingCapitalTotal: "-40.0000", total: "40.0000" },
        investing: { rows: [], total: "0.0000" },
        financing: { rows: [], total: "0.0000" },
      },
      cash: { opening: "100.0000", calculatedNetChange: "40.0000", closing: "140.0000", difference: "0.0000", reconciled: true },
    });
    const csv = tableToCsv(table).toString("utf8");
    expect(csv).toContain("قائمة التدفق النقدي بالطريقة غير المباشرة");
    expect(csv).toContain("مطابقة الرصيد النقدي: متطابق");
    expect(tableToXlsx(table, "التدفق النقدي").subarray(0, 4).toString("hex")).toBe("504b0304");
    expect((await tableToPdf(table, "التدفق النقدي", "الشركة التجريبية")).subarray(0, 4).toString()).toBe("%PDF");
  });
  it("exports a tax summary with its ledger basis and reconciliation totals", async () => {
    const table = taxSummaryTable({
      company: { name: "الشركة التجريبية" }, baseCurrency: { code: "SAR", nameAr: "ريال سعودي" },
      range: { dateFrom: "2026-01-01", dateTo: "2026-12-31" }, filter: { status: null, basis: "LEDGER" },
      totals: { outputTaxable: "100.0000", outputTax: "15.0000", inputTaxable: "40.0000", inputTax: "6.0000", netTaxDue: "9.0000", documentCount: 2 },
      rows: [{ usage: "OUTPUT", documentType: "SALES_INVOICE", status: "POSTED", taxCode: "VAT-15", taxNameAr: "ضريبة 15%", rate: "15.0000", documentCount: 1, taxableBase: "100.0000", taxBase: "15.0000" }],
    });
    const csv = tableToCsv(table).toString("utf8");
    expect(csv).toContain("الأثر المرحل والعكس");
    expect(csv).toContain('"صافي الضريبة المستحقة","9.0000"');
    expect(tableToXlsx(table, "ملخص الضريبة").subarray(0, 4).toString("hex")).toBe("504b0304");
    expect((await tableToPdf(table, "ملخص الضريبة", "الشركة التجريبية")).subarray(0, 4).toString()).toBe("%PDF");
  });
});
