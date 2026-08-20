import { describe, expect, it } from "vitest";
import { financialPositionTable, journalReportToCsv, tableToCsv, tableToPdf, tableToXlsx } from "../src/reports/financial-statement-exporter.js";

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
});
