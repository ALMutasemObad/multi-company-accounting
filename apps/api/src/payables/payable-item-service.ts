import { Prisma, type PayableItem } from "@prisma/client";

export type PayableAllocationTarget = {
  payableItemId: bigint;
  allocatedAmount: Prisma.Decimal.Value;
  carryingBaseAmount?: Prisma.Decimal.Value | null;
};

export type PayableSettlementAllocation = {
  payableItemId: bigint;
  allocatedAmount: Prisma.Decimal;
  carryingBaseAmount: Prisma.Decimal;
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
  ): Promise<PayableSettlementAllocation[]>;
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

const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

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
    return this.persistDecrease(tx, command, items);
  }

  async reversePayment(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
  ) {
    const items = await this.loadTargets(tx, command, true);
    this.validateRestore(items, command);
    await this.persistRestore(tx, command, items);
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
      originalBaseAmount: Prisma.Decimal.Value;
    },
  ) {
    const originalAmount = new Prisma.Decimal(input.originalAmount);
    const originalBaseAmount = money(input.originalBaseAmount);
    return tx.payableItem.create({
      data: {
        ...input,
        originalAmount,
        outstandingAmount: originalAmount,
        originalBaseAmount,
        outstandingBaseAmount: originalBaseAmount,
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
      baseAmount: Prisma.Decimal.Value;
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
    const baseAmount = money(input.baseAmount);
    if (amount.lte(0) || baseAmount.lte(0) || item.status === "REVERSED") throw input.invalid();
    if (amount.gt(item.outstandingAmount)) throw input.overAllocation();
    if (
      baseAmount.gt(item.outstandingBaseAmount) ||
      (amount.equals(item.outstandingAmount) !== baseAmount.equals(item.outstandingBaseAmount))
    ) {
      throw input.invalid();
    }
    await this.updateItem(
      tx,
      item,
      item.outstandingAmount.sub(amount),
      item.outstandingBaseAmount.sub(baseAmount),
      input.conflict,
    );
  }

  async reverseDebit(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      sourceInvoiceId: bigint;
      amount: Prisma.Decimal.Value;
      baseAmount: Prisma.Decimal.Value;
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
    const restoredBase = item.outstandingBaseAmount.add(input.baseAmount);
    if (
      item.status === "REVERSED" ||
      restored.gt(item.originalAmount) ||
      restoredBase.gt(item.originalBaseAmount) ||
      (restored.equals(item.originalAmount) !== restoredBase.equals(item.originalBaseAmount))
    )
      throw input.invalid();
    await this.updateItem(tx, item, restored, restoredBase, input.conflict);
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
        outstandingBaseAmount: item.originalBaseAmount,
      },
      data: {
        outstandingAmount: new Prisma.Decimal(0),
        outstandingBaseAmount: new Prisma.Decimal(0),
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
    let items = await tx.payableItem.findMany({
      where: { companyId: command.companyId, id: { in: ids } },
      orderBy: { id: "asc" },
    });
    if (items.length !== ids.length) throw command.errors.invalid();
    if (lock) {
      const initialized: PayableItem[] = [];
      for (const item of items) {
        initialized.push(await this.initializeBaseAmounts(tx, item, command.errors.conflict));
      }
      items = initialized;
    }
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
      const carryingBaseAmount = allocation.carryingBaseAmount == null
        ? null
        : money(allocation.carryingBaseAmount);
      if (
        !item ||
        amount.lte(0) ||
        !carryingBaseAmount ||
        carryingBaseAmount.lte(0) ||
        item.supplierId !== command.supplierId ||
        item.currencyId !== command.currencyId ||
        item.status === "REVERSED" ||
        item.outstandingAmount.add(amount).gt(item.originalAmount) ||
        item.outstandingBaseAmount.add(carryingBaseAmount).gt(item.originalBaseAmount) ||
        (item.outstandingAmount.add(amount).equals(item.originalAmount) !==
          item.outstandingBaseAmount.add(carryingBaseAmount).equals(item.originalBaseAmount))
      ) {
        throw command.errors.invalid();
      }
    }
  }

  private async persistDecrease(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
    items: Awaited<ReturnType<PayableItemService["loadTargets"]>>,
  ) {
    const allocations = new Map(
      command.allocations.map((allocation) => [
        allocation.payableItemId.toString(),
        new Prisma.Decimal(allocation.allocatedAmount),
      ]),
    );
    const results: PayableSettlementAllocation[] = [];
    for (const item of items) {
      const amount = allocations.get(item.id.toString())!;
      const carryingBaseAmount = amount.equals(item.outstandingAmount)
        ? item.outstandingBaseAmount
        : money(item.outstandingBaseAmount.mul(amount).div(item.outstandingAmount));
      if (
        carryingBaseAmount.lte(0) ||
        carryingBaseAmount.gt(item.outstandingBaseAmount) ||
        (!amount.equals(item.outstandingAmount) && carryingBaseAmount.equals(item.outstandingBaseAmount))
      ) {
        throw command.errors.invalid();
      }
      await this.updateItem(
        tx,
        item,
        item.outstandingAmount.sub(amount),
        item.outstandingBaseAmount.sub(carryingBaseAmount),
        command.errors.conflict,
      );
      results.push({
        payableItemId: item.id,
        allocatedAmount: amount,
        carryingBaseAmount,
      });
    }
    return results;
  }

  private async persistRestore(
    tx: Prisma.TransactionClient,
    command: SettlementCommand,
    items: Awaited<ReturnType<PayableItemService["loadTargets"]>>,
  ) {
    const allocations = new Map(command.allocations.map((allocation) => [
      allocation.payableItemId.toString(),
      {
        amount: new Prisma.Decimal(allocation.allocatedAmount),
        carryingBaseAmount: money(allocation.carryingBaseAmount!),
      },
    ]));
    for (const item of items) {
      const allocation = allocations.get(item.id.toString())!;
      await this.updateItem(
        tx,
        item,
        item.outstandingAmount.add(allocation.amount),
        item.outstandingBaseAmount.add(allocation.carryingBaseAmount),
        command.errors.conflict,
      );
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
      originalBaseAmount: Prisma.Decimal;
    },
    outstandingAmount: Prisma.Decimal,
    outstandingBaseAmount: Prisma.Decimal,
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
        outstandingBaseAmount,
        status: statusFor(outstandingAmount, item.originalAmount),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw conflict();
  }

  private async initializeBaseAmounts(
    tx: Prisma.TransactionClient,
    item: PayableItem,
    conflict: () => Error,
  ): Promise<PayableItem> {
    const originalIsZero = item.originalBaseAmount.equals(0);
    const outstandingIsZero = item.outstandingBaseAmount.equals(0);
    if (!originalIsZero) return item;
    if (!outstandingIsZero || item.originalAmount.lte(0)) throw conflict();

    const invoice = await tx.purchaseInvoice.findFirst({
      where: { id: item.purchaseInvoiceId, companyId: item.companyId },
      select: { baseTotal: true },
    });
    const originalBaseAmount = invoice ? money(invoice.baseTotal) : new Prisma.Decimal(0);
    if (originalBaseAmount.lte(0)) throw conflict();
    const outstandingBaseAmount = item.outstandingAmount.equals(0)
      ? money(0)
      : item.outstandingAmount.equals(item.originalAmount)
        ? originalBaseAmount
        : money(originalBaseAmount.mul(item.outstandingAmount).div(item.originalAmount));
    if (
      outstandingBaseAmount.lt(0) ||
      outstandingBaseAmount.gt(originalBaseAmount) ||
      (item.status === "PARTIAL" && (outstandingBaseAmount.lte(0) || outstandingBaseAmount.gte(originalBaseAmount)))
    ) {
      throw conflict();
    }
    const changed = await tx.payableItem.updateMany({
      where: {
        id: item.id,
        companyId: item.companyId,
        version: item.version,
        originalBaseAmount: new Prisma.Decimal(0),
        outstandingBaseAmount: new Prisma.Decimal(0),
      },
      data: {
        originalBaseAmount,
        outstandingBaseAmount,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw conflict();
    return {
      ...item,
      originalBaseAmount,
      outstandingBaseAmount,
      version: item.version + 1,
    };
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
    return this.initializeBaseAmounts(tx, item, invalid);
  }
}
