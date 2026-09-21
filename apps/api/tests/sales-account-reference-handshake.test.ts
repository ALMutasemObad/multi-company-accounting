import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SalesInvoiceService } from "../src/sales/sales-invoice-service.js";

describe("Sales account reference writer handshake", () => {
  it("locks deduplicated revenue accounts before prepare reads or invoice writes", async () => {
    const accountFindFirst = vi.fn().mockResolvedValue({
      id: 2n,
      companyId: 7n,
      isActive: true,
      allowsPosting: true,
      accountType: { class: "ASSET" },
      _count: { children: 0 },
    });
    const accountFindMany = vi.fn().mockResolvedValue([3n, 5n, 9n].map((id) => ({
      id,
      companyId: 7n,
      isActive: true,
      allowsPosting: true,
      accountType: { class: "REVENUE" },
      _count: { children: 0 },
    })));
    const accountingDocumentCreate = vi.fn().mockResolvedValue({ id: 51n });
    const salesInvoiceCreate = vi.fn().mockResolvedValue({ id: 61n });
    const tx = {
      fiscalPeriod: { findFirst: vi.fn().mockResolvedValue({
        id: 13n,
        fiscalYearId: 12n,
        status: "OPEN",
        startDate: new Date("2050-01-01T00:00:00.000Z"),
        endDate: new Date("2050-12-31T00:00:00.000Z"),
      }) },
      customer: { findFirst: vi.fn().mockResolvedValue({
        id: 17n,
        receivableAccountId: 2n,
        nameAr: "عميل",
        taxNumberLast4: null,
        addresses: [],
      }) },
      account: { findFirst: accountFindFirst, findMany: accountFindMany },
      company: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 7n, baseCurrencyId: 1n }) },
      companyCurrency: { findFirst: vi.fn().mockResolvedValue({ companyId: 7n, currencyId: 1n }) },
      accountingDocument: { create: accountingDocumentCreate },
      salesInvoice: { create: salesInvoiceCreate },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 71n }) },
    };
    const prisma = {
      fiscalPeriod: { findFirst: vi.fn().mockResolvedValue({
        id: 13n,
        fiscalYearId: 12n,
        status: "OPEN",
        startDate: new Date("2050-01-01T00:00:00.000Z"),
        endDate: new Date("2050-12-31T00:00:00.000Z"),
      }) },
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient;
    const lockPostingAccount = vi.fn(async (
      _tx: Prisma.TransactionClient,
      companyId: bigint,
      accountId: bigint,
    ) => ({ eligible: true as const, companyId, accountId }));
    const service = new SalesInvoiceService(prisma, {
      taxes: { resolveQuotes: vi.fn().mockResolvedValue(new Map()) } as never,
      inventory: { resolveInvoiceSelection: vi.fn().mockResolvedValue({ warehouse: null, items: new Map() }) } as never,
      stock: {} as never,
      receivables: {} as never,
      accountReferences: { lockPostingAccount },
    });
    (service as unknown as { fiscal: { reserveDocumentNumber: () => Promise<string> } }).fiscal = {
      reserveDocumentNumber: vi.fn().mockResolvedValue("SI-2050-000001"),
    };
    const line = (revenueAccountId: bigint) => ({
      inventoryItemId: null,
      description: `line-${revenueAccountId}`,
      quantity: "1",
      unitPrice: "10",
      discountAmount: "0",
      revenueAccountId,
      costCenterId: null,
      taxRateId: null,
    });

    await service.create({ companyId: 7n, userId: 4n }, {
      documentType: "SALES_INVOICE",
      fiscalPeriodId: 13n,
      documentDate: "2050-01-10",
      dueDate: "2050-01-20",
      description: "invoice",
      customerId: 17n,
      warehouseId: null,
      sourceInvoiceId: null,
      currencyId: 1n,
      exchangeRate: "1",
      customerAddress: null,
      notes: null,
      lines: [line(9n), line(3n), line(9n), line(5n)],
    });

    expect(lockPostingAccount.mock.calls).toEqual([
      [tx, 7n, 3n],
      [tx, 7n, 5n],
      [tx, 7n, 9n],
    ]);
    expect(lockPostingAccount.mock.invocationCallOrder.at(-1)!).toBeLessThan(accountFindMany.mock.invocationCallOrder[0]!);
    expect(lockPostingAccount.mock.invocationCallOrder.at(-1)!).toBeLessThan(accountingDocumentCreate.mock.invocationCallOrder[0]!);
    expect(lockPostingAccount.mock.invocationCallOrder.at(-1)!).toBeLessThan(salesInvoiceCreate.mock.invocationCallOrder[0]!);
  });

  it("deduplicates and locks invoice revenue accounts in numeric order on the supplied transaction", async () => {
    const tx = { marker: "same-transaction" } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn(async (
      _tx: Prisma.TransactionClient,
      companyId: bigint,
      accountId: bigint,
    ) => ({ eligible: true as const, companyId, accountId }));
    const service = new SalesInvoiceService({} as PrismaClient, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      receivables: {} as never,
      accountReferences: { lockPostingAccount },
    });
    const writer = service as unknown as {
      lockRevenueAccounts(
        client: Prisma.TransactionClient,
        companyId: bigint,
        accountIds: readonly bigint[],
      ): Promise<bigint[]>;
    };

    await expect(writer.lockRevenueAccounts(tx, 7n, [9n, 3n, 9n, 5n])).resolves.toEqual([3n, 5n, 9n]);
    expect(lockPostingAccount.mock.calls).toEqual([
      [tx, 7n, 3n],
      [tx, 7n, 5n],
      [tx, 7n, 9n],
    ]);
  });

  it("fails closed on the first ineligible revenue account", async () => {
    const tx = {} as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn()
      .mockResolvedValueOnce({ eligible: false as const, reason: "INACTIVE" as const });
    const service = new SalesInvoiceService({} as PrismaClient, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      receivables: {} as never,
      accountReferences: { lockPostingAccount },
    });
    const writer = service as unknown as {
      lockRevenueAccounts(
        client: Prisma.TransactionClient,
        companyId: bigint,
        accountIds: readonly bigint[],
      ): Promise<bigint[]>;
    };

    await expect(writer.lockRevenueAccounts(tx, 7n, [4n, 3n])).rejects.toMatchObject({ reason: "INVALID_ACCOUNT" });
    expect(lockPostingAccount).toHaveBeenCalledTimes(1);
    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 3n);
  });

  it("fails closed when the locked invoice revenue source set changes", async () => {
    const tx = {
      salesInvoiceLine: {
        findMany: vi.fn().mockResolvedValue([{ revenueAccountId: 3n }, { revenueAccountId: 8n }]),
      },
      account: { findMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;
    const service = new SalesInvoiceService({} as PrismaClient, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      receivables: {} as never,
      accountReferences: {} as never,
    });
    const writer = service as unknown as {
      assertRevenueAccountsStillCurrent(
        client: Prisma.TransactionClient,
        companyId: bigint,
        invoiceId: bigint,
        accountIds: readonly bigint[],
      ): Promise<void>;
    };

    await expect(writer.assertRevenueAccountsStillCurrent(tx, 7n, 61n, [3n, 9n]))
      .rejects.toMatchObject({ reason: "VERSION_CONFLICT" });
    expect(tx.account.findMany).not.toHaveBeenCalled();
  });

  it("rechecks the revenue class and posting predicate after central locks", async () => {
    const tx = {
      salesInvoiceLine: {
        findMany: vi.fn().mockResolvedValue([{ revenueAccountId: 3n }, { revenueAccountId: 9n }]),
      },
      account: {
        findMany: vi.fn().mockResolvedValue([
          { id: 3n, accountType: { class: "REVENUE" }, _count: { children: 0 } },
          { id: 9n, accountType: { class: "ASSET" }, _count: { children: 0 } },
        ]),
      },
    } as unknown as Prisma.TransactionClient;
    const service = new SalesInvoiceService({} as PrismaClient, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      receivables: {} as never,
      accountReferences: {} as never,
    });
    const writer = service as unknown as {
      assertRevenueAccountsStillCurrent(
        client: Prisma.TransactionClient,
        companyId: bigint,
        invoiceId: bigint,
        accountIds: readonly bigint[],
      ): Promise<void>;
    };

    await expect(writer.assertRevenueAccountsStillCurrent(tx, 7n, 61n, [3n, 9n]))
      .rejects.toMatchObject({ reason: "INVALID_ACCOUNT" });
    expect(tx.salesInvoiceLine.findMany).toHaveBeenCalledWith({
      where: { salesInvoiceId: 61n, companyId: 7n },
      select: { revenueAccountId: true },
    });
    expect(tx.account.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: 7n, isActive: true, allowsPosting: true }),
    }));
  });
});
