import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TreasuryAccountUsageQueryAdapter } from "../src/treasury/treasury-account-usage-query-adapter.js";

describe("TreasuryAccountUsageQueryAdapter", () => {
  it("returns bounded Treasury facts in deterministic order and counts all documents", async () => {
    const cashCount = vi.fn().mockResolvedValue(2);
    const receiptCount = vi.fn().mockResolvedValue(3);
    const paymentCount = vi.fn().mockResolvedValue(4);
    const receiptFindFirst = vi.fn().mockResolvedValue(null);
    const paymentFindFirst = vi.fn().mockResolvedValue({ id: 99n });
    const tx = {
      cashBankAccount: { count: cashCount },
      receipt: { count: receiptCount, findFirst: receiptFindFirst },
      payment: { count: paymentCount, findFirst: paymentFindFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(new TreasuryAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "TREASURY_CASH_BANK_ACCOUNT", count: 2, hasImmutableHistory: false },
      { category: "TREASURY_DOCUMENT_HISTORY", count: 7, hasImmutableHistory: true },
    ]);
    expect(cashCount).toHaveBeenCalledWith({ where: { companyId: 7n, ledgerAccountId: 11n } });
    expect(receiptCount).toHaveBeenCalledWith({
      where: {
        companyId: 7n,
        counterAccountId: 11n,
        accountingDocument: { companyId: 7n, documentType: "RECEIPT" },
      },
    });
    expect(paymentCount).toHaveBeenCalledWith({
      where: {
        companyId: 7n,
        counterAccountId: 11n,
        accountingDocument: { companyId: 7n, documentType: "PAYMENT" },
      },
    });
    for (const findFirst of [receiptFindFirst, paymentFindFirst]) {
      expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          companyId: 7n,
          counterAccountId: 11n,
          accountingDocument: expect.objectContaining({
            companyId: 7n,
            status: { in: ["POSTED", "REVERSED", "CANCELLED"] },
          }),
        }),
        select: { id: true },
      }));
    }
    expect(receiptFindFirst.mock.calls[0]?.[0].where.accountingDocument.documentType).toBe("RECEIPT");
    expect(paymentFindFirst.mock.calls[0]?.[0].where.accountingDocument.documentType).toBe("PAYMENT");
  });

  it("keeps draft-only use mutable and isolates every lookup to the requested company", async () => {
    const cashCount = vi.fn().mockResolvedValue(0);
    const receiptCount = vi.fn().mockResolvedValue(1);
    const paymentCount = vi.fn().mockResolvedValue(0);
    const receiptFindFirst = vi.fn().mockResolvedValue(null);
    const paymentFindFirst = vi.fn().mockResolvedValue(null);
    const tx = {
      cashBankAccount: { count: cashCount },
      receipt: { count: receiptCount, findFirst: receiptFindFirst },
      payment: { count: paymentCount, findFirst: paymentFindFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(new TreasuryAccountUsageQueryAdapter().queryAccountUsage(tx, 88n, 11n)).resolves.toEqual([
      { category: "TREASURY_CASH_BANK_ACCOUNT", count: 0, hasImmutableHistory: false },
      { category: "TREASURY_DOCUMENT_HISTORY", count: 1, hasImmutableHistory: false },
    ]);
    for (const query of [cashCount, receiptCount, paymentCount, receiptFindFirst, paymentFindFirst]) {
      expect(query.mock.calls[0]?.[0]).toMatchObject({ where: { companyId: 88n } });
    }
  });
});
