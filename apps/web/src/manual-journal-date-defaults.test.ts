import { describe, expect, it } from "vitest";
import {
  defaultManualJournalPeriod,
  manualJournalCalendarDate,
  pendingManualJournalDefaults,
} from "./manual-journal-date-defaults";

const period = (
  id: string,
  startDate: string,
  endDate: string,
  status: "OPEN" | "CLOSED" | "REOPENED" = "OPEN",
) => ({ id, startDate, endDate, status });

describe("manual journal date defaults", () => {
  it("uses the company calendar date with deterministic UTC fallback", () => {
    const instant = new Date("2026-09-08T22:30:00.000Z");
    expect(manualJournalCalendarDate("Asia/Riyadh", instant)).toBe("2026-09-09");
    expect(manualJournalCalendarDate("America/Los_Angeles", instant)).toBe("2026-09-08");
    expect(manualJournalCalendarDate("Invalid/Timezone", instant)).toBe("2026-09-08");
    expect(manualJournalCalendarDate(undefined, instant)).toBe("2026-09-08");
  });

  it("selects an open or reopened period containing the company date", () => {
    expect(defaultManualJournalPeriod([
      period("closed", "2026-09-01", "2026-09-30", "CLOSED"),
      period("reopened", "2026-09-01", "2026-09-30", "REOPENED"),
    ], "2026-09-09")).toEqual({ fiscalPeriodId: "reopened", documentDate: "2026-09-09" });
  });

  it("selects the nearest eligible period and clamps deterministically", () => {
    const periods = [
      period("future", "2026-10-01", "2026-10-31"),
      period("past", "2026-08-01", "2026-08-31"),
    ];
    expect(defaultManualJournalPeriod(periods, "2026-09-09"))
      .toEqual({ fiscalPeriodId: "past", documentDate: "2026-08-31" });
    expect(defaultManualJournalPeriod(periods, "2026-11-15"))
      .toEqual({ fiscalPeriodId: "future", documentDate: "2026-10-31" });
    expect(defaultManualJournalPeriod([
      period("z", "2026-09-11", "2026-09-20"),
      period("a", "2026-09-01", "2026-09-07"),
    ], "2026-09-09")).toEqual({ fiscalPeriodId: "a", documentDate: "2026-09-07" });
  });

  it("rejects invalid dates and ineligible periods", () => {
    expect(defaultManualJournalPeriod([
      period("closed", "2026-09-01", "2026-09-30", "CLOSED"),
      period("invalid", "2026-09-31", "2026-10-01"),
    ], "2026-09-09")).toBeNull();
    expect(defaultManualJournalPeriod([], "not-a-date")).toBeNull();
  });

  it("never replaces a persisted draft or fields touched before references arrive", () => {
    const periods = [period("september", "2026-09-01", "2026-09-30")];
    expect(pendingManualJournalDefaults(periods, "2026-09-09", "2025-01-15", {
      persistedDraft: true,
      userTouchedPeriod: false,
      userTouchedDocumentDate: false,
      userTouchedEntryDate: false,
    })).toBeNull();
    expect(pendingManualJournalDefaults(periods, "2026-09-09", "2026-09-15", {
      persistedDraft: false,
      userTouchedPeriod: true,
      userTouchedDocumentDate: true,
      userTouchedEntryDate: true,
    })).toEqual({ fiscalPeriodId: null, documentDate: null, entryDate: null });
  });
});
