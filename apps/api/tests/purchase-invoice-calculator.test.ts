import { describe, expect, it } from "vitest";
import { calculateTaxDocument, TaxCalculationError } from "../src/tax/tax-calculator.js";

describe("purchase invoice calculator", () => {
  it("calculates discounts, input VAT and base totals with four-decimal rounding", () => {
    const result = calculateTaxDocument([
      { description: "خدمات تشغيل", quantity: "2.0000", unitPrice: "1000.0000", discountAmount: "100.0000", accountId: 1n, taxRateId: 2n, taxRate: "15.0000" },
      { description: "أصل معفى", quantity: "1.0000", unitPrice: "500.0000", discountAmount: "0.0000", accountId: 3n, taxRate: "0.0000" },
    ], "1.00000000");
    expect(result.subtotal.toFixed(4)).toBe("2500.0000");
    expect(result.discountTotal.toFixed(4)).toBe("100.0000");
    expect(result.taxTotal.toFixed(4)).toBe("285.0000");
    expect(result.total.toFixed(4)).toBe("2685.0000");
    expect(result.baseTotal.toFixed(4)).toBe("2685.0000");
  });

  it("rejects a discount that exceeds the line gross amount", () => {
    expect(() => calculateTaxDocument([
      { description: "خدمة", quantity: "1.0000", unitPrice: "100.0000", discountAmount: "100.0001", accountId: 1n, taxRate: "15.0000" },
    ], "1.00000000")).toThrowError(new TaxCalculationError("INVALID_DISCOUNT"));
  });

  it("uses the sum of rounded line bases", () => {
    const result = calculateTaxDocument([
      { description: "أ", quantity: "1.0000", unitPrice: "0.3333", discountAmount: "0.0000", accountId: 1n, taxRateId: 2n, taxRate: "15.0000" },
      { description: "ب", quantity: "1.0000", unitPrice: "0.3333", discountAmount: "0.0000", accountId: 1n, taxRateId: 2n, taxRate: "15.0000" },
    ], "3.75000000");
    const detailBase = result.lines.reduce((sum, line) => sum + Number(line.netAmount.mul(3.75).toDecimalPlaces(4)) + Number(line.taxAmount.mul(3.75).toDecimalPlaces(4)), 0);
    expect(result.baseTotal.toFixed(4)).toBe(detailBase.toFixed(4));
  });

  it("keeps the document base equal to separately rounded net and tax postings", () => {
    const result = calculateTaxDocument([
      { description: "حد تقريبي", quantity: "1.0000", unitPrice: "0.0005", discountAmount: "0.0000", accountId: 1n, taxRate: "100.0000" },
    ], "1.50000000");
    const line = result.lines[0]!;
    const postedBase = line.netAmount.mul(1.5).toDecimalPlaces(4).add(
      line.taxAmount.mul(1.5).toDecimalPlaces(4),
    );
    expect(result.baseTotal.toFixed(4)).toBe(postedBase.toFixed(4));
  });
});
