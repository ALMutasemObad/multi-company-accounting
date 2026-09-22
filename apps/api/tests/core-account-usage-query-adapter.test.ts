import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CoreAccountUsageQueryAdapter } from "../src/accounts/core-account-usage-query-adapter.js";

describe("CoreAccountUsageQueryAdapter", () => {
  it("returns child then journal facts with company-scoped counts", async () => {
    const accountCount = vi.fn().mockResolvedValue(2);
    const journalCount = vi.fn().mockResolvedValue(3);
    const immutableJournalLine = vi.fn().mockResolvedValue({ id: 31n });
    const tx = {
      account: { count: accountCount },
      journalLine: { count: journalCount, findFirst: immutableJournalLine },
    } as unknown as Prisma.TransactionClient;

    await expect(new CoreAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "CORE_ACCOUNT_CHILD", count: 2, hasImmutableHistory: false },
      { category: "CORE_JOURNAL_HISTORY", count: 3, hasImmutableHistory: true },
    ]);
    expect(accountCount).toHaveBeenCalledWith({ where: { companyId: 7n, parentAccountId: 11n } });
    expect(journalCount).toHaveBeenCalledWith({ where: { companyId: 7n, accountId: 11n } });
    expect(immutableJournalLine).toHaveBeenCalledWith({
      where: {
        companyId: 7n,
        accountId: 11n,
        journalEntry: {
          companyId: 7n,
          accountingDocument: {
            companyId: 7n,
            status: { in: ["POSTED", "REVERSED", "CANCELLED"] },
          },
        },
      },
      select: { id: true },
    });
  });

  it("counts draft lines but keeps DRAFT as the only mutable document status", async () => {
    const tx = {
      account: { count: vi.fn().mockResolvedValue(0) },
      journalLine: {
        count: vi.fn().mockResolvedValue(4),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(new CoreAccountUsageQueryAdapter().queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "CORE_ACCOUNT_CHILD", count: 0, hasImmutableHistory: false },
      { category: "CORE_JOURNAL_HISTORY", count: 4, hasImmutableHistory: false },
    ]);

    expect(tx.journalLine.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        journalEntry: expect.objectContaining({
          accountingDocument: expect.objectContaining({
            status: { in: ["POSTED", "REVERSED", "CANCELLED"] },
          }),
        }),
      }),
    }));
  });

  it("keeps every lookup isolated to the requested company", async () => {
    const accountCount = vi.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const journalCount = vi.fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    const immutableJournalLine = vi.fn()
      .mockResolvedValueOnce({ id: 31n })
      .mockResolvedValueOnce(null);
    const tx = {
      account: { count: accountCount },
      journalLine: { count: journalCount, findFirst: immutableJournalLine },
    } as unknown as Prisma.TransactionClient;
    const adapter = new CoreAccountUsageQueryAdapter();

    await expect(adapter.queryAccountUsage(tx, 7n, 11n)).resolves.toEqual([
      { category: "CORE_ACCOUNT_CHILD", count: 1, hasImmutableHistory: false },
      { category: "CORE_JOURNAL_HISTORY", count: 2, hasImmutableHistory: true },
    ]);
    await expect(adapter.queryAccountUsage(tx, 8n, 11n)).resolves.toEqual([
      { category: "CORE_ACCOUNT_CHILD", count: 0, hasImmutableHistory: false },
      { category: "CORE_JOURNAL_HISTORY", count: 0, hasImmutableHistory: false },
    ]);

    expect(accountCount).toHaveBeenNthCalledWith(1, { where: { companyId: 7n, parentAccountId: 11n } });
    expect(accountCount).toHaveBeenNthCalledWith(2, { where: { companyId: 8n, parentAccountId: 11n } });
    for (const [index, companyId] of [[1, 7n], [2, 8n]] as const) {
      expect(journalCount.mock.calls[index - 1]?.[0]).toMatchObject({ where: { companyId, accountId: 11n } });
      expect(immutableJournalLine.mock.calls[index - 1]?.[0]).toMatchObject({
        where: {
          companyId,
          accountId: 11n,
          journalEntry: { companyId, accountingDocument: { companyId } },
        },
      });
    }
  });
});
