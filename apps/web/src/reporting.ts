import type { TrialBalanceRow } from "./types";
import { activeIntlLocale, translate } from "./i18n";

export function currentYearRange(today = new Date()) {
  const year = today.getFullYear();
  return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
}

export function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(activeIntlLocale(), { month: "short", year: "numeric" }).format(new Date(Date.UTC(year!, month! - 1, 1)));
}

export function trialBalanceCsv(rows: TrialBalanceRow[]) {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const header = [translate("csv.accountCode"), translate("csv.accountName"), translate("csv.accountClass"), translate("csv.debit"), translate("csv.credit"), translate("csv.balance")];
  return [header, ...rows.map((row) => [row.code, row.nameAr, row.accountClass, row.debit, row.credit, row.balance])]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
}

export type AccountStatementSubjectType = "account" | "customer" | "supplier";

export function accountStatementQuery(input: {
  subjectType: AccountStatementSubjectType;
  subjectId: string;
  dateFrom: string;
  dateTo: string;
  page?: number;
  pageSize?: number;
}) {
  const subjectParameter = `${input.subjectType}Id`;
  const query = new URLSearchParams({
    [subjectParameter]: input.subjectId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  });
  if (input.page != null) query.set("page", String(input.page));
  if (input.pageSize != null) query.set("pageSize", String(input.pageSize));
  return query;
}
