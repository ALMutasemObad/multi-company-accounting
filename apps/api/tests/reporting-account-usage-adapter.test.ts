import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ReportingAccountUsageQueryAdapter } from "../src/reports/reporting-account-usage-adapter.js";

describe("ReportingAccountUsageQueryAdapter", () => {
  it("counts the company-scoped CashFlow mapping through the supplied transaction", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const tx = { cashFlowAccountMapping: { count } } as unknown as Prisma.TransactionClient;

    await expect(new ReportingAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([{
      category: "REPORTING_CASH_FLOW_MAPPING",
      count: 1,
      hasImmutableHistory: false,
    }]);
    expect(count).toHaveBeenCalledWith({ where: { companyId: 7n, accountId: 11n } });
  });

  it("returns an explicit zero fact instead of treating absence as an omitted owner result", async () => {
    const tx = {
      cashFlowAccountMapping: { count: vi.fn().mockResolvedValue(0) },
    } as unknown as Prisma.TransactionClient;

    await expect(new ReportingAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([{
      category: "REPORTING_CASH_FLOW_MAPPING",
      count: 0,
      hasImmutableHistory: false,
    }]);
  });
});
