import { describe, expect, it } from "vitest";
import { calculatePurchaseInvoice, PurchaseCalculationError } from "../src/purchases/purchase-invoice-calculator.js";

describe("purchase invoice calculator", () => {
  it("calculates discounts, input VAT and base totals with four-decimal rounding", () => {
    const result = calculatePurchaseInvoice([
      { description: "خدمات تشغيل", quantity: "2.0000", unitPrice: "1000.0000", discountAmount: "100.0000", debitAccountId: 1n, taxRateId: 2n, taxRate: "15.0000" },
      { description: "أصل معفى", quantity: "1.0000", unitPrice: "500.0000", discountAmount: "0.0000", debitAccountId: 3n, taxRate: "0.0000" },
    ], "1.00000000");
    expect(result.subtotal.toFixed(4)).toBe("2500.0000");
    expect(result.discountTotal.toFixed(4)).toBe("100.0000");
    expect(result.taxTotal.toFixed(4)).toBe("285.0000");
    expect(result.total.toFixed(4)).toBe("2685.0000");
    expect(result.baseTotal.toFixed(4)).toBe("2685.0000");
  });

  it("rejects a discount that exceeds the line gross amount", () => {
    expect(() => calculatePurchaseInvoice([
      { description: "خدمة", quantity: "1.0000", unitPrice: "100.0000", discountAmount: "100.0001", debitAccountId: 1n, taxRate: "15.0000" },
    ], "1.00000000")).toThrowError(new PurchaseCalculationError("INVALID_DISCOUNT"));
  });

  it("uses the sum of rounded line bases", () => {
    const result = calculatePurchaseInvoice([
      { description: "أ", quantity: "1.0000", unitPrice: "0.3333", discountAmount: "0.0000", debitAccountId: 1n, taxRateId: 2n, taxRate: "15.0000" },
      { description: "ب", quantity: "1.0000", unitPrice: "0.3333", discountAmount: "0.0000", debitAccountId: 1n, taxRateId: 2n, taxRate: "15.0000" },
    ], "3.75000000");
    const detailBase = result.lines.reduce((sum, line) => sum + Number(line.netAmount.mul(3.75).toDecimalPlaces(4)) + Number(line.taxAmount.mul(3.75).toDecimalPlaces(4)), 0);
    expect(result.baseTotal.toFixed(4)).toBe(detailBase.toFixed(4));
  });
});
