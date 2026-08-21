import type { Allocation, Currency, JournalEntry, Payment } from "./types";
import { activeIntlLocale, dictionaries, translate, type TranslationKey } from "./i18n";

export function messageForError(code?: string, reason?: string) {
  for (const candidate of [reason, code]) {
    const key = `errors.${candidate ?? ""}`;
    if (Object.hasOwn(dictionaries.ar, key)) return translate(key as TranslationKey);
  }
  return translate("errors.DEFAULT");
}

export function statusLabel(status: Payment["document"]["status"]) {
  return translate(`status.${status}` as TranslationKey);
}

export function formatMoney(value: string | number) {
  const amount = typeof value === "number" ? value : Number(value);
  return new Intl.NumberFormat(activeIntlLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function exchangeRateForCurrency(currency?: Currency) {
  if (!currency) return "";
  if (currency.isBase) return "1.00000000";
  return currency.latestExchangeRate ?? "";
}

export function allocationsTotal(allocations: Allocation[]) {
  return allocations.reduce(
    (sum, allocation) => sum + Number(allocation.allocatedAmount || 0),
    0,
  );
}

export function validatePaymentDraft(input: {
  supplierId: string;
  counterAccountId: string;
  amount: string;
  exchangeRate: string;
  allocations: Allocation[];
}) {
  const errors: string[] = [];
  if (Boolean(input.supplierId) === Boolean(input.counterAccountId))
    errors.push(translate("validation.payment.counterparty"));
  if (Number(input.amount) <= 0) errors.push(translate("validation.payment.amount"));
  if (Number(input.exchangeRate) <= 0)
    errors.push(translate("validation.payment.rate"));
  if (
    input.allocations.length > 0 &&
    Math.abs(allocationsTotal(input.allocations) - Number(input.amount)) > 0.00005
  )
    errors.push(translate("validation.payment.allocationsTotal"));
  if (
    input.allocations.some(
      (allocation) =>
        !allocation.targetJournalLineId ||
        Number(allocation.allocatedAmount) <= 0,
    )
  )
    errors.push(translate("validation.payment.allocationLine"));
  return errors;
}

export function validateReceiptDraft(input: {
  customerId: string;
  counterAccountId: string;
  amount: string;
  exchangeRate: string;
  allocations: Allocation[];
}) {
  const errors = validatePaymentDraft({
    supplierId: input.customerId,
    counterAccountId: input.counterAccountId,
    amount: input.amount,
    exchangeRate: input.exchangeRate,
    allocations: input.allocations,
  });
  if (Boolean(input.customerId) === Boolean(input.counterAccountId))
    errors[0] = translate("validation.receipt.counterparty");
  return errors;
}

export function toMoney(value: string) {
  const numeric = Number(value || 0);
  return numeric.toFixed(4);
}

export function toRate(value: string) {
  const numeric = Number(value || 0);
  return numeric.toFixed(8);
}

export function journalTotals(entries: JournalEntry[]) {
  return entries.flatMap((entry) => entry.lines).reduce(
    (total, line) => ({
      debit: total.debit + Number(line.debitAmount || 0) * Number(line.exchangeRate || 0),
      credit: total.credit + Number(line.creditAmount || 0) * Number(line.exchangeRate || 0),
    }),
    { debit: 0, credit: 0 },
  );
}

export function validateJournalDraft(entries: JournalEntry[]) {
  const errors: string[] = [];
  if (!entries.length) errors.push(translate("validation.journal.required"));
  entries.forEach((entry, entryIndex) => {
    if (!entry.description.trim()) errors.push(translate("validation.journal.description", { entry: entryIndex + 1 }));
    if (entry.lines.length < 2) errors.push(translate("validation.journal.lines", { entry: entryIndex + 1 }));
    entry.lines.forEach((line, lineIndex) => {
      const debit = Number(line.debitAmount || 0);
      const credit = Number(line.creditAmount || 0);
      if (!line.accountId || !line.currencyId || Number(line.exchangeRate) <= 0 || (debit > 0) === (credit > 0))
        errors.push(translate("validation.journal.line", { line: lineIndex + 1, entry: entryIndex + 1 }));
    });
    const entryTotals = journalTotals([entry]);
    if (Math.abs(entryTotals.debit - entryTotals.credit) > 0.00005)
      errors.push(translate("validation.journal.unbalanced", { entry: entryIndex + 1 }));
  });
  const totals = journalTotals(entries);
  if (entries.length && Math.abs(totals.debit - totals.credit) > 0.00005)
    errors.push(translate("validation.journal.totalUnbalanced"));
  return errors;
}

export function validateFiscalPeriods(yearStart: string, yearEnd: string, periods: Array<{ periodNumber: number; startDate: string; endDate: string }>) {
  const errors: string[] = [];
  if (!yearStart || !yearEnd || yearEnd < yearStart) errors.push(translate("validation.fiscal.range"));
  if (!periods.length) errors.push(translate("validation.fiscal.required"));
  const numbers = new Set<number>();
  periods.forEach((period, index) => {
    if (numbers.has(period.periodNumber)) errors.push(translate("validation.fiscal.duplicate"));
    numbers.add(period.periodNumber);
    if (!period.startDate || !period.endDate || period.endDate < period.startDate || period.startDate < yearStart || period.endDate > yearEnd)
      errors.push(translate("validation.fiscal.dates", { period: index + 1 }));
  });
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 1; i < sorted.length; i += 1)
    if (sorted[i]!.startDate <= sorted[i - 1]!.endDate) errors.push(translate("validation.fiscal.overlap"));
  return [...new Set(errors)];
}

export function flattenTree<T extends { id: string }>(items: T[], parentOf: (item: T) => string | null) {
  const children = new Map<string | null, T[]>();
  items.forEach((item) => children.set(parentOf(item), [...(children.get(parentOf(item)) ?? []), item]));
  const result: Array<T & { treeDepth: number }> = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const item of children.get(parentId) ?? []) {
      if (visited.has(item.id)) continue;
      visited.add(item.id); result.push({ ...item, treeDepth: depth }); walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  items.forEach((item) => { if (!visited.has(item.id)) { visited.add(item.id); result.push({ ...item, treeDepth: 0 }); walk(item.id, 1); } });
  return result;
}

export function validateTreasuryAccount(input: { accountType: "CASH" | "BANK"; ledgerAccountId: string; bankName: string }) {
  const errors: string[] = [];
  if (!input.ledgerAccountId) errors.push(translate("validation.treasury.ledger"));
  if (input.accountType === "BANK" && !input.bankName.trim()) errors.push(translate("validation.treasury.bankName"));
  if (input.accountType === "CASH" && input.bankName.trim()) errors.push(translate("validation.treasury.cashBankName"));
  return errors;
}
