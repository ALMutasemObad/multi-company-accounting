import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PurchaseInvoiceService } from "../src/purchases/purchase-invoice-service.js";
import { SupplierService } from "../src/suppliers/supplier-service.js";

describe("Purchases account reference writer handshake", () => {
  it("locks Supplier references on create and whenever update carries payableAccountId", async () => {
    const supplier = {
      findFirst: vi.fn().mockResolvedValue({ id: 19n, companyId: 3n, payableAccountId: 5n }),
      create: vi.fn().mockResolvedValue({ id: 19n, companyId: 3n, payableAccountId: 5n, addresses: [] }),
      update: vi.fn().mockResolvedValue({ id: 19n, companyId: 3n, payableAccountId: 6n, addresses: [] }),
    };
    const tx = {
      supplier,
      auditLog: { create: vi.fn().mockResolvedValue({ id: 1n }) },
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ prefix: "SUP-", padding: 6, nextNumber: 2n }]),
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient;
    const lockPostingAccount = vi.fn(async (
      _tx: Prisma.TransactionClient,
      companyId: bigint,
      accountId: bigint,
    ) => ({ eligible: true as const, companyId, accountId }));
    const service = new SupplierService(prisma, { lockPostingAccount });

    await service.createSupplier({ companyId: 3n, userId: 11n }, {
      payableAccountId: 5n,
      nameAr: "مورد",
    });
    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 3n, 5n);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(supplier.create.mock.invocationCallOrder[0]!);

    lockPostingAccount.mockClear();
    await service.updateSupplier({ companyId: 3n, userId: 11n }, 19n, { nameAr: "مورد محدث" });
    expect(lockPostingAccount).not.toHaveBeenCalled();

    await service.updateSupplier({ companyId: 3n, userId: 11n }, 19n, { payableAccountId: 5n });
    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 3n, 5n);

    lockPostingAccount.mockClear();
    await service.updateSupplier({ companyId: 3n, userId: 11n }, 19n, { payableAccountId: 6n });
    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 3n, 6n);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(supplier.update.mock.invocationCallOrder.at(-1)!);
  });

  it("deduplicates and locks invoice debit accounts numerically on the supplied transaction", async () => {
    const tx = { marker: "same-transaction" } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn(async (
      _tx: Prisma.TransactionClient,
      companyId: bigint,
      accountId: bigint,
    ) => ({ eligible: true as const, companyId, accountId }));
    const service = new PurchaseInvoiceService({} as PrismaClient, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      payables: {} as never,
      accountReferences: { lockPostingAccount },
    });
    const writer = service as unknown as {
      lockDebitAccounts(
        client: Prisma.TransactionClient,
        companyId: bigint,
        accountIds: readonly bigint[],
      ): Promise<bigint[]>;
    };

    await expect(writer.lockDebitAccounts(tx, 7n, [9n, 3n, 9n, 5n])).resolves.toEqual([3n, 5n, 9n]);
    expect(lockPostingAccount.mock.calls).toEqual([
      [tx, 7n, 3n],
      [tx, 7n, 5n],
      [tx, 7n, 9n],
    ]);
  });

  it("fails closed on the first ineligible debit account", async () => {
    const tx = {} as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: false as const, reason: "INACTIVE" as const });
    const service = new PurchaseInvoiceService({} as PrismaClient, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      payables: {} as never,
      accountReferences: { lockPostingAccount },
    });
    const writer = service as unknown as {
      lockDebitAccounts(
        client: Prisma.TransactionClient,
        companyId: bigint,
        accountIds: readonly bigint[],
      ): Promise<bigint[]>;
    };

    await expect(writer.lockDebitAccounts(tx, 7n, [4n, 3n])).rejects.toMatchObject({ reason: "INVALID_ACCOUNT" });
    expect(lockPostingAccount).toHaveBeenCalledTimes(1);
    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 3n);
  });

  it("persists the stock replacement only from the post-lock hook", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = { purchaseInvoiceLine: { updateMany } } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn(async (
      _tx: Prisma.TransactionClient,
      companyId: bigint,
      accountId: bigint,
    ) => ({ eligible: true as const, companyId, accountId }));
    const service = new PurchaseInvoiceService({} as PrismaClient, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      payables: {} as never,
      accountReferences: { lockPostingAccount },
    });
    const writer = service as unknown as {
      replaceInventoryDebitAccount(
        client: Prisma.TransactionClient,
        companyId: bigint,
        purchaseInvoiceId: bigint,
        accountId: bigint,
      ): Promise<void>;
    };

    await writer.replaceInventoryDebitAccount(tx, 7n, 19n, 13n);

    expect(lockPostingAccount).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 7n, purchaseInvoiceId: 19n, inventoryItemId: { not: null } },
      data: { debitAccountId: 13n },
    });
  });

  it("mutates final posting lines once and detects an already-current inventory account", () => {
    const service = new PurchaseInvoiceService({} as PrismaClient, {
      taxes: {} as never,
      inventory: {} as never,
      stock: {} as never,
      payables: {} as never,
      accountReferences: { lockPostingAccount: vi.fn() },
    });
    const changedLines = [{ accountId: 3n }, { accountId: 5n }] as unknown as Array<Record<string, unknown>>;
    const currentLines = [{ accountId: 13n }, { accountId: 13n }] as unknown as Array<Record<string, unknown>>;
    const writer = service as unknown as {
      replaceInventoryPostingAccount(
        accountId: bigint,
        postingLines: Array<Record<string, unknown>>,
      ): boolean;
    };

    expect(writer.replaceInventoryPostingAccount(13n, changedLines)).toBe(true);
    expect(changedLines.map((line) => line.accountId)).toEqual([13n, 13n]);
    expect(writer.replaceInventoryPostingAccount(13n, currentLines)).toBe(false);
  });
});
