import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateIndirectCashFlow, defaultCashFlowClassification } from "../src/reports/cash-flow-calculator.js";
import type { CashFlowAccountInput } from "../src/reports/cash-flow-types.js";

const account = (input: Partial<CashFlowAccountInput> & Pick<CashFlowAccountInput, "accountId" | "code" | "accountClass" | "normalBalance" | "classification">): CashFlowAccountInput => ({
  nameAr: input.code,
  nameEn: input.code,
  mappingSource: "EXPLICIT",
  openingSigned: new Prisma.Decimal(0),
  closingSigned: new Prisma.Decimal(0),
  periodSigned: new Prisma.Decimal(0),
  ...input,
});

describe("indirect cash-flow calculation", () => {
  it("reconciles net income, non-cash adjustments, working capital, investing and financing using Decimal", () => {
    const report = calculateIndirectCashFlow([
      account({ accountId: 1n, code: "1110", accountClass: "ASSET", normalBalance: "DEBIT", classification: "CASH_AND_CASH_EQUIVALENTS", openingSigned: new Prisma.Decimal("100.0000"), closingSigned: new Prisma.Decimal("130.0000") }),
      account({ accountId: 2n, code: "4110", accountClass: "REVENUE", normalBalance: "CREDIT", classification: "NET_INCOME", periodSigned: new Prisma.Decimal("-200.0000") }),
      account({ accountId: 3n, code: "5110", accountClass: "EXPENSE", normalBalance: "DEBIT", classification: "NET_INCOME", periodSigned: new Prisma.Decimal("100.0000") }),
      account({ accountId: 4n, code: "5410", accountClass: "EXPENSE", normalBalance: "DEBIT", classification: "OPERATING_ADJUSTMENT", periodSigned: new Prisma.Decimal("20.0000") }),
      account({ accountId: 5n, code: "1130", accountClass: "ASSET", normalBalance: "DEBIT", classification: "OPERATING_WORKING_CAPITAL", openingSigned: new Prisma.Decimal("50.0000"), closingSigned: new Prisma.Decimal("70.0000") }),
      account({ accountId: 6n, code: "2110", accountClass: "LIABILITY", normalBalance: "CREDIT", classification: "OPERATING_WORKING_CAPITAL", openingSigned: new Prisma.Decimal("-30.0000"), closingSigned: new Prisma.Decimal("-40.0000") }),
      account({ accountId: 7n, code: "1210", accountClass: "ASSET", normalBalance: "DEBIT", classification: "INVESTING", openingSigned: new Prisma.Decimal("0.0000"), closingSigned: new Prisma.Decimal("40.0000") }),
      account({ accountId: 8n, code: "2210", accountClass: "LIABILITY", normalBalance: "CREDIT", classification: "FINANCING", openingSigned: new Prisma.Decimal("-80.0000"), closingSigned: new Prisma.Decimal("-60.0000") }),
    ]);
    expect(report.sections.operating).toMatchObject({ netIncome: "80.0000", adjustmentsTotal: "20.0000", workingCapitalTotal: "-10.0000", total: "90.0000" });
    expect(report.sections.investing.total).toBe("-40.0000");
    expect(report.sections.financing.total).toBe("-20.0000");
    expect(report.cash).toEqual({ opening: "100.0000", netChange: "30.0000", closing: "130.0000", calculatedNetChange: "30.0000", calculatedClosing: "130.0000", difference: "0.0000", reconciled: true });
  });

  it("fails reconciliation safely when a moved balance-sheet account is unmapped", () => {
    const report = calculateIndirectCashFlow([
      account({ accountId: 1n, code: "1110", accountClass: "ASSET", normalBalance: "DEBIT", classification: "CASH_AND_CASH_EQUIVALENTS", closingSigned: new Prisma.Decimal("25.0000") }),
      account({ accountId: 2n, code: "1990", accountClass: "ASSET", normalBalance: "DEBIT", classification: null, closingSigned: new Prisma.Decimal("25.0000"), mappingSource: "UNMAPPED" }),
    ]);
    expect(report.mapping.complete).toBe(false);
    expect(report.mapping.unmappedAccounts).toEqual([expect.objectContaining({ accountId: "2", change: "25.0000" })]);
    expect(report.cash.reconciled).toBe(false);
  });

  it("uses controlled template mappings and keeps ordinary income accounts in net income", () => {
    expect(defaultCashFlowClassification("receivables", "ASSET")).toBe("OPERATING_WORKING_CAPITAL");
    expect(defaultCashFlowClassification("equipment", "ASSET")).toBe("INVESTING");
    expect(defaultCashFlowClassification("depreciation-expense", "EXPENSE")).toBe("OPERATING_ADJUSTMENT");
    expect(defaultCashFlowClassification(null, "REVENUE")).toBe("NET_INCOME");
    expect(defaultCashFlowClassification(null, "ASSET")).toBeNull();
  });
});
