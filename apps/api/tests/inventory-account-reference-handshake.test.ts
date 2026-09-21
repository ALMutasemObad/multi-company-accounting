import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  InventoryMovementError,
  InventoryMovementService,
  type InventoryMovementInput,
} from "../src/inventory/inventory-movement-service.js";

const input: InventoryMovementInput = {
  movementType: "ADJUSTMENT_IN",
  movementDate: "2050-01-01",
  description: "inventory adjustment",
  lines: [{ inventoryItemId: 4n, toWarehouseId: 3n, quantity: "1", unitCostBase: "10" }],
};

describe("Inventory account reference writer handshake", () => {
  it("locks only the permanent manual offset on the supplied transaction before movement writes", async () => {
    const tx = { marker: "same-transaction" } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: true, companyId: 7n, accountId: 12n });
    const service = new InventoryMovementService({} as PrismaClient, { lockPostingAccount });
    const resolveManualAccountingPolicy = vi.fn().mockResolvedValue({
      baseCurrencyId: 1n,
      inventoryAccountId: 11n,
      offsetAccountId: 12n,
    });
    const createInTransaction = vi.fn().mockResolvedValue({ id: 21n, lines: [] });
    const writer = service as unknown as {
      resolveManualAccountingPolicy: typeof resolveManualAccountingPolicy;
      createInTransaction: typeof createInTransaction;
      createManualMovementWithAccountingPolicy(
        client: Prisma.TransactionClient,
        context: { companyId: bigint; userId: bigint },
        movement: InventoryMovementInput,
      ): Promise<unknown>;
    };
    writer.resolveManualAccountingPolicy = resolveManualAccountingPolicy;
    writer.createInTransaction = createInTransaction;

    await writer.createManualMovementWithAccountingPolicy(tx, { companyId: 7n, userId: 9n }, input);

    expect(lockPostingAccount.mock.calls).toEqual([[tx, 7n, 12n]]);
    expect(lockPostingAccount).not.toHaveBeenCalledWith(tx, 7n, 11n);
    expect(lockPostingAccount.mock.invocationCallOrder[0]).toBeLessThan(createInTransaction.mock.invocationCallOrder[0]!);
    expect(resolveManualAccountingPolicy).toHaveBeenCalledTimes(2);
    expect(createInTransaction).toHaveBeenCalledWith(tx, { companyId: 7n, userId: 9n }, input);
  });

  it("copies a historical reversal offset without re-locking its current eligibility", async () => {
    const update = vi.fn().mockResolvedValue({ id: 31n });
    const tx = { inventoryMovement: { update } } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: false, reason: "INACTIVE" });
    const service = new InventoryMovementService({} as PrismaClient, { lockPostingAccount });
    const writer = service as unknown as {
      attachReversalAccounting(
        client: Prisma.TransactionClient,
        movementId: bigint,
        documentId: bigint,
        offsetAccountId: bigint | null,
      ): Promise<void>;
    };

    await writer.attachReversalAccounting(tx, 31n, 41n, 12n);

    expect(lockPostingAccount).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 31n },
      data: { accountingDocumentId: 41n, offsetAccountId: 12n },
    });
  });

  it("fails closed when the manual offset policy changes between resolve and locked re-check", async () => {
    const tx = { marker: "same-transaction" } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn().mockResolvedValue({ eligible: true, companyId: 7n, accountId: 12n });
    const service = new InventoryMovementService({} as PrismaClient, { lockPostingAccount });
    const resolveManualAccountingPolicy = vi.fn()
      .mockResolvedValueOnce({ baseCurrencyId: 1n, inventoryAccountId: 11n, offsetAccountId: 12n })
      .mockResolvedValueOnce({ baseCurrencyId: 1n, inventoryAccountId: 11n, offsetAccountId: 13n });
    const createInTransaction = vi.fn();
    const writer = service as unknown as {
      resolveManualAccountingPolicy: typeof resolveManualAccountingPolicy;
      createInTransaction: typeof createInTransaction;
      createManualMovementWithAccountingPolicy(
        client: Prisma.TransactionClient,
        context: { companyId: bigint; userId: bigint },
        movement: InventoryMovementInput,
      ): Promise<unknown>;
    };
    writer.resolveManualAccountingPolicy = resolveManualAccountingPolicy;
    writer.createInTransaction = createInTransaction;

    await expect(writer.createManualMovementWithAccountingPolicy(
      tx,
      { companyId: 7n, userId: 9n },
      input,
    )).rejects.toEqual(new InventoryMovementError("INVENTORY_ACCOUNTING_NOT_CONFIGURED"));
    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 12n);
    expect(createInTransaction).not.toHaveBeenCalled();
  });

  it("revalidates the specialized offset class after acquiring the account lock", async () => {
    const inventory = {
      id: 11n,
      sourceTemplateKey: "inventory",
      isActive: true,
      allowsPosting: true,
      accountType: { class: "ASSET" },
      _count: { children: 0 },
    };
    const validOffset = {
      id: 12n,
      sourceTemplateKey: "misc-income",
      isActive: true,
      allowsPosting: true,
      accountType: { class: "REVENUE" },
      _count: { children: 0 },
    };
    const changedOffset = { ...validOffset, accountType: { class: "LIABILITY" } };
    const findMany = vi.fn()
      .mockResolvedValueOnce([inventory, validOffset])
      .mockResolvedValueOnce([inventory, changedOffset]);
    const tx = {
      company: { findFirst: vi.fn().mockResolvedValue({ baseCurrencyId: 1n }) },
      account: { findMany },
    } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn().mockResolvedValue({
      eligible: true,
      companyId: 7n,
      accountId: 12n,
    });
    const service = new InventoryMovementService({} as PrismaClient, { lockPostingAccount });
    const createInTransaction = vi.fn();
    const writer = service as unknown as {
      createInTransaction: typeof createInTransaction;
      createManualMovementWithAccountingPolicy(
        client: Prisma.TransactionClient,
        context: { companyId: bigint; userId: bigint },
        movement: InventoryMovementInput,
      ): Promise<unknown>;
    };
    writer.createInTransaction = createInTransaction;

    await expect(writer.createManualMovementWithAccountingPolicy(
      tx,
      { companyId: 7n, userId: 9n },
      input,
    )).rejects.toEqual(new InventoryMovementError("INVENTORY_ACCOUNTING_NOT_CONFIGURED"));
    expect(lockPostingAccount).toHaveBeenCalledWith(tx, 7n, 12n);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(createInTransaction).not.toHaveBeenCalled();
  });

  it("also skips the historical copy lock when a reversal has no offset", async () => {
    const update = vi.fn().mockResolvedValue({ id: 31n });
    const tx = { inventoryMovement: { update } } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn();
    const service = new InventoryMovementService({} as PrismaClient, { lockPostingAccount });
    const writer = service as unknown as {
      attachReversalAccounting(
        client: Prisma.TransactionClient,
        movementId: bigint,
        documentId: bigint,
        offsetAccountId: bigint | null,
      ): Promise<void>;
    };

    await writer.attachReversalAccounting(tx, 31n, 41n, null);

    expect(lockPostingAccount).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 31n },
      data: { accountingDocumentId: 41n, offsetAccountId: null },
    });
  });

  it("deduplicates offset locks numerically and fails closed on ineligible accounts", async () => {
    const tx = { marker: "same-transaction" } as unknown as Prisma.TransactionClient;
    const lockPostingAccount = vi.fn()
      .mockResolvedValueOnce({ eligible: true, companyId: 7n, accountId: 3n })
      .mockResolvedValueOnce({ eligible: false, reason: "INACTIVE" });
    const service = new InventoryMovementService({} as PrismaClient, { lockPostingAccount });
    const writer = service as unknown as {
      lockOffsetAccounts(client: Prisma.TransactionClient, companyId: bigint, accountIds: readonly bigint[]): Promise<void>;
    };

    await expect(writer.lockOffsetAccounts(tx, 7n, [9n, 3n, 9n, 5n]))
      .rejects.toEqual(new InventoryMovementError("INVENTORY_ACCOUNTING_NOT_CONFIGURED"));
    expect(lockPostingAccount.mock.calls).toEqual([
      [tx, 7n, 3n],
      [tx, 7n, 5n],
    ]);
  });
});
