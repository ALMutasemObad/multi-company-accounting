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

type ManualPolicy = {
  baseCurrencyId: bigint;
  inventoryAccountId: bigint;
  offsetAccountId: bigint;
};

describe("Inventory policy recheck after centralized posting account locks", () => {
  it("builds the movement from the preliminary policy without taking a partial local account lock", async () => {
    const tx = { marker: "same-transaction" } as unknown as Prisma.TransactionClient;
    const service = new InventoryMovementService({} as PrismaClient);
    const policy = { baseCurrencyId: 1n, inventoryAccountId: 11n, offsetAccountId: 12n };
    const resolveManualAccountingPolicy = vi.fn().mockResolvedValue(policy);
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

    await expect(writer.createManualMovementWithAccountingPolicy(
      tx,
      { companyId: 7n, userId: 9n },
      input,
    )).resolves.toEqual({ created: { id: 21n, lines: [] }, policy });
    expect(resolveManualAccountingPolicy).toHaveBeenCalledTimes(1);
    expect(createInTransaction).toHaveBeenCalledWith(tx, { companyId: 7n, userId: 9n }, input);
  });

  it("fails closed when the policy ids change after PostingEngine takes the complete lock set", async () => {
    const tx = { marker: "same-transaction" } as unknown as Prisma.TransactionClient;
    const service = new InventoryMovementService({} as PrismaClient);
    const resolveManualAccountingPolicy = vi.fn().mockResolvedValue({
      baseCurrencyId: 1n,
      inventoryAccountId: 11n,
      offsetAccountId: 13n,
    });
    const writer = service as unknown as {
      resolveManualAccountingPolicy: typeof resolveManualAccountingPolicy;
      assertManualAccountingPolicyStillCurrent(
        client: Prisma.TransactionClient,
        companyId: bigint,
        movementType: InventoryMovementInput["movementType"],
        expected: ManualPolicy,
      ): Promise<void>;
    };
    writer.resolveManualAccountingPolicy = resolveManualAccountingPolicy;

    await expect(writer.assertManualAccountingPolicyStillCurrent(
      tx,
      7n,
      input.movementType,
      { baseCurrencyId: 1n, inventoryAccountId: 11n, offsetAccountId: 12n },
    )).rejects.toEqual(new InventoryMovementError("INVENTORY_ACCOUNTING_NOT_CONFIGURED"));
  });

  it("revalidates the specialized offset class after PostingEngine locks the accounts", async () => {
    const inventory = {
      id: 11n,
      sourceTemplateKey: "inventory",
      isActive: true,
      allowsPosting: true,
      accountType: { class: "ASSET" },
      _count: { children: 0 },
    };
    const changedOffset = {
      id: 12n,
      sourceTemplateKey: "misc-income",
      isActive: true,
      allowsPosting: true,
      accountType: { class: "LIABILITY" },
      _count: { children: 0 },
    };
    const tx = {
      company: { findFirst: vi.fn().mockResolvedValue({ baseCurrencyId: 1n }) },
      account: { findMany: vi.fn().mockResolvedValue([inventory, changedOffset]) },
    } as unknown as Prisma.TransactionClient;
    const service = new InventoryMovementService({} as PrismaClient);
    const writer = service as unknown as {
      assertManualAccountingPolicyStillCurrent(
        client: Prisma.TransactionClient,
        companyId: bigint,
        movementType: InventoryMovementInput["movementType"],
        expected: ManualPolicy,
      ): Promise<void>;
    };

    await expect(writer.assertManualAccountingPolicyStillCurrent(
      tx,
      7n,
      input.movementType,
      { baseCurrencyId: 1n, inventoryAccountId: 11n, offsetAccountId: 12n },
    )).rejects.toEqual(new InventoryMovementError("INVENTORY_ACCOUNTING_NOT_CONFIGURED"));
  });

  it("copies an inactive historical reversal offset without a current-eligibility dependency", async () => {
    const update = vi.fn().mockResolvedValue({ id: 31n });
    const tx = { inventoryMovement: { update } } as unknown as Prisma.TransactionClient;
    const service = new InventoryMovementService({} as PrismaClient);
    const writer = service as unknown as {
      attachReversalAccounting(
        client: Prisma.TransactionClient,
        movementId: bigint,
        documentId: bigint,
        offsetAccountId: bigint | null,
      ): Promise<void>;
    };

    await writer.attachReversalAccounting(tx, 31n, 41n, 12n);
    expect(update).toHaveBeenCalledWith({
      where: { id: 31n },
      data: { accountingDocumentId: 41n, offsetAccountId: 12n },
    });
  });
});
