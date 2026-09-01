import type { CashierContextPeriodResult } from "./cashier-context-period-port.js";

export class CashierContextPeriodError extends Error {
  readonly reason = "INVALID_DOCUMENT_DATE";
  constructor() { super("INVALID_DOCUMENT_DATE"); }
}

/** Strict calendar day; rejects JS Date rollover, timestamps and timezone suffixes. */
export function cashierContextDocumentDay(value: string): Date {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw new CashierContextPeriodError();
  const day = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) throw new CashierContextPeriodError();
  return day;
}

export type CashierContextPeriodRow = {
  id: bigint; name: string; startDate: Date; endDate: Date;
  status: "OPEN" | "CLOSED" | "REOPENED"; version: number;
};

/** Input is the owner's bounded date-matching query, including closed periods. */
export function classifyCashierContextPeriods(documentDate: string, rows: readonly CashierContextPeriodRow[]): CashierContextPeriodResult {
  cashierContextDocumentDay(documentDate);
  if (rows.length > 1) return { documentDate, status: "AMBIGUOUS" };
  const period = rows[0];
  if (!period) return { documentDate, status: "MISSING" };
  if (period.status === "CLOSED") return { documentDate, status: "CLOSED" };
  return { documentDate, status: "RESOLVED", period: {
    id: period.id.toString(), name: period.name,
    startDate: period.startDate.toISOString().slice(0, 10), endDate: period.endDate.toISOString().slice(0, 10),
    status: period.status, version: period.version,
  } };
}
