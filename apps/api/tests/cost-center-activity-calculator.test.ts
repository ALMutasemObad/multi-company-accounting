import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateCostCenterActivity } from "../src/reports/cost-center-activity-calculator.js";

const center = (id: bigint, code: string) => ({ id, parentId: null, code, nameAr: `مركز ${code}`, nameEn: `Center ${code}` });
const account = (id: bigint, code: string) => ({ id, code, nameAr: `حساب ${code}`, nameEn: `Account ${code}` });

describe("cost-center activity calculation", () => {
  it("groups duplicate account rows with Decimal precision and produces period totals", () => {
    const report = calculateCostCenterActivity({
      company: { name: "شركة الاختبار" },
      baseCurrency: { id: 1n, code: "SAR", nameAr: "ريال سعودي", decimals: 2 },
      rows: [
        { costCenter: center(2n, "CC-2"), account: account(20n, "5200"), movementLineCount: 1, debit: new Prisma.Decimal("12.3456"), credit: new Prisma.Decimal("0") },
        { costCenter: center(1n, "CC-1"), account: account(10n, "5100"), movementLineCount: 1, debit: new Prisma.Decimal("0.1"), credit: new Prisma.Decimal("0") },
        { costCenter: center(1n, "CC-1"), account: account(10n, "5100"), movementLineCount: 2, debit: new Prisma.Decimal("0.2"), credit: new Prisma.Decimal("0.05") },
      ],
    }, { dateFrom: "2059-01-01", dateTo: "2059-01-31" });

    expect(report.data.map((row) => row.costCenter.code)).toEqual(["CC-1", "CC-2"]);
    expect(report.data[0]).toMatchObject({
      accounts: [{ movementLineCount: 3, debit: "0.3000", credit: "0.0500", net: "0.2500" }],
      totals: { movementLineCount: 3, debit: "0.3000", credit: "0.0500", net: "0.2500" },
    });
    expect(report.totals).toEqual({
      costCenterCount: 2,
      accountCount: 2,
      movementLineCount: 4,
      debit: "12.6456",
      credit: "0.0500",
      net: "12.5956",
    });
  });

  it("preserves the selected company-scoped cost-center filter in the result", () => {
    const report = calculateCostCenterActivity({
      company: { name: "شركة الاختبار" },
      baseCurrency: { id: 1n, code: "SAR", nameAr: "ريال سعودي", decimals: 2 },
      rows: [],
    }, { dateFrom: "2059-02-01", dateTo: "2059-02-28", costCenterId: 99n });
    expect(report.filter).toEqual({ costCenterId: "99", basis: "POSTED_LEDGER" });
    expect(report.totals).toMatchObject({ debit: "0.0000", credit: "0.0000", net: "0.0000" });
  });
});
