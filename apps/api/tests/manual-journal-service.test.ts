import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AccountReferenceLockPort } from "../src/accounts/account-reference-lock-port.js";
import {
  ManualJournalService,
  type JournalCreateInput,
} from "../src/journals/manual-journal-service.js";

const context = { companyId: 7n, userId: 4n };
const openPeriod = {
  id: 2n,
  companyId: 7n,
  fiscalYearId: 1n,
  status: "OPEN",
  startDate: new Date("2050-01-01T00:00:00.000Z"),
  endDate: new Date("2050-12-31T00:00:00.000Z"),
};
const createInput: JournalCreateInput = {
  fiscalPeriodId: 2n,
  documentDate: "2050-06-01",
  description: "manual journal",
  entries: [{
    entryNumber: 1,
    entryDate: "2050-06-01",
    description: "entry",
    lines: [{
      lineNumber: 1,
      accountId: 9n,
      currencyId: 1n,
      exchangeRate: "1",
      debitAmount: "10",
      creditAmount: "0",
    }, {
      lineNumber: 2,
      accountId: 3n,
      currencyId: 1n,
      exchangeRate: "1",
      debitAmount: "0",
      creditAmount: "10",
    }],
  }],
};

const eligibleLocks = () => {
  const lockPostingAccount = vi.fn(async (
    _tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ) => ({ eligible: true as const, companyId, accountId }));
  return { lockPostingAccount } satisfies AccountReferenceLockPort;
};

const preparedQueries = {
  companyCurrency: { findFirst: vi.fn().mockResolvedValue({ currencyId: 1n }) },
  company: { findUniqueOrThrow: vi.fn().mockResolvedValue({ baseCurrencyId: 1n }) },
  costCenter: { findFirst: vi.fn() },
};

const currentDocument = (overrides: Record<string, unknown> = {}) => ({
  id: 8n,
  companyId: 7n,
  fiscalPeriodId: 2n,
  documentType: "MANUAL_JOURNAL",
  documentNumber: "JV-1",
  documentDate: new Date("2050-06-01T00:00:00.000Z"),
  description: "manual journal",
  status: "DRAFT",
  createdBy: 4n,
  postedBy: null,
  postedAt: null,
  reversedByDocumentId: null,
  version: 0,
  createdAt: new Date("2050-06-01T00:00:00.000Z"),
  updatedAt: new Date("2050-06-01T00:00:00.000Z"),
  journalEntries: [{
    id: 20n,
    companyId: 7n,
    accountingDocumentId: 8n,
    entryNumber: 1,
    entryDate: new Date("2050-06-01T00:00:00.000Z"),
    description: "old entry",
    reversalOfJournalEntryId: null,
    lines: [
      { id: 31n, accountId: 7n },
      { id: 32n, accountId: 9n },
    ],
  }],
  ...overrides,
});

function updateFixture(document = currentDocument(), changedCount = 1) {
  const queryRaw = vi.fn()
    .mockResolvedValueOnce([{ id: 2n }])
    .mockResolvedValueOnce([{ id: 8n }])
    .mockResolvedValueOnce([{ id: 31n }, { id: 32n }]);
  const accountingDocument = {
    findFirst: vi.fn()
      .mockResolvedValueOnce({ fiscalPeriodId: 2n })
      .mockResolvedValueOnce(document),
    updateMany: vi.fn().mockResolvedValue({ count: changedCount }),
    findUniqueOrThrow: vi.fn().mockResolvedValue(document),
  };
  const tx = {
    $queryRaw: queryRaw,
    accountingDocument,
    fiscalPeriod: { findFirst: vi.fn().mockResolvedValue(openPeriod) },
    journalLine: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    journalEntry: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 21n }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 90n }) },
    ...preparedQueries,
  };
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaClient;
  return { tx, prisma, accountingDocument, queryRaw };
}

