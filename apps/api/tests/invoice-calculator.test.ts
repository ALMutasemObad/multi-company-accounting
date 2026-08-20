import { describe, expect, it } from "vitest";
import { calculateInvoice, InvoiceCalculationError } from "../src/sales/invoice-calculator.js";

describe("sales invoice calculator", () => {
  it("calculates quantities, discounts, VAT and base totals with four-decimal rounding", () => {
    const result = calculateInvoice([
      { description: "خدمات استشارية", quantity: "2.0000", unitPrice: "1000.0000", discountAmount: "100.0000", revenueAccountId: 1n, taxRateId: 2n, taxRate: "15.0000" },
      { description: "خدمة معفاة", quantity: "1.0000", unitPrice: "500.0000", discountAmount: "0.0000", revenueAccountId: 1n, taxRate: "0.0000" },
    ], "1.00000000");
    expect(result.subtotal.toFixed(4)).toBe("2500.0000");
    expect(result.discountTotal.toFixed(4)).toBe("100.0000");
    expect(result.taxableTotal.toFixed(4)).toBe("2400.0000");
    expect(result.taxTotal.toFixed(4)).toBe("285.0000");
    expect(result.total.toFixed(4)).toBe("2685.0000");
    expect(result.baseTotal.toFixed(4)).toBe("2685.0000");
  });

  it("rejects a discount that exceeds the gross line amount", () => {
    expect(() => calculateInvoice([
      { description: "خدمة", quantity: "1.0000", unitPrice: "100.0000", discountAmount: "100.0001", revenueAccountId: 1n, taxRate: "15.0000" },
    ], "1.00000000")).toThrowError(new InvoiceCalculationError("INVALID_DISCOUNT"));
  });

  it("keeps the base side balanced using the sum of rounded detail amounts", () => {
    const result = calculateInvoice([
      { description: "أ", quantity: "1.0000", unitPrice: "0.3333", discountAmount: "0.0000", revenueAccountId: 1n, taxRateId: 2n, taxRate: "15.0000" },
      { description: "ب", quantity: "1.0000", unitPrice: "0.3333", discountAmount: "0.0000", revenueAccountId: 1n, taxRateId: 2n, taxRate: "15.0000" },
    ], "3.75000000");
    const detailBase = result.lines.reduce((sum, line) => sum + Number(line.netAmount.mul(3.75).toDecimalPlaces(4)) + Number(line.taxAmount.mul(3.75).toDecimalPlaces(4)), 0);
    expect(result.baseTotal.toFixed(4)).toBe(detailBase.toFixed(4));
  });
});
