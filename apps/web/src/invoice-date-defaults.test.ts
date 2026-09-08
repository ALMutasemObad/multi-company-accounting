import { describe, expect, it } from "vitest";
import {
  clampDocumentDate,
  defaultInvoicePeriod,
  dueDateAfterDocumentDateChange,
  initialInvoiceDateFields,
  invoiceDateToday,
  pendingCreationDateDefaults,
} from "./invoice-date-defaults";
import type { FiscalPeriod } from "./types";

const period = (id: string, startDate: string, endDate: string, status: FiscalPeriod["status"] = "OPEN") => ({
  id,
  startDate,
  endDate,
  status,
});

describe("invoice open-period defaults", () => {
  it("uses the company timezone when its calendar day differs from UTC", () => {
    const lateUtc = new Date("2026-09-08T23:30:00.000Z");
    expect(invoiceDateToday("Asia/Riyadh", lateUtc)).toBe("2026-09-09");
    expect(invoiceDateToday("America/New_York", lateUtc)).toBe("2026-09-08");
    expect(invoiceDateToday("Invalid/Timezone", lateUtc)).toBe("2026-09-08");
    expect(invoiceDateToday(undefined, lateUtc)).toBe("2026-09-08");
  });

  it("uses an open period containing today without moving the document date", () => {
    expect(defaultInvoicePeriod([
      period("later", "2026-10-01", "2026-10-31"),
      period("current", "2026-09-01", "2026-09-30"),
    ], "2026-09-08")).toEqual({ fiscalPeriodId: "current", documentDate: "2026-09-08" });
    expect(defaultInvoicePeriod([
      period("reopened", "2026-09-01", "2026-09-30", "REOPENED"),
    ], "2026-09-08")).toEqual({ fiscalPeriodId: "reopened", documentDate: "2026-09-08" });
  });

  it("chooses the closest open period and clamps dates before or after it", () => {
    expect(defaultInvoicePeriod([
      period("past", "2026-07-01", "2026-07-31"),
      period("future", "2026-12-01", "2026-12-31"),
    ], "2026-09-08")).toEqual({ fiscalPeriodId: "past", documentDate: "2026-07-31" });
    expect(defaultInvoicePeriod([
      period("future", "2026-12-01", "2026-12-31"),
    ], "2026-09-08")).toEqual({ fiscalPeriodId: "future", documentDate: "2026-12-01" });
    expect(defaultInvoicePeriod([
      period("past", "2026-07-01", "2026-07-31"),
    ], "2026-09-08")).toEqual({ fiscalPeriodId: "past", documentDate: "2026-07-31" });
  });

  it("breaks equal-distance and overlapping-period ties deterministically", () => {
    expect(defaultInvoicePeriod([
      period("z", "2026-09-11", "2026-09-20"),
      period("a", "2026-09-01", "2026-09-05"),
    ], "2026-09-08")?.fiscalPeriodId).toBe("a");
    expect(defaultInvoicePeriod([
      period("z", "2026-09-01", "2026-09-30"),
      period("a", "2026-09-01", "2026-09-30"),
    ], "2026-09-08")?.fiscalPeriodId).toBe("a");
  });

  it("does not claim a default when no valid open period is available", () => {
    expect(defaultInvoicePeriod([
      period("closed", "2026-09-01", "2026-09-30", "CLOSED"),
      period("invalid", "2026-09-31", "2026-10-01"),
    ], "2026-09-08")).toBeNull();
    expect(defaultInvoicePeriod([], "2026-09-08")).toBeNull();
    expect(defaultInvoicePeriod([period("open", "2026-09-01", "2026-09-30")], "not-a-date")).toBeNull();
    expect(initialInvoiceDateFields([], "2026-09-08")).toEqual({
      fiscalPeriodId: "",
      documentDate: "2026-09-08",
      dueDate: "2026-09-08",
    });
  });

  it("clamps to both boundaries and preserves an in-range date", () => {
    const december = period("december", "2026-12-01", "2026-12-31");
    expect(clampDocumentDate("2026-09-08", december)).toBe("2026-12-01");
    expect(clampDocumentDate("2026-12-01", december)).toBe("2026-12-01");
    expect(clampDocumentDate("2027-01-10", december)).toBe("2026-12-31");
    expect(clampDocumentDate("2026-12-31", december)).toBe("2026-12-31");
    expect(clampDocumentDate("2026-12-15", december)).toBe("2026-12-15");
  });

  it("keeps due date linked until the user edits it", () => {
    expect(dueDateAfterDocumentDateChange("2026-09-08", "2026-12-01", false)).toBe("2026-12-01");
    expect(dueDateAfterDocumentDateChange("2026-12-20", "2026-12-15", true)).toBe("2026-12-20");
  });

  it("preserves every persisted date field for an existing invoice", () => {
    const existing = {
      fiscalPeriodId: "closed-period",
      documentDate: "2025-04-10",
      dueDate: "2025-05-15",
    };
    expect(initialInvoiceDateFields([
      period("new-open-period", "2026-12-01", "2026-12-31"),
    ], "2026-09-08", existing)).toEqual(existing);
  });

  it("applies a late reference result only while a new form remains untouched", () => {
    const future = [period("future", "2026-12-01", "2026-12-31")];
    expect(pendingCreationDateDefaults([], "2026-09-08", {
      existingInvoice: false,
      userTouchedDateFields: false,
    })).toBeNull();
    expect(pendingCreationDateDefaults(future, "2026-09-08", {
      existingInvoice: false,
      userTouchedDateFields: false,
    })).toEqual({ fiscalPeriodId: "future", documentDate: "2026-12-01" });
    expect(pendingCreationDateDefaults(future, "2026-09-08", {
      existingInvoice: false,
      userTouchedDateFields: true,
    })).toBeNull();
    expect(pendingCreationDateDefaults(future, "2026-09-08", {
      existingInvoice: true,
      userTouchedDateFields: false,
    })).toBeNull();
  });
});
