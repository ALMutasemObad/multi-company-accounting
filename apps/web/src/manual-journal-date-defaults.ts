import type { FiscalPeriod } from "./types";

type EligiblePeriod = Pick<FiscalPeriod, "id" | "startDate" | "endDate" | "status">;

export type ManualJournalDateDefaults = {
  fiscalPeriodId: string;
  documentDate: string;
};

export type PendingManualJournalDefaults = {
  fiscalPeriodId: string | null;
  documentDate: string | null;
  entryDate: string | null;
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

export function manualJournalCalendarDate(timeZone?: string, now = new Date()) {
  const fallback = now.toISOString().slice(0, 10);
  if (!timeZone?.trim()) return fallback;
  try {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const value = ["year", "month", "day"]
      .map((type) => parts.find((part) => part.type === type)?.value ?? "")
      .join("-");
    return isoDatePattern.test(value) ? value : fallback;
  } catch (cause) {
    if (cause instanceof RangeError) return fallback;
    throw cause;
  }
}

function dateValue(value: string) {
  if (!isoDatePattern.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

export function defaultManualJournalPeriod(
  periods: readonly EligiblePeriod[],
  companyDate: string,
): ManualJournalDateDefaults | null {
  const companyDateValue = dateValue(companyDate);
  if (companyDateValue === null) return null;

  const candidates = periods.flatMap((period) => {
    if (period.status !== "OPEN" && period.status !== "REOPENED") return [];
    const start = dateValue(period.startDate);
    const end = dateValue(period.endDate);
    if (start === null || end === null || start > end) return [];
    const documentDate = companyDateValue < start
      ? period.startDate
      : companyDateValue > end ? period.endDate : companyDate;
    const selectedDateValue = companyDateValue < start ? start : companyDateValue > end ? end : companyDateValue;
    return [{ period, documentDate, distance: Math.abs(companyDateValue - selectedDateValue), start, end }];
  }).sort((left, right) => left.distance - right.distance
    || left.start - right.start
    || left.end - right.end
    || left.period.id.localeCompare(right.period.id));

  const selected = candidates[0];
  return selected
    ? { fiscalPeriodId: selected.period.id, documentDate: selected.documentDate }
    : null;
}

export function pendingManualJournalDefaults(
  periods: readonly EligiblePeriod[],
  companyDate: string,
  currentDocumentDate: string,
  blocked: {
    persistedDraft: boolean;
    userTouchedPeriod: boolean;
    userTouchedDocumentDate: boolean;
    userTouchedEntryDate: boolean;
  },
): PendingManualJournalDefaults | null {
  if (blocked.persistedDraft) return null;
  const requestedDate = blocked.userTouchedDocumentDate ? currentDocumentDate : companyDate;
  const defaults = defaultManualJournalPeriod(periods, requestedDate);
  if (!defaults) return null;
  return {
    fiscalPeriodId: blocked.userTouchedPeriod ? null : defaults.fiscalPeriodId,
    documentDate: blocked.userTouchedDocumentDate ? null : defaults.documentDate,
    entryDate: blocked.userTouchedEntryDate
      ? null
      : blocked.userTouchedDocumentDate ? requestedDate : defaults.documentDate,
  };
}
