import { Prisma } from "@prisma/client";

export type PayableAllocationTarget = {
  payableItemId: bigint;
  allocatedAmount: Prisma.Decimal.Value;
};

type SettlementErrors = {
  invalid: () => Error;
  overAllocation: () => Error;
  conflict: () => Error;
};

type SettlementCommand = {
  companyId: bigint;
  supplierId: bigint | null;
  currencyId: bigint;
  allocations: PayableAllocationTarget[];
  errors: SettlementErrors;
};

export interface PayableSettlementPort {
  validateDraftTargets(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ): Promise<void>;
  applyPayment(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ): Promise<void>;
  reversePayment(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ): Promise<void>;
}

type LockedRow = { id: bigint };

function orderedIds(values: bigint[]) {
  return [...new Set(values.map(String))]
    .map(BigInt)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export async function lockPayableItems(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  itemIds: bigint[],
) {
  const ids = orderedIds(itemIds);
  if (ids.length === 0) return [];
  return tx.$queryRaw<LockedRow[]>(
    Prisma.sql`
      SELECT id
      FROM payable_items
      WHERE company_id=${companyId} AND id IN (${Prisma.join(ids)})
      ORDER BY id
      FOR UPDATE
    `,
  );
}

function statusFor(outstanding: Prisma.Decimal, original: Prisma.Decimal) {
  if (outstanding.equals(0)) return "SETTLED" as const;
  if (outstanding.equals(original)) return "OPEN" as const;
  return "PARTIAL" as const;
}

export class PayableItemService implements PayableSettlementPort {
  async validateDraftTargets(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ) {
    const items = await this.loadTargets(tx, command, false);
    this.validateIdentity(items, command);
  }

  async applyPayment(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ) {
    const items = await this.loadTargets(tx, command, true);
    this.validateIdentity(items, command);
    const byId = new Map(items.map((item) => [item.id.toString(), item]));
    for (const allocation of command.allocations) {
      const item = byId.get(allocation.payableItemId.toString())!;
      if (new Prisma.Decimal(allocation.allocatedAmount).gt(item.outstandingAmount))
        throw command.errors.overAllocation();
    }
    await this.persistDelta(tx, command, items, "DECREASE");
  }

  async reversePayment(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ) {
    const items = await this.loadTargets(tx, command, true);
    this.validateRestore(items, command);
    await this.persistDelta(tx, command, items, "RESTORE");
  }

  createForInvoice(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      purchaseInvoiceId: bigint;
      supplierId: bigint;
      currencyId: bigint;
      dueDate: Date;
      originalAmount: Prisma.Decimal.Value;
    },
  ) {
    const originalAmount = new Prisma.Decimal(input.originalAmount);
    return tx.payableItem.create({
      data: {
        ...input,
        originalAmount,
        outstandingAmount: originalAmount,
        status: "OPEN",
      },
    });
  }

  async applyDebit(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      sourceInvoiceId: bigint;
      amount: Prisma.Decimal.Value;
      invalid: () => Error;
      overAllocation: () => Error;
      conflict: () => Error;
    },
  ) {
    const item = await this.lockByInvoice(
      tx,
      input.companyId,
      input.sourceInvoiceId,
      input.invalid,
    );
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lte(0) || item.status === "REVERSED") throw input.invalid();
    if (amount.gt(item.outstandingAmount)) throw input.overAllocation();
    await this.updateItem(
      tx,
      item,
      item.outstandingAmount.sub(amount),
      input.conflict,
    );
  }

  async reverseDebit(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      sourceInvoiceId: bigint;
      amount: Prisma.Decimal.Value;
      invalid: () => Error;
      conflict: () => Error;
    },
  ) {
    const item = await this.lockByInvoice(
      tx,
      input.companyId,
      input.sourceInvoiceId,
      input.invalid,
    );
    const restored = item.outstandingAmount.add(input.amount);
    if (item.status === "REVERSED" || restored.gt(item.originalAmount))
      throw input.invalid();
    await this.updateItem(tx, item, restored, input.conflict);
  }

  async reverseInvoice(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      purchaseInvoiceId: bigint;
      invalid: () => Error;
      hasSettlements: () => Error;
      conflict: () => Error;
    },
  ) {
    const item = await this.lockByInvoice(
      tx,
      input.companyId,
      input.purchaseInvoiceId,
      input.invalid,
    );
    if (
      item.status !== "OPEN" ||
      !item.outstandingAmount.equals(item.originalAmount)
    ) {
      throw input.hasSettlements();
    }
    const changed = await tx.payableItem.updateMany({
      where: {
        id: item.id,
        companyId: input.companyId,
        version: item.version,
        status: "OPEN",
        outstandingAmount: item.originalAmount,
      },
      data: {
        outstandingAmount: new Prisma.Decimal(0),
        status: "REVERSED",
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw input.conflict();
  }

  private async loadTargets(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
    lock: boolean,
  ) {
    const ids = orderedIds(
      command.allocations.map((allocation) => allocation.payableItemId),
    );
    if (ids.length !== command.allocations.length) throw command.errors.invalid();
    if (lock) {
      const locked = await lockPayableItems(tx, command.companyId, ids);
      if (locked.length !== ids.length) throw command.errors.invalid();
    }
    const items = await tx.payableItem.findMany({
      where: { companyId: command.companyId, id: { in: ids } },
      orderBy: { id: "asc" },
    });
    if (items.length !== ids.length) throw command.errors.invalid();
    return items;
  }

  private validateIdentity(
    items: Awaited<ReturnType<PayableItemService["loadTargets"]>>,
    command: SettlementCommand,
  ) {
    if (command.allocations.length > 0 && command.supplierId == null)
      throw command.errors.invalid();
    const byId = new Map(items.map((item) => [item.id.toString(), item]));
    for (const allocation of command.allocations) {
      const item = byId.get(allocation.payableItemId.toString());
      const amount = new Prisma.Decimal(allocation.allocatedAmount);
      if (
        !item ||
        amount.lte(0) ||
        item.supplierId !== command.supplierId ||
        item.currencyId !== command.currencyId ||
        item.status === "REVERSED"
      ) {
        throw command.errors.invalid();
      }
    }
  }

  private validateRestore(
    items: Awaited<ReturnType<PayableItemService["loadTargets"]>>,
    command: SettlementCommand,
  ) {
    const byId = new Map(items.map((item) => [item.id.toString(), item]));
    for (const allocation of command.allocations) {
      const item = byId.get(allocation.payableItemId.toString());
      const amount = new Prisma.Decimal(allocation.allocatedAmount);
      if (
        !item ||
        amount.lte(0) ||
        item.supplierId !== command.supplierId ||
        item.currencyId !== command.currencyId ||
        item.status === "REVERSED" ||
        item.outstandingAmount.add(amount).gt(item.originalAmount)
      ) {
        throw command.errors.invalid();
      }
    }
  }

  private async persistDelta(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
    items: Awaited<ReturnType<PayableItemService["loadTargets"]>>,
    direction: "DECREASE" | "RESTORE",
  ) {
    const allocations = new Map(
      command.allocations.map((allocation) => [
        allocation.payableItemId.toString(),
        new Prisma.Decimal(allocation.allocatedAmount),
      ]),
    );
    for (const item of items) {
      const amount = allocations.get(item.id.toString())!;
      const outstanding =
        direction === "DECREASE"
          ? item.outstandingAmount.sub(amount)
          : item.outstandingAmount.add(amount);
      await this.updateItem(tx, item, outstanding, command.errors.conflict);
    }
  }

  private async updateItem(
    tx: Prisma.TransactionClient,
    item: {
      id: bigint;
      companyId: bigint;
      version: number;
      status: "OPEN" | "PARTIAL" | "SETTLED" | "REVERSED";
      originalAmount: Prisma.Decimal;
    },
    outstandingAmount: Prisma.Decimal,
    conflict: () => Error,
  ) {
    const changed = await tx.payableItem.updateMany({
      where: {
        id: item.id,
        companyId: item.companyId,
        version: item.version,
        status: item.status,
      },
      data: {
        outstandingAmount,
        status: statusFor(outstandingAmount, item.originalAmount),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw conflict();
  }

  private async lockByInvoice(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    purchaseInvoiceId: bigint,
    invalid: () => Error,
  ) {
    const candidate = await tx.payableItem.findFirst({
      where: { companyId, purchaseInvoiceId },
      select: { id: true },
    });
    if (!candidate) throw invalid();
    const locked = await lockPayableItems(tx, companyId, [candidate.id]);
    if (locked.length !== 1) throw invalid();
    const item = await tx.payableItem.findFirst({
      where: { id: candidate.id, companyId, purchaseInvoiceId },
    });
    if (!item) throw invalid();
    return item;
  }
}
