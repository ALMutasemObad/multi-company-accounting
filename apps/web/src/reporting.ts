import type { TrialBalanceRow } from "./types";

export function currentYearRange(today = new Date()) {
  const year = today.getFullYear();
  return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
}

export function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-SA", { month: "short", year: "numeric" }).format(new Date(Date.UTC(year!, month! - 1, 1)));
}

export function trialBalanceCsv(rows: TrialBalanceRow[]) {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const header = ["رمز الحساب", "اسم الحساب", "التصنيف", "مدين", "دائن", "الرصيد"];
  return [header, ...rows.map((row) => [row.code, row.nameAr, row.accountClass, row.debit, row.credit, row.balance])]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
}
