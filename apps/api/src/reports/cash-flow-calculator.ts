import { Prisma, type CashFlowMappingClassification } from "@prisma/client";
import type { CashFlowAccountInput, CashFlowLine } from "./cash-flow-types.js";

const ZERO = new Prisma.Decimal(0);
const TOLERANCE = new Prisma.Decimal("0.0001");

const templateMappings: Readonly<Record<string, CashFlowMappingClassification>> = {
  receivables: "OPERATING_WORKING_CAPITAL",
  "input-vat": "OPERATING_WORKING_CAPITAL",
  inventory: "OPERATING_WORKING_CAPITAL",
  prepayments: "OPERATING_WORKING_CAPITAL",
  "employee-advances": "OPERATING_WORKING_CAPITAL",
  payables: "OPERATING_WORKING_CAPITAL",
  "output-vat": "OPERATING_WORKING_CAPITAL",
  "accrued-expenses": "OPERATING_WORKING_CAPITAL",
  "salaries-payable": "OPERATING_WORKING_CAPITAL",
  "other-payables": "OPERATING_WORKING_CAPITAL",
  equipment: "INVESTING",
  furniture: "INVESTING",
  vehicles: "INVESTING",
  "accumulated-depreciation-equipment": "EXCLUDED",
  "accumulated-depreciation-furniture": "EXCLUDED",
  "accumulated-depreciation-vehicles": "EXCLUDED",
  loans: "FINANCING",
  capital: "FINANCING",
  "owner-current": "FINANCING",
  "retained-earnings": "EXCLUDED",
  "current-year-result": "EXCLUDED",
  "depreciation-expense": "OPERATING_ADJUSTMENT",
};

export function defaultCashFlowClassification(
  sourceTemplateKey: string | null,
  accountClass: CashFlowAccountInput["accountClass"],
): CashFlowMappingClassification | null {
  if (sourceTemplateKey && templateMappings[sourceTemplateKey]) return templateMappings[sourceTemplateKey];
  if (accountClass === "REVENUE" || accountClass === "EXPENSE") return "NET_INCOME";
  return null;
}

function natural(value: Prisma.Decimal, normalBalance: CashFlowAccountInput["normalBalance"]) {
  return normalBalance === "DEBIT" ? value : value.negated();
}

function cashEffect(account: CashFlowAccountInput) {
  const delta = natural(account.closingSigned, account.normalBalance).sub(natural(account.openingSigned, account.normalBalance));
  return account.normalBalance === "DEBIT" ? delta.negated() : delta;
}

function line(account: CashFlowAccountInput, amount: Prisma.Decimal): CashFlowLine {
  return {
    accountId: account.accountId.toString(),
    code: account.code,
    nameAr: account.nameAr,
    nameEn: account.nameEn,
    amount: amount.toFixed(4),
  };
}

function total(rows: Array<{ amount: string }>) {
  return rows.reduce((sum, row) => sum.add(row.amount), ZERO).toFixed(4);
}

export function calculateIndirectCashFlow(accounts: CashFlowAccountInput[]) {
  const sorted = [...accounts].sort((left, right) => left.code.localeCompare(right.code));
  const cashAccounts = sorted.filter((account) => account.classification === "CASH_AND_CASH_EQUIVALENTS");
  const openingCash = cashAccounts.reduce((sum, account) => sum.add(natural(account.openingSigned, account.normalBalance)), ZERO);
  const closingCash = cashAccounts.reduce((sum, account) => sum.add(natural(account.closingSigned, account.normalBalance)), ZERO);

  const revenues = sorted.filter((account) => account.accountClass === "REVENUE")
    .reduce((sum, account) => sum.add(natural(account.periodSigned, account.normalBalance)), ZERO);
  const expenses = sorted.filter((account) => account.accountClass === "EXPENSE")
    .reduce((sum, account) => sum.add(natural(account.periodSigned, account.normalBalance)), ZERO);
  const netIncome = revenues.sub(expenses);

  const adjustments = sorted
    .filter((account) => account.classification === "OPERATING_ADJUSTMENT")
    .map((account) => line(account, account.accountClass === "EXPENSE"
      ? natural(account.periodSigned, account.normalBalance)
      : natural(account.periodSigned, account.normalBalance).negated()));
  const workingCapital = sorted
    .filter((account) => account.classification === "OPERATING_WORKING_CAPITAL")
    .map((account) => line(account, cashEffect(account)));
  const investing = sorted
    .filter((account) => account.classification === "INVESTING")
    .map((account) => line(account, cashEffect(account)));
  const financing = sorted
    .filter((account) => account.classification === "FINANCING")
    .map((account) => line(account, cashEffect(account)));

  const adjustmentsTotal = adjustments.reduce((sum, row) => sum.add(row.amount), ZERO);
  const workingCapitalTotal = workingCapital.reduce((sum, row) => sum.add(row.amount), ZERO);
  const operatingTotal = netIncome.add(adjustmentsTotal).add(workingCapitalTotal);
  const investingTotal = investing.reduce((sum, row) => sum.add(row.amount), ZERO);
  const financingTotal = financing.reduce((sum, row) => sum.add(row.amount), ZERO);
  const calculatedNetChange = operatingTotal.add(investingTotal).add(financingTotal);
  const actualNetChange = closingCash.sub(openingCash);
  const difference = actualNetChange.sub(calculatedNetChange);

  const unmappedAccounts = sorted
    .filter((account) => account.classification == null && !natural(account.closingSigned, account.normalBalance).sub(natural(account.openingSigned, account.normalBalance)).isZero())
    .map((account) => ({
      accountId: account.accountId.toString(),
      code: account.code,
      nameAr: account.nameAr,
      nameEn: account.nameEn,
      change: natural(account.closingSigned, account.normalBalance).sub(natural(account.openingSigned, account.normalBalance)).toFixed(4),
    }));
  const mappingComplete = unmappedAccounts.length === 0 && cashAccounts.length > 0;

  return {
    sections: {
      operating: {
        netIncome: netIncome.toFixed(4),
        adjustments,
        adjustmentsTotal: adjustmentsTotal.toFixed(4),
        workingCapital,
        workingCapitalTotal: workingCapitalTotal.toFixed(4),
        total: operatingTotal.toFixed(4),
      },
      investing: { rows: investing, total: total(investing) },
      financing: { rows: financing, total: total(financing) },
    },
    cash: {
      opening: openingCash.toFixed(4),
      netChange: actualNetChange.toFixed(4),
      closing: closingCash.toFixed(4),
      calculatedNetChange: calculatedNetChange.toFixed(4),
      calculatedClosing: openingCash.add(calculatedNetChange).toFixed(4),
      difference: difference.toFixed(4),
      reconciled: mappingComplete && difference.abs().lessThan(TOLERANCE),
    },
    mapping: { complete: mappingComplete, cashAccountCount: cashAccounts.length, unmappedAccounts },
  };
}
