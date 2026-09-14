import { describe, expect, it } from "vitest";
import { renderTabularReportPdf, reportColumnWidths } from "../src/document-output-kernel/pdf-profile.js";

const longArabicFixture = "بيان عربي طويل لا يجب قصه عند انتقال صف الجدول إلى صفحة جديدة ".repeat(4);

describe("report output visual fixtures", () => {
  it("renders the long RTL fixture as a multi-page PDF without an overflow failure", async () => {
    const pdf = await renderTabularReportPdf({
      companyName: "الشركة التجريبية",
      title: "تقرير بصري",
      direction: "RTL",
      metadataRows: [[{ value: "فترة التقرير: 2026-01-01 إلى 2026-12-31" }]],
      headerRows: [[{ value: "البيان", style: 2 }, { value: "المبلغ", style: 2 }]],
      bodyRows: Array.from({ length: 40 }, (_, index) => [{ value: `${index + 1} - ${longArabicFixture}` }, { value: "9007199254740993.1234", numeric: true }]),
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/gu) ?? []).length).toBeGreaterThan(1);
  });

  it.each([1, 3, 5, 6, 8])("allocates exactly one PDF width per column for %s columns", (columnCount) => {
    const widths = reportColumnWidths(columnCount);
    expect(widths).toHaveLength(columnCount);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(770);
  });
});
