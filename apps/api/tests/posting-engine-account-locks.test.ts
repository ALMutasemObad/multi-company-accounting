import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  lockPostingAccounts,
  PostingEngine,
  type PostingEntryPlan,
} from "../src/core-accounting/posting-engine.js";

const period = {
  id: 2n,
  companyId: 7n,
  fiscalYearId: 1n,
  periodNumber: 1,
  startDate: new Date("2050-01-01T00:00:00.000Z"),
  endDate: new Date("2050-12-31T00:00:00.000Z"),
  status: "OPEN",
  closedAt: null,
  closedBy: null,
};

const document = {
  id: 8n,
  companyId: 7n,
  fiscalPeriodId: 2n,
  documentType: "MANUAL_JOURNAL",
  documentNumber: "JV-1",
  documentDate: new Date("2050-06-01T00:00:00.000Z"),
  description: "posting",
  status: "DRAFT",
  createdBy: 4n,
  postedBy: null,
  postedAt: null,
  reversedByDocumentId: null,
  version: 0,
  createdAt: new Date("2050-06-01T00:00:00.000Z"),
  updatedAt: new Date("2050-06-01T00:00:00.000Z"),
};

const plan = (): PostingEntryPlan[] => [{
  entryNumber: 1,
  entryDate: new Date(document.documentDate.getTime()),
  description: "posting",
  lines: [
    {
      lineNumber: 1,
      accountId: 9n,
      currencyId: 1n,
      exchangeRate: 1,
      debitAmount: 10,
      creditAmount: 0,
      baseDebitAmount: 10,
      baseCreditAmount: 0,
    },
    {
      lineNumber: 2,
      accountId: 3n,
      currencyId: 1n,
      exchangeRate: 1,
      debitAmount: 0,
      creditAmount: 10,
      baseDebitAmount: 0,
      baseCreditAmount: 10,
    },
  ],
}];

const failure = (reason: string) => Object.assign(new Error(reason), { reason });

function postingTransaction(accountLockRows: Array<{ id: bigint }> = [{ id: 3n }, { id: 9n }]) {
  const queryRaw = vi.fn()
    .mockResolvedValueOnce([{ id: 2n }])
    .mockResolvedValueOnce([{ id: 8n }])
    .mockResolvedValueOnce(accountLockRows);
  const journalCreate = vi.fn().mockResolvedValue({ id: 50n, lines: [] });
  return {
    $queryRaw: queryRaw,
    fiscalPeriod: { findFirst: vi.fn().mockResolvedValue(period) },
    accountingDocument: {
      findFirst: vi.fn()
        .mockResolvedValueOnce({ fiscalPeriodId: 2n })
        .mockResolvedValueOnce(document),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...document, status: "POSTED", version: 1 }),
      create: vi.fn(),
    },
    journalEntry: {
      create: journalCreate,
      findMany: vi.fn(),
    },
    account: {
      findMany: vi.fn().mockResolvedValue([
        { id: 3n, isActive: true, allowsPosting: true, _count: { children: 0 } },
        { id: 9n, isActive: true, allowsPosting: true, _count: { children: 0 } },
      ]),
    },
    costCenter: { count: vi.fn() },
    companyCurrency: { findMany: vi.fn().mockResolvedValue([{ currencyId: 1n }]) },
    company: { findUniqueOrThrow: vi.fn().mockResolvedValue({ baseCurrencyId: 1n }) },
    customer: { count: vi.fn() },
    supplier: { count: vi.fn() },
  };
}

