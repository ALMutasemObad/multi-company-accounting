import { describe, expect, it } from "vitest";
import { paginateTableRows } from "../src/document-output-kernel/table-pagination.js";

const longArabicFixture = "بيان عربي طويل لا يجب قصه عند انتقال صف الجدول إلى صفحة جديدة ".repeat(4);

describe("report output visual fixtures", () => {
  it("keeps the long RTL fixture in a bounded page plan", () => {
    expect(longArabicFixture).toContain("عربي");
    expect(paginateTableRows([24, 60, 48], 108)).toEqual([{ rowIndexes: [0, 1] }, { rowIndexes: [2] }]);
  });
});
