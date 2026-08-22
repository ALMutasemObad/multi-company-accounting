import { Prisma } from "@prisma/client";

export type ReceivableAllocationTarget = {
  receivableItemId: bigint;
  allocatedAmount: Prisma.Decimal.Value;
};

type SettlementErrors = {
  invalid: () => Error;
  overAllocation: () => Error;
  conflict: () => Error;
};

type SettlementCommand = {
  companyId: bigint;
  customerId: bigint | null;
  currencyId: bigint;
  allocations: ReceivableAllocationTarget[];
  errors: SettlementErrors;
};

export interface ReceivableSettlementPort {
  validateDraftTargets(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ): Promise<void>;
  applyReceipt(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ): Promise<void>;
  reverseReceipt(
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

export async function lockReceivableItems(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  itemIds: bigint[],
) {
  const ids = orderedIds(itemIds);
  if (ids.length === 0) return [];
  return tx.$queryRaw<LockedRow[]>(
    Prisma.sql`
      SELECT id
      FROM receivable_items
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

export class ReceivableItemService implements ReceivableSettlementPort {
  async validateDraftTargets(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ) {
    const items = await this.loadTargets(tx, command, false);
    this.validateIdentity(items, command);
  }

  async applyReceipt(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ) {
    const items = await this.loadTargets(tx, command, true);
    this.validateIdentity(items, command);
    const byId = new Map(items.map((item) => [item.id.toString(), item]));
    for (const allocation of command.allocations) {
      const item = byId.get(allocation.receivableItemId.toString())!;
      if (new Prisma.Decimal(allocation.allocatedAmount).gt(item.outstandingAmount))
        throw command.errors.overAllocation();
    }
    await this.persistDelta(tx, command, items, "DECREASE");
  }

  async reverseReceipt(
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
      salesInvoiceId: bigint;
      customerId: bigint;
      currencyId: bigint;
      dueDate: Date;
      originalAmount: Prisma.Decimal.Value;
    },
  ) {
    const originalAmount = new Prisma.Decimal(input.originalAmount);
    return tx.receivableItem.create({
      data: {
        ...input,
        originalAmount,
        outstandingAmount: originalAmount,
        status: "OPEN",
      },
    });
  }

  async applyCredit(
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

  async reverseCredit(
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
      salesInvoiceId: bigint;
      invalid: () => Error;
      hasSettlements: () => Error;
      conflict: () => Error;
    },
  ) {
    const item = await this.lockByInvoice(
      tx,
      input.companyId,
      input.salesInvoiceId,
      input.invalid,
    );
    if (
      item.status !== "OPEN" ||
      !item.outstandingAmount.equals(item.originalAmount)
    ) {
      throw input.hasSettlements();
    }
    const changed = await tx.receivableItem.updateMany({
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
      command.allocations.map((allocation) => allocation.receivableItemId),
    );
    if (ids.length !== command.allocations.length) throw command.errors.invalid();
    if (lock) {
      const locked = await lockReceivableItems(tx, command.companyId, ids);
      if (locked.length !== ids.length) throw command.errors.invalid();
    }
    const items = await tx.receivableItem.findMany({
      where: { companyId: command.companyId, id: { in: ids } },
      orderBy: { id: "asc" },
    });
    if (items.length !== ids.length) throw command.errors.invalid();
    return items;
  }

  private validateIdentity(
    items: Awaited<ReturnType<ReceivableItemService["loadTargets"]>>,
    command: SettlementCommand,
  ) {
    if (command.allocations.length > 0 && command.customerId == null)
      throw command.errors.invalid();
    const byId = new Map(items.map((item) => [item.id.toString(), item]));
    for (const allocation of command.allocations) {
      const item = byId.get(allocation.receivableItemId.toString());
      const amount = new Prisma.Decimal(allocation.allocatedAmount);
      if (
        !item ||
        amount.lte(0) ||
        item.customerId !== command.customerId ||
        item.currencyId !== command.currencyId ||
        item.status === "REVERSED"
      ) {
        throw command.errors.invalid();
      }
    }
  }

  private validateRestore(
    items: Awaited<ReturnType<ReceivableItemService["loadTargets"]>>,
    command: SettlementCommand,
  ) {
    const byId = new Map(items.map((item) => [item.id.toString(), item]));
    for (const allocation of command.allocations) {
      const item = byId.get(allocation.receivableItemId.toString());
      const amount = new Prisma.Decimal(allocation.allocatedAmount);
      if (
        !item ||
        amount.lte(0) ||
        item.customerId !== command.customerId ||
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
    items: Awaited<ReturnType<ReceivableItemService["loadTargets"]>>,
    direction: "DECREASE" | "RESTORE",
  ) {
    const allocations = new Map(
      command.allocations.map((allocation) => [
        allocation.receivableItemId.toString(),
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
    const changed = await tx.receivableItem.updateMany({
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
    salesInvoiceId: bigint,
    invalid: () => Error,
  ) {
    const candidate = await tx.receivableItem.findFirst({
      where: { companyId, salesInvoiceId },
      select: { id: true },
    });
    if (!candidate) throw invalid();
    const locked = await lockReceivableItems(tx, companyId, [candidate.id]);
    if (locked.length !== 1) throw invalid();
    const item = await tx.receivableItem.findFirst({
      where: { id: candidate.id, companyId, salesInvoiceId },
    });
    if (!item) throw invalid();
    return item;
  }
}
