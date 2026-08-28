import { describe, expect, it } from "vitest";
import { isZeroDecimal, reconciliationCsv, reconciliationLineState } from "./bank-reconciliation";

describe("bank reconciliation UI helpers", () => {
  it("distinguishes unresolved, proposed, approved and classified lines", () => {
    const line = { classification: null } as never;
    expect(reconciliationLineState(line, null)).toBe("UNMATCHED");
    expect(reconciliationLineState(line, { status: "PROPOSED" } as never)).toBe("PROPOSED");
    expect(reconciliationLineState(line, { status: "APPROVED" } as never)).toBe("APPROVED");
    expect(reconciliationLineState({ classification: "BANK_FEE" } as never, null)).toBe("CLASSIFIED");
  });

  it("recognizes canonical zero values without floating point conversion", () => {
    expect(isZeroDecimal("0.0000")).toBe(true);
    expect(isZeroDecimal("-0.00")).toBe(true);
    expect(isZeroDecimal("0.0001")).toBe(false);
  });

  it("exports UTF-8 CSV while neutralizing spreadsheet formulas", () => {
    const csv = reconciliationCsv(["Reference", "Amount"], [["=HYPERLINK(1)", "-25.0000"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(1)\"");
    expect(csv).toContain("\"-25.0000\"");
  });
});
