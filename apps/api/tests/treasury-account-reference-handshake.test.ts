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
