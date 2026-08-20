import { Prisma } from "@prisma/client";

export type FinancialAccountClass = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type AccountBalanceInput = {
  id: bigint;
  parentAccountId: bigint | null;
  code: string;
  nameAr: string;
  level: number;
  accountClass: FinancialAccountClass;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  comparisonDebit?: Prisma.Decimal | undefined;
  comparisonCredit?: Prisma.Decimal | undefined;
};

export type StatementRow = {
  accountId: string | null;
  code: string;
  nameAr: string;
  level: number;
  amount: string;
  comparisonAmount: string | null;
  variance: string | null;
  variancePercent: string | null;
  children: StatementRow[];
};

const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(4).toFixed(4);
const natural = (row: AccountBalanceInput, comparison = false) => {
  const debit = comparison ? row.comparisonDebit ?? zero() : row.debit;
  const credit = comparison ? row.comparisonCredit ?? zero() : row.credit;
  return row.accountClass === "ASSET" || row.accountClass === "EXPENSE" ? debit.sub(credit) : credit.sub(debit);
};
const varianceFields = (amount: Prisma.Decimal, comparison: Prisma.Decimal | null) => {
  if (comparison == null) return { comparisonAmount: null, variance: null, variancePercent: null };
  const variance = amount.sub(comparison);
  return {
    comparisonAmount: money(comparison),
    variance: money(variance),
    variancePercent: comparison.isZero() ? null : variance.div(comparison.abs()).mul(100).toDecimalPlaces(2).toFixed(2),
  };
};

export function buildStatementRows(inputs: AccountBalanceInput[], accountClass: FinancialAccountClass, hasComparison: boolean, includeZeroBalances = false) {
  const members = inputs.filter((row) => row.accountClass === accountClass);
  const memberIds = new Set(members.map((row) => row.id.toString()));
  const children = new Map<string, AccountBalanceInput[]>();
  for (const row of members) {
    const parentKey = row.parentAccountId != null && memberIds.has(row.parentAccountId.toString()) ? row.parentAccountId.toString() : "root";
    children.set(parentKey, [...(children.get(parentKey) ?? []), row]);
  }
  for (const rows of children.values()) rows.sort((left, right) => left.code.localeCompare(right.code, "en"));

  const visit = (row: AccountBalanceInput): { output: StatementRow; amount: Prisma.Decimal; comparison: Prisma.Decimal } => {
    const descendants = (children.get(row.id.toString()) ?? []).map(visit);
    const amount = descendants.reduce((sum, item) => sum.add(item.amount), natural(row));
    const comparison = descendants.reduce((sum, item) => sum.add(item.comparison), natural(row, true));
    const outputChildren = descendants.map((item) => item.output).filter((item) => includeZeroBalances || Number(item.amount) !== 0 || Number(item.comparisonAmount ?? 0) !== 0 || item.children.length > 0);
    return {
      amount,
      comparison,
      output: {
        accountId: row.id.toString(), code: row.code, nameAr: row.nameAr, level: row.level,
        amount: money(amount), ...varianceFields(amount, hasComparison ? comparison : null), children: outputChildren,
      },
    };
  };
  const roots = (children.get("root") ?? []).map(visit);
  return {
    rows: roots.map((item) => item.output).filter((item) => includeZeroBalances || Number(item.amount) !== 0 || Number(item.comparisonAmount ?? 0) !== 0 || item.children.length > 0),
    total: roots.reduce((sum, item) => sum.add(item.amount), zero()),
    comparisonTotal: roots.reduce((sum, item) => sum.add(item.comparison), zero()),
  };
}

export function syntheticStatementRow(code: string, nameAr: string, amount: Prisma.Decimal, comparison: Prisma.Decimal | null): StatementRow {
  return { accountId: null, code, nameAr, level: 1, amount: money(amount), ...varianceFields(amount, comparison), children: [] };
}

export function decimalMoney(value: Prisma.Decimal) { return money(value); }