describe("ManualJournal account writer protocol", () => {
  it("creates in Period -> Sequence -> sorted Account -> document order on one transaction", async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ id: 2n }])
      .mockResolvedValueOnce([{ value: 2n }]);
    const accountingDocumentCreate = vi.fn().mockResolvedValue({ id: 8n });
    const tx = {
      $queryRaw: queryRaw,
      $executeRaw: vi.fn().mockResolvedValue(1),
      fiscalPeriod: { findFirst: vi.fn().mockResolvedValue(openPeriod) },
      fiscalYear: { findFirst: vi.fn().mockResolvedValue({
        id: 1n,
        startDate: new Date("2050-01-01T00:00:00.000Z"),
        endDate: new Date("2050-12-31T00:00:00.000Z"),
      }) },
      documentSequence: { upsert: vi.fn().mockResolvedValue({ id: 6n, padding: 6 }) },
      accountingDocument: { create: accountingDocumentCreate },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 90n }) },
      ...preparedQueries,
    };
    const prisma = {
      fiscalPeriod: { findFirst: vi.fn().mockResolvedValue(openPeriod) },
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient;
    const accountReferences = eligibleLocks();

    await new ManualJournalService(prisma, accountReferences).create(context, createInput);

    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.documentSequence.upsert.mock.invocationCallOrder[0]!);
    expect(queryRaw.mock.invocationCallOrder[1]).toBeLessThan(accountReferences.lockPostingAccount.mock.invocationCallOrder[0]!);
    expect(accountReferences.lockPostingAccount.mock.calls).toEqual([
      [tx, 7n, 3n],
      [tx, 7n, 9n],
    ]);
    expect(accountReferences.lockPostingAccount.mock.invocationCallOrder.at(-1)!)
      .toBeLessThan(accountingDocumentCreate.mock.invocationCallOrder[0]!);
  });

  it("updates in Period -> Document -> re-read -> sorted old/new Accounts -> current Lines -> CAS order", async () => {
    const { tx, prisma, accountingDocument, queryRaw } = updateFixture();
    const accountReferences = eligibleLocks();
    const service = new ManualJournalService(prisma, accountReferences);

    await service.update(context, 8n, {
      version: 0,
      entries: [{
        ...createInput.entries[0]!,
        lines: [
          { ...createInput.entries[0]!.lines[0]!, accountId: 7n },
          { ...createInput.entries[0]!.lines[1]!, accountId: 3n },
        ],
      }],
    });

    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(queryRaw.mock.invocationCallOrder[1]!);
    expect(queryRaw.mock.invocationCallOrder[1]).toBeLessThan(accountingDocument.findFirst.mock.invocationCallOrder[1]!);
    expect(accountReferences.lockPostingAccount.mock.calls).toEqual([
      [tx, 7n, 3n],
      [tx, 7n, 7n],
      [tx, 7n, 9n],
    ]);
    expect(accountingDocument.findFirst.mock.invocationCallOrder[1]!)
      .toBeLessThan(accountReferences.lockPostingAccount.mock.invocationCallOrder[0]!);
    expect(accountReferences.lockPostingAccount.mock.invocationCallOrder.at(-1)!)
      .toBeLessThan(queryRaw.mock.invocationCallOrder[2]!);
    expect(queryRaw.mock.invocationCallOrder[2])
      .toBeLessThan(accountingDocument.updateMany.mock.invocationCallOrder[0]!);
    expect(accountingDocument.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.journalLine.deleteMany.mock.invocationCallOrder[0]!);
  });

  it("fails closed for cross-company or ineligible accounts and locks no later account", async () => {
    const tx = { marker: "same transaction" } as unknown as Prisma.TransactionClient;
    for (const reason of ["NOT_FOUND", "INACTIVE", "NON_POSTING", "HAS_CHILDREN"] as const) {
      const lockPostingAccount = vi.fn()
        .mockResolvedValueOnce({ eligible: false as const, reason });
      const service = new ManualJournalService({} as PrismaClient, { lockPostingAccount });
      const writer = service as unknown as {
        lockAndValidatePostingAccounts(
          client: Prisma.TransactionClient,
          companyId: bigint,
          accountIds: bigint[],
        ): Promise<bigint[]>;
      };

      await expect(writer.lockAndValidatePostingAccounts(tx, 7n, [9n, 3n, 9n]))
        .rejects.toMatchObject({ reason: "INVALID_ACCOUNT" });
      expect(lockPostingAccount).toHaveBeenCalledTimes(1);
      expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 3n);
    }
  });

  it("rejects a stale or posted snapshot after the document lock and before account locks", async () => {
    for (const [document, expected] of [
      [currentDocument({ version: 2 }), "VERSION_CONFLICT"],
      [currentDocument({ status: "POSTED" }), "INVALID_STATE"],
    ] as const) {
      const { prisma } = updateFixture(document);
      const accountReferences = eligibleLocks();
      const service = new ManualJournalService(prisma, accountReferences);

      await expect(service.update(context, 8n, { version: 0, entries: createInput.entries }))
        .rejects.toMatchObject({ reason: expected });
      expect(accountReferences.lockPostingAccount).not.toHaveBeenCalled();
    }
  });

  it("does not partially replace lines when the document CAS loses", async () => {
    const { tx, prisma } = updateFixture(currentDocument(), 0);
    const service = new ManualJournalService(prisma, eligibleLocks());

    await expect(service.update(context, 8n, { version: 0, entries: createInput.entries }))
      .rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    expect(tx.journalLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.journalEntry.deleteMany).not.toHaveBeenCalled();
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it("fails before CAS when a concurrent deactivation makes a final account ineligible", async () => {
    const { tx, prisma, accountingDocument } = updateFixture();
    const lockPostingAccount = vi.fn()
      .mockResolvedValueOnce({ eligible: false as const, reason: "INACTIVE" as const });

    await expect(new ManualJournalService(prisma, { lockPostingAccount }).update(
      context,
      8n,
      { version: 0, entries: createInput.entries },
    )).rejects.toMatchObject({ reason: "INVALID_ACCOUNT" });

    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 3n);
    expect(accountingDocument.updateMany).not.toHaveBeenCalled();
    expect(tx.journalLine.deleteMany).not.toHaveBeenCalled();
  });

  it("fails a period-close race before taking the document or account locks", async () => {
    const { prisma, queryRaw } = updateFixture();
    queryRaw.mockReset().mockResolvedValueOnce([]);
    const accountReferences = eligibleLocks();

    await expect(new ManualJournalService(prisma, accountReferences).update(
      context,
      8n,
      { version: 0, entries: createInput.entries },
    )).rejects.toMatchObject({ reason: "PERIOD_CLOSED" });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(accountReferences.lockPostingAccount).not.toHaveBeenCalled();
  });

  it("locks and re-reads the document before cancelling a draft", async () => {
    const document = currentDocument();
    const queryRaw = vi.fn().mockResolvedValue([{ id: 8n }]);
    const findFirst = vi.fn().mockResolvedValue(document);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: queryRaw,
      accountingDocument: {
        findFirst,
        updateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...document, status: "CANCELLED" }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 90n }) },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient;

    await new ManualJournalService(prisma, eligibleLocks()).cancel(
      context,
      8n,
      0,
      "cancel",
    );

    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(findFirst.mock.invocationCallOrder[0]!);
    expect(findFirst.mock.invocationCallOrder[0]).toBeLessThan(updateMany.mock.invocationCallOrder[0]!);
  });

  it("does not lock accounts or lines for a metadata-only update", async () => {
    const { tx, prisma, queryRaw } = updateFixture();
    const accountReferences = eligibleLocks();

    await new ManualJournalService(prisma, accountReferences).update(context, 8n, {
      version: 0,
      description: "metadata only",
    });

    expect(accountReferences.lockPostingAccount).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.journalLine.deleteMany).not.toHaveBeenCalled();
  });
});
