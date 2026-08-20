import { describe, expect, it } from "vitest";
import { currentYearRange, trialBalanceCsv } from "./reporting";

describe("reporting helpers", () => {
  it("builds the complete current-year range", () => {
    expect(currentYearRange(new Date("2028-06-12T00:00:00Z"))).toEqual({ dateFrom: "2028-01-01", dateTo: "2028-12-31" });
  });

  it("exports a safe Arabic trial-balance CSV", () => {
    const csv = trialBalanceCsv([{ accountId: "1", code: "1100", nameAr: 'الصندوق "الرئيسي"', accountClass: "ASSET", debit: "100.0000", credit: "25.0000", balance: "75.0000" }]);
    expect(csv).toContain('"الصندوق ""الرئيسي"""');
    expect(csv).toContain('"100.0000","25.0000","75.0000"');
  });
});
