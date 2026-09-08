import type { FiscalPeriod } from "./types";

type SelectablePeriod = Pick<FiscalPeriod, "id" | "startDate" | "endDate" | "status">;

export type InvoicePeriodDefaults = {
  fiscalPeriodId: string;
  documentDate: string;
};

export type InvoiceDateFields = InvoicePeriodDefaults & { dueDate: string };

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

export function invoiceDateToday(timeZone?: string, now = new Date()) {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en", {
        timeZone,
        calendar: "gregory",
        numberingSystem: "latn",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const value = ["year", "month", "day"]
        .map((type) => parts.find((part) => part.type === type)?.value ?? "")
        .join("-");
      if (isoDatePattern.test(value)) return value;
    } catch {
      // UTC is a deterministic fallback when the company timezone is absent or invalid.
    }
  }
  return now.toISOString().slice(0, 10);
}

function dateValue(value: string) {
  if (!isoDatePattern.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function validOpenPeriod(period: SelectablePeriod) {
  const start = dateValue(period.startDate);
  const end = dateValue(period.endDate);
  return period.status !== "CLOSED" && start !== null && end !== null && start <= end
    ? { period, start, end }
    : null;
}

export function clampDocumentDate(documentDate: string, period: SelectablePeriod) {
  if (documentDate < period.startDate) return period.startDate;
  if (documentDate > period.endDate) return period.endDate;
  return documentDate;
}

export function defaultInvoicePeriod(
  periods: readonly SelectablePeriod[],
  today: string,
): InvoicePeriodDefaults | null {
  const todayValue = dateValue(today);
  if (todayValue === null) return null;

  const candidates = periods
    .map(validOpenPeriod)
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .map((candidate) => ({
      ...candidate,
      distance: todayValue < candidate.start
        ? candidate.start - todayValue
        : todayValue > candidate.end ? todayValue - candidate.end : 0,
    }))
    .sort((left, right) => left.distance - right.distance
      || left.start - right.start
      || left.end - right.end
      || left.period.id.localeCompare(right.period.id));

  const selected = candidates[0]?.period;
  return selected
    ? { fiscalPeriodId: selected.id, documentDate: clampDocumentDate(today, selected) }
    : null;
}

export function dueDateAfterDocumentDateChange(
  currentDueDate: string,
  nextDocumentDate: string,
  dueDateWasEdited: boolean,
) {
  return dueDateWasEdited ? currentDueDate : nextDocumentDate;
}

export function initialInvoiceDateFields(
  periods: readonly SelectablePeriod[],
  today: string,
  existing?: InvoiceDateFields,
): InvoiceDateFields {
  if (existing) return { ...existing };
  const defaults = defaultInvoicePeriod(periods, today);
  return defaults
    ? { ...defaults, dueDate: defaults.documentDate }
    : { fiscalPeriodId: "", documentDate: today, dueDate: today };
}

export function pendingCreationDateDefaults(
  periods: readonly SelectablePeriod[],
  today: string,
  blocked: { existingInvoice: boolean; userTouchedDateFields: boolean },
) {
  return blocked.existingInvoice || blocked.userTouchedDateFields
    ? null
    : defaultInvoicePeriod(periods, today);
}
