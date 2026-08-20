import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { monthlyCashFlow } from "../src/reports/report-service.js";

describe("financial report calculations", () => {
  it("groups cash movements by month and calculates net flow", () => {
    const result = monthlyCashFlow(
      [
        { documentDate: new Date("2026-01-05T00:00:00.000Z"), baseAmount: new Prisma.Decimal("120.5000") },
        { documentDate: new Date("2026-01-20T00:00:00.000Z"), baseAmount: new Prisma.Decimal("29.5000") },
        { documentDate: new Date("2026-01-25T00:00:00.000Z"), baseAmount: new Prisma.Decimal("-20.0000") },
        { documentDate: new Date("2026-02-01T00:00:00.000Z"), baseAmount: new Prisma.Decimal("80.0000") },
      ],
      [
        { documentDate: new Date("2026-01-10T00:00:00.000Z"), baseAmount: new Prisma.Decimal("45.0000") },
        { documentDate: new Date("2026-03-01T00:00:00.000Z"), baseAmount: new Prisma.Decimal("10.0000") },
      ],
    );
    expect(result).toEqual([
      { month: "2026-01", receipts: "130.0000", payments: "45.0000", net: "85.0000" },
      { month: "2026-02", receipts: "80.0000", payments: "0.0000", net: "80.0000" },
      { month: "2026-03", receipts: "0.0000", payments: "10.0000", net: "-10.0000" },
    ]);
  });
});
