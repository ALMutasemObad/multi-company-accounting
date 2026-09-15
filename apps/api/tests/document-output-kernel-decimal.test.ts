import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { DecimalDisplayError, formatDecimal } from "../src/document-output-kernel/decimal.js";

describe("document output decimal formatting", () => {
  it("groups canonical monetary strings without Number precision loss", () => {
    expect(formatDecimal("9007199254740993.1234")).toBe("9,007,199,254,740,993.1234");
    expect(formatDecimal("-12.5")).toBe("-12.50");
  });

  it("rejects values that would require implicit decimal rounding", () => {
    expect(() => formatDecimal("1.12345")).toThrow(DecimalDisplayError);
    expect(() => formatDecimal("1e6")).toThrow(DecimalDisplayError);
  });

  it("keeps money formatting free of Number conversion", async () => {
    const source = await readFile(new URL("../src/document-output-kernel/decimal.ts", import.meta.url), "utf8");
    expect(source).not.toContain("Number(");
  });
});