describe("PostingEngine centralized account locks", () => {
  it("deduplicates and locks account ids in numeric order with company isolation", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: 3n }, { id: 5n }, { id: 9n }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    await expect(lockPostingAccounts(tx, 7n, [9n, 3n, 9n, 5n], failure)).resolves.toEqual([3n, 5n, 9n]);
    const query = queryRaw.mock.calls[0]![0] as Prisma.Sql;
    expect(query.values).toEqual([7n, 3n, 5n, 9n]);
    expect(query.sql).toMatch(/ORDER BY id\s+FOR UPDATE/u);
  });

  it("postPlan locks the final set after beforeLedger and validates before the post-lock hook and writes", async () => {
    const tx = postingTransaction();
    const entries = plan();
    const beforeLedger = vi.fn().mockResolvedValue(entries);
    const afterAccountLocks = vi.fn();

    await new PostingEngine().postPlan(tx as unknown as Prisma.TransactionClient, {
      companyId: 7n,
      documentId: 8n,
      expectedVersion: 0,
      actorUserId: 4n,
      entries: [],
      beforeLedger,
      afterAccountLocks,
      error: failure,
    });

    const accountLockOrder = tx.$queryRaw.mock.invocationCallOrder[2]!;
    expect(beforeLedger.mock.invocationCallOrder[0]).toBeLessThan(accountLockOrder);
    expect(accountLockOrder).toBeLessThan(tx.account.findMany.mock.invocationCallOrder[0]!);
    expect(tx.account.findMany.mock.invocationCallOrder[0]).toBeLessThan(afterAccountLocks.mock.invocationCallOrder[0]!);
    expect(afterAccountLocks.mock.invocationCallOrder[0]).toBeLessThan(tx.journalEntry.create.mock.invocationCallOrder[0]!);
    expect(beforeLedger).toHaveBeenCalledWith(tx, document);
    expect(afterAccountLocks).toHaveBeenCalledWith(tx, document);
  });

  it("writes only the validated engine snapshot when the post-lock hook mutates the source plan", async () => {
    const tx = postingTransaction();
    const entries = plan();

    await new PostingEngine().postPlan(tx as unknown as Prisma.TransactionClient, {
      companyId: 7n,
      documentId: 8n,
      expectedVersion: 0,
      actorUserId: 4n,
      entries,
      afterAccountLocks: async () => {
        entries[0]!.entryDate.setUTCFullYear(2060);
        entries[0]!.lines[0]!.lineNumber = 99;
        entries[0]!.lines[0]!.baseDebitAmount = 999;
      },
      error: failure,
    });

    const written = tx.journalEntry.create.mock.calls[0]![0].data;
    expect(written.entryDate).toEqual(new Date("2050-06-01T00:00:00.000Z"));
    expect(written.lines.create[0].lineNumber).toBe(1);
    expect(written.lines.create[0].baseDebitAmount.toString()).toBe("10");
    expect(entries[0]!.lines[0]!.accountId).toBe(9n);
  });

  it("postExisting locks account ids before JournalLine locks or validation", async () => {
    const tx = postingTransaction([]);
    tx.journalEntry.findMany.mockResolvedValue([{ id: 20n, ...plan()[0], lines: [
      { id: 31n, ...plan()[0]!.lines[0] },
      { id: 32n, ...plan()[0]!.lines[1] },
    ] }]);
    const beforeLedger = vi.fn();

    await expect(new PostingEngine().postExisting(tx as unknown as Prisma.TransactionClient, {
      companyId: 7n,
      documentId: 8n,
      expectedVersion: 0,
      actorUserId: 4n,
      beforeLedger,
      error: failure,
    })).rejects.toMatchObject({ reason: "INVALID_ACCOUNT" });

    expect(beforeLedger.mock.invocationCallOrder[0]).toBeLessThan(tx.journalEntry.findMany.mock.invocationCallOrder[0]!);
    expect(tx.journalEntry.findMany.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[2]!);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.account.findMany).not.toHaveBeenCalled();
  });

  it("reverse reserves its sequence before the hook and then fails closed on missing accounts", async () => {
    const tx = postingTransaction([]);
    tx.fiscalPeriod.findFirst
      .mockReset()
      .mockResolvedValueOnce(period)
      .mockResolvedValueOnce(period);
    tx.accountingDocument.findFirst
      .mockReset()
      .mockResolvedValueOnce({ ...document, status: "POSTED", version: 3 });
    tx.journalEntry.findMany.mockResolvedValue([{ id: 20n, ...plan()[0], lines: [
      { id: 31n, ...plan()[0]!.lines[0] },
      { id: 32n, ...plan()[0]!.lines[1] },
    ] }]);
    const reserveDocumentNumber = vi.fn().mockResolvedValue("RV-1");
    const beforeLedger = vi.fn();

    await expect(new PostingEngine().reverse(tx as unknown as Prisma.TransactionClient, {
      companyId: 7n,
      documentId: 8n,
      expectedVersion: 3,
      actorUserId: 4n,
      reversalDate: new Date("2050-07-01T00:00:00.000Z"),
      description: () => "reversal",
      reserveDocumentNumber,
      beforeLedger,
      error: failure,
    })).rejects.toMatchObject({ reason: "INVALID_ACCOUNT" });

    expect(reserveDocumentNumber.mock.invocationCallOrder[0]).toBeLessThan(beforeLedger.mock.invocationCallOrder[0]!);
    expect(beforeLedger.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[2]!);
    expect(tx.accountingDocument.create).not.toHaveBeenCalled();
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it("allows same-company inactive historical accounts only in reversal validation", async () => {
    const tx = postingTransaction();
    tx.account.findMany.mockResolvedValue([
      { id: 3n, isActive: false, allowsPosting: true, _count: { children: 0 } },
      { id: 9n, isActive: true, allowsPosting: true, _count: { children: 0 } },
    ]);
    const validator = new PostingEngine() as unknown as {
      validateEntries(
        client: Prisma.TransactionClient,
        companyId: bigint,
        currentPeriod: typeof period,
        entries: PostingEntryPlan[],
        error: typeof failure,
        eligibility?: "CURRENT" | "HISTORICAL",
      ): Promise<void>;
    };

    await expect(validator.validateEntries(
      tx as unknown as Prisma.TransactionClient,
      7n,
      period,
      plan(),
      failure,
      "HISTORICAL",
    )).resolves.toBeUndefined();
    await expect(validator.validateEntries(
      tx as unknown as Prisma.TransactionClient,
      7n,
      period,
      plan(),
      failure,
    )).rejects.toMatchObject({ reason: "INVALID_ACCOUNT" });
  });
});
