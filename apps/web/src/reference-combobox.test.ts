import { describe, expect, it } from "vitest";
import { mergeReferenceOptions, referenceOptionsPath } from "./ReferenceCombobox";

describe("reference combobox query helpers", () => {
  it("preserves fixed filters and encodes paginated server search", () => {
    const arabicSearch = "\u0625\u064a\u0631\u0627\u062f \u0641\u0631\u0639";
    expect(referenceOptionsPath("/accounts?active=true&allowsPosting=true", {
      page: 3,
      pageSize: 20,
      search: `  ${arabicSearch}  `,
    })).toBe("/accounts?active=true&allowsPosting=true&page=3&pageSize=20&search=%D8%A5%D9%8A%D8%B1%D8%A7%D8%AF+%D9%81%D8%B1%D8%B9");
  });

  it("removes stale search and de-duplicates appended pages by id", () => {
    expect(referenceOptionsPath("/customers?active=true&search=old", {
      page: 1,
      pageSize: 20,
      search: "",
    })).toBe("/customers?active=true&page=1&pageSize=20");
    expect(mergeReferenceOptions(
      [{ id: "1", name: "first" }, { id: "2", name: "old" }],
      [{ id: "2", name: "new" }, { id: "3", name: "third" }],
    )).toEqual([
      { id: "1", name: "first" },
      { id: "2", name: "new" },
      { id: "3", name: "third" },
    ]);
  });
});
