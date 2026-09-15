import { describe, expect, it } from "vitest";
import { csvEscape, tableToCsv, tableToXlsx } from "../src/document-output-kernel/tabular-profile.js";

describe("document output tabular profile", () => {
  it("protects formula-like CSV cells, including whitespace-prefixed formulas", () => {
    expect(csvEscape("=1+1")).toBe("\"'=1+1\"");
    expect(csvEscape("  @SUM(A1:A2)")).toBe("\"'  @SUM(A1:A2)\"");
    expect(tableToCsv([[{ value: "\t-1" }]]).toString("utf8")).toContain("'\t-1");
  });

  it("keeps canonical numeric cells numeric and formula-looking cells as text in XLSX", () => {
    const xlsx = tableToXlsx([[{ value: "9007199254740993.1234", numeric: true }, { value: "=1+1", numeric: true }]], "اختبار").toString("utf8");
    expect(xlsx).toContain('<v>9007199254740993.1234</v>');
    expect(xlsx).toContain('t="inlineStr"');
  });

  it("uses an explicit LTR sheet view when requested", () => {
    const xlsx = tableToXlsx([[{ value: "Account" }]], "Export", { direction: "LTR" }).toString("utf8");
    expect(xlsx).toContain('rightToLeft="0"');
  });
});
