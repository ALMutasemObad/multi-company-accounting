import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { formatPrintDecimal } from "../src/printing/print-decimal.js";

describe("print decimal formatting", () => {
  it.each([
    ["0", "0.00"], ["0.0000", "0.00"], ["1", "1.00"],
    ["-0", "-0.00"], ["-0.0000", "-0.00"],
    ["125000.0000", "125,000.00"], ["1092.5000", "1,092.50"],
    ["1000.1000", "1,000.10"], ["1.2300", "1.23"], ["1.2340", "1.234"],
    ["0.0001", "0.0001"], ["-0.0001", "-0.0001"], ["-125000.5000", "-125,000.50"],
    ["123456789012345.6789", "123,456,789,012,345.6789"],
    ["999999999999999.9999", "999,999,999,999,999.9999"],
    ["-999999999999999.9999", "-999,999,999,999,999.9999"],
    // Quantity snapshots have six decimal places; display still has at most four.
    ["1.234449", "1.2344"], ["1.234450", "1.2345"], ["1.234451", "1.2345"],
    ["-1.234450", "-1.2345"], ["2.675050", "2.6751"],
    ["9.999950", "10.00"], ["-9.999950", "-10.00"],
    ["9999999999999.999949", "9,999,999,999,999.9999"],
    ["9999999999999.999950", "10,000,000,000,000.00"],
    ["0.000049", "0.00"], ["0.000050", "0.0001"], ["-0.000049", "-0.00"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatPrintDecimal(value)).toBe(expected);
    expect(formatPrintDecimal(new Prisma.Decimal(value))).toBe(expected);
  });

  it("does not depend on or change the global Decimal rounding mode", () => {
    const previous = Prisma.Decimal.rounding;
    try {
      Prisma.Decimal.set({ rounding: Prisma.Decimal.ROUND_DOWN });
      expect(formatPrintDecimal("1.234450")).toBe("1.2345");
      expect(Prisma.Decimal.rounding).toBe(Prisma.Decimal.ROUND_DOWN);
    } finally {
      Prisma.Decimal.set({ rounding: previous });
    }
  });

  it.each(["NaN", "Infinity", "-Infinity", "not-money", ""])("rejects invalid decimal %s", (value) => {
    expect(() => formatPrintDecimal(value)).toThrow();
  });
});
