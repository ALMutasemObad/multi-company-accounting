import { describe, expect, it } from "vitest";
import { availableDocumentTabs, documentPanelId, documentTabId, nextDocumentTab, resolveDocumentTab } from "./document-tabs";

describe("sales and purchase document tabs", () => {
  it("omits aging and falls back to the first allowed tab", () => {
    const available = availableDocumentTabs(false);
    expect(available).toEqual(["invoices", "taxes"]);
    expect(resolveDocumentTab("aging", available)).toBe("invoices");
  });

  it("moves in visual direction for LTR and RTL while skipping unavailable tabs", () => {
    const all = availableDocumentTabs(true);
    const restricted = availableDocumentTabs(false);
    expect(nextDocumentTab("invoices", all, "ArrowRight", "ltr")).toBe("aging");
    expect(nextDocumentTab("invoices", all, "ArrowLeft", "rtl")).toBe("aging");
    expect(nextDocumentTab("invoices", restricted, "ArrowRight", "ltr")).toBe("taxes");
    expect(nextDocumentTab("invoices", restricted, "ArrowLeft", "rtl")).toBe("taxes");
  });

  it("supports wrapping, Home and End with stable ids", () => {
    const available = availableDocumentTabs(true);
    expect(nextDocumentTab("taxes", available, "ArrowRight", "ltr")).toBe("invoices");
    expect(nextDocumentTab("aging", available, "Home", "rtl")).toBe("invoices");
    expect(nextDocumentTab("aging", available, "End", "ltr")).toBe("taxes");
    expect(nextDocumentTab("aging", available, "Enter", "ltr")).toBeNull();
    expect(documentTabId("sales", "aging")).toBe("sales-documents-tab-aging");
    expect(documentPanelId("purchases")).toBe("purchases-documents-panel");
  });
});
