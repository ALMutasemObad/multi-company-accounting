import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildStatementRows, syntheticStatementRow, type AccountBalanceInput } from "../src/reports/financial-statement-calculator.js";

const row = (value: Partial<AccountBalanceInput> & Pick<AccountBalanceInput, "id" | "code" | "nameAr" | "accountClass">): AccountBalanceInput => ({
  parentAccountId: null, level: 1, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0), ...value,
});

describe("financial statement calculations", () => {
  it("aggregates the hierarchy using each account class natural balance", () => {
    const inputs = [
      row({ id: 1n, code: "1000", nameAr: "الأصول", accountClass: "ASSET" }),
      row({ id: 2n, parentAccountId: 1n, level: 2, code: "1120", nameAr: "البنك", accountClass: "ASSET", debit: new Prisma.Decimal("315750") }),
      row({ id: 3n, code: "3000", nameAr: "حقوق الملكية", accountClass: "EQUITY" }),
      row({ id: 4n, parentAccountId: 3n, level: 2, code: "3110", nameAr: "رأس المال", accountClass: "EQUITY", credit: new Prisma.Decimal("300000") }),
      row({ id: 5n, code: "4110", nameAr: "الإيراد", accountClass: "REVENUE", credit: new Prisma.Decimal("88500") }),
      row({ id: 6n, code: "5110", nameAr: "المصروف", accountClass: "EXPENSE", debit: new Prisma.Decimal("72750") }),
    ];
    const assets = buildStatementRows(inputs, "ASSET", false);
    const equity = buildStatementRows(inputs, "EQUITY", false);
    const revenue = buildStatementRows(inputs, "REVENUE", false);
    const expenses = buildStatementRows(inputs, "EXPENSE", false);
    const earnings = revenue.total.sub(expenses.total);
    expect(assets.total.toFixed(4)).toBe("315750.0000");
    expect(equity.total.add(earnings).toFixed(4)).toBe("315750.0000");
    expect(assets.rows[0]?.children[0]?.amount).toBe("315750.0000");
    expect(syntheticStatementRow("CURRENT-EARNINGS", "الأرباح", earnings, null).amount).toBe("15750.0000");
  });

  it("calculates comparison variance and safely handles a zero comparison", () => {
    const result = buildStatementRows([row({ id: 1n, code: "4110", nameAr: "الإيراد", accountClass: "REVENUE", credit: new Prisma.Decimal("100"), comparisonCredit: new Prisma.Decimal(0) })], "REVENUE", true);
    expect(result.rows[0]).toMatchObject({ amount: "100.0000", comparisonAmount: "0.0000", variance: "100.0000", variancePercent: null });
  });
});
