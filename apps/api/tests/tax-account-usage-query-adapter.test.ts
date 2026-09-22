import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TaxAccountUsageQueryAdapter } from "../src/tax/tax-account-usage-query-adapter.js";

describe("TaxAccountUsageQueryAdapter", () => {
  it("counts both input and output mappings in one company-scoped fact", async () => {
    const count = vi.fn().mockResolvedValue(4);
    const tx = { taxRate: { count } } as unknown as Prisma.TransactionClient;

    await expect(new TaxAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "TAX_RATE", count: 4, hasImmutableHistory: false },
    ]);
    expect(count).toHaveBeenCalledWith({
      where: {
        companyId: 7n,
        OR: [
          { outputTaxAccountId: 11n },
          { inputTaxAccountId: 11n },
        ],
      },
    });
  });

  it("isolates repeated lookups to the requested company", async () => {
    const count = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const tx = { taxRate: { count } } as unknown as Prisma.TransactionClient;
    const adapter = new TaxAccountUsageQueryAdapter();

    await expect(adapter.queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "TAX_RATE", count: 2, hasImmutableHistory: false },
    ]);
    await expect(adapter.queryAccountUsage(tx, 8n, 11n)).resolves.toEqual([
      { category: "TAX_RATE", count: 0, hasImmutableHistory: false },
    ]);
    expect(count.mock.calls[0]?.[0]).toMatchObject({ where: { companyId: 7n } });
    expect(count.mock.calls[1]?.[0]).toMatchObject({ where: { companyId: 8n } });
  });
});
