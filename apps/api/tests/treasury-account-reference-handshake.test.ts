import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PaymentService, type PaymentInput } from "../src/payments/payment-service.js";
import { ReceiptService, type ReceiptInput } from "../src/receipts/receipt-service.js";

const directCounterpartyInput = {
  fiscalPeriodId: 1n,
  documentDate: "2050-01-01",
  description: "direct settlement",
  counterAccountId: 9n,
  cashBankAccountId: 2n,
  paymentMethodId: 3n,
  currencyId: 4n,
  exchangeRate: "1",
  amount: "10",
  counterpartyName: "طرف مباشر",
  allocations: [],
};

const transaction = () => ({
  account: {
    findFirst: vi.fn().mockResolvedValue({
      id: 9n,
      companyId: 7n,
      isActive: true,
      allowsPosting: true,
      _count: { children: 0 },
    }),
  },
  company: { findUniqueOrThrow: vi.fn().mockResolvedValue({ baseCurrencyId: 4n }) },
  companyCurrency: { findFirst: vi.fn().mockResolvedValue({ companyId: 7n, currencyId: 4n }) },
});

describe("Treasury document account reference writer handshake", () => {
  it("reserves a POS receipt after locking its period and consumes it without a second sequence reservation", async () => {
    const periodFindFirst = vi.fn().mockResolvedValue({
      id: 1n,
      fiscalYearId: 2n,
      status: "OPEN",
      startDate: new Date("2050-01-01T00:00:00.000Z"),
      endDate: new Date("2050-12-31T00:00:00.000Z"),
    });
    const periodLock = vi.fn().mockResolvedValue([{ id: 1n }]);
    const tx = {
      fiscalPeriod: { findFirst: periodFindFirst },
      $queryRaw: periodLock,
    } as unknown as Prisma.TransactionClient;
    const service = new ReceiptService({} as PrismaClient, {
      treasury: {} as never,
      fxAccounts: {} as never,
      receivables: {} as never,
      accountReferences: {} as never,
    });
    const reserveInTransaction = vi.fn().mockResolvedValue("REC-2050-000001");
    const createDraftInTransaction = vi.fn().mockResolvedValue({ id: 61n });
    const postInTransaction = vi.fn().mockResolvedValue({
      document: { id: 51n, documentNumber: "REC-2050-000001", status: "POSTED" },
      ids: ["71"],
    });
    const audit = vi.fn();
    const writer = service as unknown as {
      reserveInTransaction: typeof reserveInTransaction;
      createDraftInTransaction: typeof createDraftInTransaction;
      postInTransaction: typeof postInTransaction;
      audit: typeof audit;
    };
    writer.reserveInTransaction = reserveInTransaction;
    writer.createDraftInTransaction = createDraftInTransaction;
    writer.postInTransaction = postInTransaction;
    writer.audit = audit;

    const reservation = await service.reserveCaptureInTransaction(
      tx,
      { companyId: 7n, userId: 4n },
      1n,
      "2050-01-01",
    );
    expect(periodLock.mock.invocationCallOrder[0]).toBeLessThan(periodFindFirst.mock.invocationCallOrder[0]!);
    expect(periodFindFirst.mock.invocationCallOrder[0]).toBeLessThan(reserveInTransaction.mock.invocationCallOrder[0]!);
    reserveInTransaction.mockClear();

    await service.captureInTransaction(
      tx,
      { companyId: 7n, userId: 4n },
      directCounterpartyInput,
      reservation,
    );

    expect(reserveInTransaction).not.toHaveBeenCalled();
    expect(createDraftInTransaction).toHaveBeenCalledWith(
      tx,
      { companyId: 7n, userId: 4n },
      directCounterpartyInput,
      "REC-2050-000001",
    );
  });

  it("rejects a missing or mismatched POS receipt reservation before draft creation", async () => {
    const tx = {
      fiscalPeriod: { findFirst: vi.fn().mockResolvedValue({
        id: 1n,
        fiscalYearId: 2n,
        status: "OPEN",
        startDate: new Date("2050-01-01T00:00:00.000Z"),
        endDate: new Date("2050-12-31T00:00:00.000Z"),
      }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 1n }]),
    } as unknown as Prisma.TransactionClient;
    const service = new ReceiptService({} as PrismaClient, {
      treasury: {} as never,
      fxAccounts: {} as never,
      receivables: {} as never,
      accountReferences: {} as never,
    });
    const writer = service as unknown as {
      reserveInTransaction: ReturnType<typeof vi.fn>;
      createDraftInTransaction: ReturnType<typeof vi.fn>;
    };
    writer.reserveInTransaction = vi.fn().mockResolvedValue("REC-2050-000001");
    writer.createDraftInTransaction = vi.fn();
    const reservation = await service.reserveCaptureInTransaction(
      tx,
      { companyId: 7n, userId: 4n },
      1n,
      "2050-01-01",
    );

    await expect(service.captureInTransaction(
      tx,
      { companyId: 8n, userId: 4n },
      directCounterpartyInput,
      reservation,
    )).rejects.toMatchObject({ reason: "INVALID_STATE" });
    await expect(service.captureInTransaction(
      tx,
      { companyId: 7n, userId: 4n },
      { ...directCounterpartyInput, documentDate: "2050-01-02" },
      reservation,
    )).rejects.toMatchObject({ reason: "INVALID_STATE" });
    await expect(service.captureInTransaction(
      tx,
      { companyId: 7n, userId: 4n },
      directCounterpartyInput,
      {} as never,
    )).rejects.toMatchObject({ reason: "INVALID_STATE" });
    expect(writer.createDraftInTransaction).not.toHaveBeenCalled();
  });

  it("locks a Receipt direct counter on the command transaction before document writes", async () => {
    const tx = {
      ...transaction(),
      fiscalPeriod: { findFirst: vi.fn().mockResolvedValue({
        id: 1n,
        fiscalYearId: 2n,
        status: "OPEN",
        startDate: new Date("2050-01-01T00:00:00.000Z"),
        endDate: new Date("2050-12-31T00:00:00.000Z"),
      }) },
      accountingDocument: { create: vi.fn().mockResolvedValue({ id: 51n }) },
      receipt: { create: vi.fn().mockResolvedValue({ id: 61n }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 71n }) },
    };
    const prisma = {
      fiscalPeriod: { findFirst: tx.fiscalPeriod.findFirst },
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient;
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: true, companyId: 7n, accountId: 9n });
    const service = new ReceiptService(prisma, {
      treasury: { resolveInstrument: vi.fn().mockResolvedValue({ cashBankLedgerAccountId: 20n }) },
      fxAccounts: {} as never,
      receivables: { validateDraftTargets: vi.fn() } as never,
      accountReferences: { lockPostingAccount },
    });
    (service as unknown as { fiscal: { reserveDocumentNumber: () => Promise<string> } }).fiscal = {
      reserveDocumentNumber: vi.fn().mockResolvedValue("REC-2050-000001"),
    };

    await service.create({ companyId: 7n, userId: 4n }, directCounterpartyInput);

    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 9n);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(tx.accountingDocument.create.mock.invocationCallOrder[0]!);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(tx.receipt.create.mock.invocationCallOrder[0]!);
  });

  it("locks a Payment direct counter on the command transaction before document writes", async () => {
    const tx = {
      ...transaction(),
      fiscalPeriod: { findFirst: vi.fn().mockResolvedValue({
        id: 1n,
        fiscalYearId: 2n,
        status: "OPEN",
        startDate: new Date("2050-01-01T00:00:00.000Z"),
        endDate: new Date("2050-12-31T00:00:00.000Z"),
      }) },
      accountingDocument: { create: vi.fn().mockResolvedValue({ id: 51n }) },
      payment: { create: vi.fn().mockResolvedValue({ id: 61n }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 71n }) },
    };
    const prisma = {
      fiscalPeriod: { findFirst: tx.fiscalPeriod.findFirst },
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient;
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: true, companyId: 7n, accountId: 9n });
    const service = new PaymentService(prisma, {
      treasury: { resolveInstrument: vi.fn().mockResolvedValue({ cashBankLedgerAccountId: 20n }) },
      fxAccounts: {} as never,
      payables: { validateDraftTargets: vi.fn() } as never,
      accountReferences: { lockPostingAccount },
    });
    (service as unknown as { fiscal: { reserveDocumentNumber: () => Promise<string> } }).fiscal = {
      reserveDocumentNumber: vi.fn().mockResolvedValue("PAY-2050-000001"),
    };

    await service.create({ companyId: 7n, userId: 4n }, directCounterpartyInput);

    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 9n);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(tx.accountingDocument.create.mock.invocationCallOrder[0]!);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(tx.payment.create.mock.invocationCallOrder[0]!);
  });

  it("locks a Receipt direct counter account on the same transaction before validation", async () => {
    const tx = transaction();
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: true, companyId: 7n, accountId: 9n });
    const service = new ReceiptService({} as PrismaClient, {
      treasury: { resolveInstrument: vi.fn().mockResolvedValue({ cashBankLedgerAccountId: 20n }) },
      fxAccounts: {} as never,
      receivables: { validateDraftTargets: vi.fn() } as never,
      accountReferences: { lockPostingAccount },
    });
    const writer = service as unknown as {
      prepare(client: Prisma.TransactionClient, companyId: bigint, input: ReceiptInput, lock?: boolean): Promise<unknown>;
    };

    await writer.prepare(tx as unknown as Prisma.TransactionClient, 7n, directCounterpartyInput, true);

    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 9n);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(tx.account.findFirst.mock.invocationCallOrder[0]!);

    lockPostingAccount.mockClear();
    await writer.prepare(tx as unknown as Prisma.TransactionClient, 7n, directCounterpartyInput, false);
    expect(lockPostingAccount).not.toHaveBeenCalled();
  });

  it("locks a Payment direct counter account on the same transaction before validation", async () => {
    const tx = transaction();
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: true, companyId: 7n, accountId: 9n });
    const service = new PaymentService({} as PrismaClient, {
      treasury: { resolveInstrument: vi.fn().mockResolvedValue({ cashBankLedgerAccountId: 20n }) },
      fxAccounts: {} as never,
      payables: { validateDraftTargets: vi.fn() } as never,
      accountReferences: { lockPostingAccount },
    });
    const writer = service as unknown as {
      prepare(client: Prisma.TransactionClient, companyId: bigint, input: PaymentInput, lock?: boolean): Promise<unknown>;
    };

    await writer.prepare(tx as unknown as Prisma.TransactionClient, 7n, directCounterpartyInput, true);

    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 9n);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(tx.account.findFirst.mock.invocationCallOrder[0]!);

    lockPostingAccount.mockClear();
    await writer.prepare(tx as unknown as Prisma.TransactionClient, 7n, directCounterpartyInput, false);
    expect(lockPostingAccount).not.toHaveBeenCalled();
  });

  it.each([
    ["Receipt", ReceiptService],
    ["Payment", PaymentService],
  ] as const)("deduplicates and locks %s counters in numeric order", async (_name, Service) => {
    const tx = { marker: "same-transaction" } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn().mockImplementation(async (_tx, companyId, accountId) => ({
      eligible: true as const,
      companyId,
      accountId,
    }));
    const settlement = { validateDraftTargets: vi.fn() };
    const dependencies = {
      treasury: {} as never,
      fxAccounts: {} as never,
      accountReferences: { lockPostingAccount },
      receivables: settlement as never,
      payables: settlement as never,
    };
    const service = Service === ReceiptService
      ? new ReceiptService({} as PrismaClient, dependencies)
      : new PaymentService({} as PrismaClient, dependencies);
    const writer = service as unknown as {
      lockCounterAccounts(client: Prisma.TransactionClient, companyId: bigint, accountIds: readonly bigint[]): Promise<void>;
    };

    await writer.lockCounterAccounts(tx, 7n, [9n, 3n, 9n, 5n]);

    expect(lockPostingAccount.mock.calls).toEqual([
      [tx, 7n, 3n],
      [tx, 7n, 5n],
      [tx, 7n, 9n],
    ]);
  });
});
