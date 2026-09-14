import { describe, expect, it } from "vitest";
import { TablePaginationError, paginateTableRows } from "../src/document-output-kernel/table-pagination.js";

describe("document output table pagination", () => {
  it("breaks before overflow and keeps every row exactly once", () => {
    expect(paginateTableRows([24, 24, 40, 24], 64)).toEqual([{ rowIndexes: [0, 1] }, { rowIndexes: [2, 3] }]);
  });

  it("fails an unrenderable row instead of looping or clipping it", () => {
    expect(() => paginateTableRows([65], 64)).toThrow(new TablePaginationError("TABLE_ROW_EXCEEDS_PAGE:0"));
  });
});
