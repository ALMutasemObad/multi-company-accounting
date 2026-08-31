import { describe, expect, it } from "vitest";
import { decimalChartValue, formatCurrencyDecimal, isPositiveDecimal, isZeroDecimal } from "./decimal-format";

describe("exact decimal presentation", () => {
  it("preserves non-zero fractions when public pricing hides trailing zeroes", () => {
    const options = { minimumFractionDigits: 0, maximumFractionDigits: 4 };
    expect(formatCurrencyDecimal("123.4567", "SAR", "en-US", options)).toBe("SAR 123.4567");
    expect(formatCurrencyDecimal("99.0000", "SAR", "en-US", options)).toBe("SAR 99");
    expect(formatCurrencyDecimal("0.0001", "SAR", "en-US", options)).toBe("SAR 0.0001");
    expect(formatCurrencyDecimal("-0.0100", "SAR", "en-US", options)).toBe("-SAR 0.01");
  });
  it("formats DECIMAL(19,4) without losing integer precision", () => {
    expect(formatCurrencyDecimal("999999999999999.9999", "SAR", "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })).toBe("SAR 999,999,999,999,999.9999");
  });

  it("rounds at the requested decimal boundary without Number conversion", () => {
    expect(formatCurrencyDecimal("999999999999999.9999", "USD", "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      currencyDisplay: "symbol",
    })).toBe("$1,000,000,000,000,000.00");
    expect(formatCurrencyDecimal("-0.0049", "USD", "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      currencyDisplay: "symbol",
    })).toBe("$0.00");
    expect(formatCurrencyDecimal("-0.0050", "USD", "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      currencyDisplay: "symbol",
    })).toBe("-$0.01");
  });

  it("checks sign exactly while limiting Number conversion to chart geometry", () => {
    expect(isPositiveDecimal("0.0000")).toBe(false);
    expect(isPositiveDecimal("000000000000000.0001")).toBe(true);
    expect(isPositiveDecimal("-0.0001")).toBe(false);
    expect(isZeroDecimal("-0.0000")).toBe(true);
    expect(isZeroDecimal("999999999999999.9999")).toBe(false);
    expect(decimalChartValue("12.5")).toBe(12.5);
  });
});
