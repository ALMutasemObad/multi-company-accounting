import { Prisma, type InventoryMovementType, type PrismaClient } from "@prisma/client";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import type { ActorContext } from "../users/user-service.js";

export type InventoryMovementErrorReason =
  | "NOT_FOUND"
  | "INVALID_WAREHOUSE"
  | "WAREHOUSE_INACTIVE"
  | "INVALID_INVENTORY_ITEM"
  | "ITEM_INACTIVE"
  | "DUPLICATE_INVENTORY_ITEM"
  | "INVALID_MOVEMENT_ROUTE"
  | "INVALID_QUANTITY"
  | "INVALID_QUANTITY_PRECISION"
  | "INSUFFICIENT_STOCK"
  | "OPENING_BALANCE_EXISTS"
  | "SOURCE_MISMATCH"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class InventoryMovementError extends Error {
  constructor(public readonly reason: InventoryMovementErrorReason) {
    super(reason);
  }
}

export type InventoryMovementLineInput = {
  inventoryItemId: bigint;
  fromWarehouseId?: bigint | null | undefined;
  toWarehouseId?: bigint | null | undefined;
  quantity: string;
};

export type InventoryMovementInput = {
  movementType: InventoryMovementType;
  movementDate: string;
  description: string;
  externalReference?: string | null | undefined;
  lines: InventoryMovementLineInput[];
};

export type InventoryInvoiceDocumentType =
  | "SALES_INVOICE"
  | "SALES_CREDIT_NOTE"
  | "PURCHASE_INVOICE"
  | "PURCHASE_DEBIT_NOTE";

export type InventoryInvoiceSourceEvent = "POST" | "REVERSE";

export type InventoryInvoiceStockInput = {
  companyId: bigint;
  actorUserId: bigint;
  invoiceId: bigint;
  documentType: InventoryInvoiceDocumentType;
  sourceEvent: InventoryInvoiceSourceEvent;
  documentNumber: string;
  movementDate: string;
  warehouseId: bigint;
  lines: Array<{ inventoryItemId: bigint; quantity: string }>;
};

export interface InventoryInvoiceStockPort {
  /**
   * Runs inside the invoice command transaction after the fiscal period and
   * source document are locked, and before financial line locks.
   */
  applyInvoiceStockMovement(
    tx: Prisma.TransactionClient,
    input: InventoryInvoiceStockInput,
  ): Promise<{ movementId: string; movementNumber: string } | null>;
}

type InventoryMovementSource = {
  sourceType: InventoryInvoiceDocumentType;
  sourceId: bigint;
  sourceEvent: InventoryInvoiceSourceEvent;
  sourceDocumentNumberSnapshot: string;
};

type LockedWarehouse = {
  id: bigint;
  code: string;
  nameAr: string;
  isActive: boolean;
};

type LockedItem = {
  id: bigint;
  code: string;
  nameAr: string;
  isActive: boolean;
  unitOfMeasure: { code: string; decimalPlaces: number };
};

type BalanceEffect = {
  warehouseId: bigint;
  inventoryItemId: bigint;
  delta: Prisma.Decimal;
  opening: boolean;
};

const movementDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateDay = (value: Date) => value.toISOString().slice(0, 10);
const nullableTrimmed = (value: string | null | undefined) => value?.trim() || null;
const balanceKey = (warehouseId: bigint, inventoryItemId: bigint) =>
  `${warehouseId.toString()}:${inventoryItemId.toString()}`;

function routeFor(type: InventoryMovementType, line: InventoryMovementLineInput) {
  const fromWarehouseId = line.fromWarehouseId ?? null;
  const toWarehouseId = line.toWarehouseId ?? null;
  if (["OPENING_BALANCE", "RECEIPT", "ADJUSTMENT_IN"].includes(type)) {
    if (fromWarehouseId !== null || toWarehouseId === null) {
      throw new InventoryMovementError("INVALID_MOVEMENT_ROUTE");
    }
  } else if (["ISSUE", "ADJUSTMENT_OUT"].includes(type)) {
    if (fromWarehouseId === null || toWarehouseId !== null) {
      throw new InventoryMovementError("INVALID_MOVEMENT_ROUTE");
    }
  } else if (
    fromWarehouseId === null ||
    toWarehouseId === null ||
    fromWarehouseId === toWarehouseId
  ) {
    throw new InventoryMovementError("INVALID_MOVEMENT_ROUTE");
  }
  return { fromWarehouseId, toWarehouseId };
}

export function invoiceStockMovementType(
  documentType: InventoryInvoiceDocumentType,
  sourceEvent: InventoryInvoiceSourceEvent,
): "RECEIPT" | "ISSUE" {
  const postedType = documentType === "SALES_INVOICE" || documentType === "PURCHASE_DEBIT_NOTE"
    ? "ISSUE"
    : "RECEIPT";
  if (sourceEvent === "POST") return postedType;
  return postedType === "ISSUE" ? "RECEIPT" : "ISSUE";
}

export class InventoryMovementService implements InventoryInvoiceStockPort {
  private readonly commands: IdempotentCommandExecutor;

  constructor(private readonly prisma: PrismaClient) {
    this.commands = new IdempotentCommandExecutor(prisma);
  }

  async listBalances(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      search?: string | undefined;
      warehouseId?: bigint | undefined;
      inventoryItemId?: bigint | undefined;
      nonZero?: boolean | undefined;
    },
  ) {
    const where: Prisma.InventoryBalanceWhereInput = {
      companyId: context.companyId,
      ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
      ...(input.inventoryItemId ? { inventoryItemId: input.inventoryItemId } : {}),
      ...(input.nonZero ? { onHand: { gt: 0 } } : {}),
      ...(input.search
        ? {
            OR: [
              { warehouse: { code: { contains: input.search } } },
              { warehouse: { nameAr: { contains: input.search } } },
              { warehouse: { nameEn: { contains: input.search } } },
              { inventoryItem: { code: { contains: input.search } } },
              { inventoryItem: { nameAr: { contains: input.search } } },
              { inventoryItem: { nameEn: { contains: input.search } } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.inventoryBalance.findMany({
        where,
        include: {
          warehouse: true,
          inventoryItem: { include: { unitOfMeasure: true } },
        },
        orderBy: [{ warehouse: { code: "asc" } }, { inventoryItem: { code: "asc" } }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.inventoryBalance.count({ where }),
    }));
  }

  async listMovements(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      movementType?: InventoryMovementType | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      warehouseId?: bigint | undefined;
      inventoryItemId?: bigint | undefined;
      search?: string | undefined;
    },
  ) {
    const lineFilter: Prisma.InventoryMovementLineWhereInput = {
      ...(input.inventoryItemId ? { inventoryItemId: input.inventoryItemId } : {}),
      ...(input.warehouseId
        ? { OR: [{ fromWarehouseId: input.warehouseId }, { toWarehouseId: input.warehouseId }] }
        : {}),
    };
    const where: Prisma.InventoryMovementWhereInput = {
      companyId: context.companyId,
      ...(input.movementType ? { movementType: input.movementType } : {}),
      ...(input.dateFrom || input.dateTo
        ? {
            movementDate: {
              ...(input.dateFrom ? { gte: movementDate(input.dateFrom) } : {}),
              ...(input.dateTo ? { lte: movementDate(input.dateTo) } : {}),
            },
          }
        : {}),
      ...(input.inventoryItemId || input.warehouseId ? { lines: { some: lineFilter } } : {}),
      ...(input.search
        ? {
            OR: [
              { movementNumber: { contains: input.search } },
              { description: { contains: input.search } },
              { externalReference: { contains: input.search } },
              { lines: { some: { inventoryItemCodeSnapshot: { contains: input.search } } } },
              { lines: { some: { inventoryItemNameSnapshot: { contains: input.search } } } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.inventoryMovement.findMany({
        where,
        include: { _count: { select: { lines: true } }, createdBy: { select: { displayName: true } } },
        orderBy: [{ movementDate: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.inventoryMovement.count({ where }),
    }));
  }

  async getMovement(context: ActorContext, id: bigint) {
    const value = await this.prisma.inventoryMovement.findFirst({
      where: { id, companyId: context.companyId },
      include: {
        createdBy: { select: { displayName: true } },
        lines: { orderBy: { lineNumber: "asc" } },
      },
    });
    if (!value) throw new InventoryMovementError("NOT_FOUND");
    return value;
  }

  async createMovement(
    context: ActorContext,
    input: InventoryMovementInput,
    idempotencyKey: string,
  ) {
    this.validateInput(input);
    const fingerprint = JSON.stringify({
      ...input,
      description: input.description.trim(),
      externalReference: nullableTrimmed(input.externalReference),
      lines: input.lines.map((line) => ({
        inventoryItemId: line.inventoryItemId.toString(),
        fromWarehouseId: line.fromWarehouseId?.toString() ?? null,
        toWarehouseId: line.toWarehouseId?.toString() ?? null,
        quantity: new Prisma.Decimal(line.quantity).toFixed(6),
      })),
    });

    return this.commands.execute(
      {
        context,
        operation: "CREATE_INVENTORY_MOVEMENT",
        key: idempotencyKey,
        fingerprint,
        responseStatus: 201,
        errors: {
          mismatch: () => new InventoryMovementError("IDEMPOTENCY_MISMATCH"),
          inProgress: () => new InventoryMovementError("IDEMPOTENCY_IN_PROGRESS"),
        },
      },
      async (tx) => {
        const created = await this.createInTransaction(tx, context, input);
        return InventoryMovementService.movementJson(created);
      },
    );
  }

  async applyInvoiceStockMovement(
    tx: Prisma.TransactionClient,
    input: InventoryInvoiceStockInput,
  ): Promise<{ movementId: string; movementNumber: string } | null> {
    if (input.lines.length === 0) return null;

    const quantities = new Map<string, { inventoryItemId: bigint; quantity: Prisma.Decimal }>();
    for (const line of input.lines) {
      let quantity: Prisma.Decimal;
      try {
        quantity = new Prisma.Decimal(line.quantity);
      } catch {
        throw new InventoryMovementError("INVALID_QUANTITY");
      }
      const key = line.inventoryItemId.toString();
      const existing = quantities.get(key);
      quantities.set(key, {
        inventoryItemId: line.inventoryItemId,
        quantity: existing ? existing.quantity.plus(quantity) : quantity,
      });
    }

    const sourceType = input.documentType;
    const movementType = invoiceStockMovementType(input.documentType, input.sourceEvent);
    const existing = await tx.inventoryMovement.findUnique({
      where: {
        companyId_sourceType_sourceId_sourceEvent: {
          companyId: input.companyId,
          sourceType,
          sourceId: input.invoiceId,
          sourceEvent: input.sourceEvent,
        },
      },
      select: {
        id: true,
        movementNumber: true,
        movementType: true,
        movementDate: true,
        sourceDocumentNumberSnapshot: true,
        lines: {
          select: {
            inventoryItemId: true,
            fromWarehouseId: true,
            toWarehouseId: true,
            quantity: true,
          },
        },
      },
    });
    if (existing) {
      const existingLines = new Map(existing.lines.map((line) => [
        line.inventoryItemId.toString(),
        line,
      ]));
      const routeMatches = [...quantities.values()].every(({ inventoryItemId, quantity }) => {
        const line = existingLines.get(inventoryItemId.toString());
        return Boolean(
          line &&
          line.quantity.equals(quantity) &&
          (movementType === "ISSUE"
            ? line.fromWarehouseId === input.warehouseId && line.toWarehouseId === null
            : line.toWarehouseId === input.warehouseId && line.fromWarehouseId === null),
        );
      });
      if (
        existing.movementType !== movementType ||
        dateDay(existing.movementDate) !== input.movementDate ||
        existing.sourceDocumentNumberSnapshot !== input.documentNumber ||
        existing.lines.length !== quantities.size ||
        !routeMatches
      ) {
        throw new InventoryMovementError("SOURCE_MISMATCH");
      }
      return { movementId: existing.id.toString(), movementNumber: existing.movementNumber };
    }

    const movement: InventoryMovementInput = {
      movementType,
      movementDate: input.movementDate,
      description: input.sourceEvent === "POST"
        ? `حركة مخزون تلقائية للمستند ${input.documentNumber}`
        : `عكس حركة مخزون المستند ${input.documentNumber}`,
      externalReference: input.documentNumber,
      lines: [...quantities.values()].map(({ inventoryItemId, quantity }) => ({
        inventoryItemId,
        ...(movementType === "ISSUE"
          ? { fromWarehouseId: input.warehouseId }
          : { toWarehouseId: input.warehouseId }),
        quantity: quantity.toFixed(6),
      })),
    };
    this.validateInput(movement);
    const created = await this.createInTransaction(
      tx,
      { companyId: input.companyId, userId: input.actorUserId },
      movement,
      {
        sourceType,
        sourceId: input.invoiceId,
        sourceEvent: input.sourceEvent,
        sourceDocumentNumberSnapshot: input.documentNumber,
      },
    );
    return { movementId: created.id.toString(), movementNumber: created.movementNumber };
  }

  private async createInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: InventoryMovementInput,
    source?: InventoryMovementSource,
  ) {
    const warehouses = await this.lockWarehouses(tx, context.companyId, input.lines);
    const items = await this.lockItems(tx, context.companyId, input.lines);
    const effects = this.effects(input);
    const balances = await this.lockBalances(tx, context.companyId, effects);

    for (const line of input.lines) {
      const item = items.get(line.inventoryItemId.toString())!;
      const quantity = new Prisma.Decimal(line.quantity);
      if (quantity.decimalPlaces() > item.unitOfMeasure.decimalPlaces) {
        throw new InventoryMovementError("INVALID_QUANTITY_PRECISION");
      }
    }

    // Reserve late so unrelated warehouse/item movements are not serialized
    // behind the company sequence for the full business transaction.
    const movementNumber = await this.reserveMovementNumber(tx, context.companyId);
    const movement = await tx.inventoryMovement.create({
      data: {
        companyId: context.companyId,
        movementNumber,
        movementType: input.movementType,
        movementDate: movementDate(input.movementDate),
        description: input.description.trim(),
        externalReference: nullableTrimmed(input.externalReference),
        ...source,
        createdById: context.userId,
      },
    });

    for (const [index, line] of input.lines.entries()) {
      const route = routeFor(input.movementType, line);
      const item = items.get(line.inventoryItemId.toString())!;
      const from = route.fromWarehouseId === null
        ? null
        : warehouses.get(route.fromWarehouseId.toString())!;
      const to = route.toWarehouseId === null
        ? null
        : warehouses.get(route.toWarehouseId.toString())!;
      await tx.inventoryMovementLine.create({
        data: {
          companyId: context.companyId,
          movementId: movement.id,
          lineNumber: index + 1,
          inventoryItemId: line.inventoryItemId,
          fromWarehouseId: route.fromWarehouseId,
          toWarehouseId: route.toWarehouseId,
          quantity: new Prisma.Decimal(line.quantity),
          inventoryItemCodeSnapshot: item.code,
          inventoryItemNameSnapshot: item.nameAr,
          unitOfMeasureCodeSnapshot: item.unitOfMeasure.code,
          fromWarehouseCodeSnapshot: from?.code ?? null,
          fromWarehouseNameSnapshot: from?.nameAr ?? null,
          toWarehouseCodeSnapshot: to?.code ?? null,
          toWarehouseNameSnapshot: to?.nameAr ?? null,
        },
      });
    }

    for (const [key, effect] of [...effects.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const current = balances.get(key)!;
      if (effect.opening && current.movementCount !== 0) {
        throw new InventoryMovementError("OPENING_BALANCE_EXISTS");
      }
      const next = current.onHand.plus(effect.delta);
      if (next.isNegative()) throw new InventoryMovementError("INSUFFICIENT_STOCK");
      const changed = await tx.inventoryBalance.updateMany({
        where: { id: current.id, companyId: context.companyId, version: current.version },
        data: {
          onHand: next,
          version: { increment: 1 },
          movementCount: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new InventoryMovementError("INSUFFICIENT_STOCK");
    }

    await tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action: "INVENTORY_MOVEMENT_CREATED",
        entityType: "INVENTORY_MOVEMENT",
        entityId: movement.id.toString(),
        details: {
          movementNumber,
          movementType: input.movementType,
          lineCount: input.lines.length,
          ...(source ? {
            sourceType: source.sourceType,
            sourceId: source.sourceId.toString(),
            sourceEvent: source.sourceEvent,
          } : {}),
        },
      },
    });

    return tx.inventoryMovement.findFirstOrThrow({
      where: { id: movement.id, companyId: context.companyId },
      include: {
        createdBy: { select: { displayName: true } },
        lines: { orderBy: { lineNumber: "asc" } },
      },
    });
  }

  static balanceJson(value: {
    id: bigint;
    onHand: Prisma.Decimal;
    version: number;
    movementCount: number;
    updatedAt: Date;
    warehouse: { id: bigint; code: string; nameAr: string; nameEn: string | null };
    inventoryItem: {
      id: bigint;
      code: string;
      nameAr: string;
      nameEn: string | null;
      unitOfMeasure: { id: bigint; code: string; nameAr: string; nameEn: string | null; decimalPlaces: number };
    };
  }) {
    return {
      id: value.id.toString(),
      warehouse: {
        id: value.warehouse.id.toString(),
        code: value.warehouse.code,
        nameAr: value.warehouse.nameAr,
        nameEn: value.warehouse.nameEn,
      },
      inventoryItem: {
        id: value.inventoryItem.id.toString(),
        code: value.inventoryItem.code,
        nameAr: value.inventoryItem.nameAr,
        nameEn: value.inventoryItem.nameEn,
        unitOfMeasure: {
          id: value.inventoryItem.unitOfMeasure.id.toString(),
          code: value.inventoryItem.unitOfMeasure.code,
          nameAr: value.inventoryItem.unitOfMeasure.nameAr,
          nameEn: value.inventoryItem.unitOfMeasure.nameEn,
          decimalPlaces: value.inventoryItem.unitOfMeasure.decimalPlaces,
        },
      },
      onHand: value.onHand.toFixed(6),
      version: value.version,
      movementCount: value.movementCount,
      updatedAt: value.updatedAt.toISOString(),
    };
  }

  static movementJson(value: {
    id: bigint;
    movementNumber: string;
    movementType: InventoryMovementType;
    movementDate: Date;
    description: string;
    externalReference: string | null;
    sourceType: InventoryInvoiceDocumentType | null;
    sourceId: bigint | null;
    sourceEvent: "POST" | "REVERSE" | null;
    sourceDocumentNumberSnapshot: string | null;
    createdAt: Date;
    createdBy: { displayName: string };
    _count?: { lines: number };
    lines?: Array<{
      id: bigint;
      lineNumber: number;
      inventoryItemId: bigint;
      fromWarehouseId: bigint | null;
      toWarehouseId: bigint | null;
      quantity: Prisma.Decimal;
      inventoryItemCodeSnapshot: string;
      inventoryItemNameSnapshot: string;
      unitOfMeasureCodeSnapshot: string;
      fromWarehouseCodeSnapshot: string | null;
      fromWarehouseNameSnapshot: string | null;
      toWarehouseCodeSnapshot: string | null;
      toWarehouseNameSnapshot: string | null;
    }>;
  }) {
    return {
      id: value.id.toString(),
      movementNumber: value.movementNumber,
      movementType: value.movementType,
      movementDate: value.movementDate.toISOString().slice(0, 10),
      description: value.description,
      externalReference: value.externalReference,
      source: value.sourceType && value.sourceId && value.sourceEvent && value.sourceDocumentNumberSnapshot
        ? {
            type: value.sourceType,
            id: value.sourceId.toString(),
            event: value.sourceEvent,
            documentNumber: value.sourceDocumentNumberSnapshot,
          }
        : null,
      createdByName: value.createdBy.displayName,
      createdAt: value.createdAt.toISOString(),
      lineCount: value._count?.lines ?? value.lines?.length ?? 0,
      ...(value.lines
        ? {
            lines: value.lines.map((line) => ({
              id: line.id.toString(),
              lineNumber: line.lineNumber,
              inventoryItemId: line.inventoryItemId.toString(),
              inventoryItemCode: line.inventoryItemCodeSnapshot,
              inventoryItemName: line.inventoryItemNameSnapshot,
              unitOfMeasureCode: line.unitOfMeasureCodeSnapshot,
              fromWarehouseId: line.fromWarehouseId?.toString() ?? null,
              fromWarehouseCode: line.fromWarehouseCodeSnapshot,
              fromWarehouseName: line.fromWarehouseNameSnapshot,
              toWarehouseId: line.toWarehouseId?.toString() ?? null,
              toWarehouseCode: line.toWarehouseCodeSnapshot,
              toWarehouseName: line.toWarehouseNameSnapshot,
              quantity: line.quantity.toFixed(6),
            })),
          }
        : {}),
    };
  }

  private validateInput(input: InventoryMovementInput) {
    const items = new Set<string>();
    for (const line of input.lines) {
      const itemId = line.inventoryItemId.toString();
      if (items.has(itemId)) throw new InventoryMovementError("DUPLICATE_INVENTORY_ITEM");
      items.add(itemId);
      routeFor(input.movementType, line);
      let quantity: Prisma.Decimal;
      try {
        quantity = new Prisma.Decimal(line.quantity);
      } catch {
        throw new InventoryMovementError("INVALID_QUANTITY");
      }
      if (
        quantity.lte(0) ||
        quantity.gte("10000000000000") ||
        quantity.decimalPlaces() > 6
      ) {
        throw new InventoryMovementError("INVALID_QUANTITY");
      }
    }
  }

  private effects(input: InventoryMovementInput) {
    const effects = new Map<string, BalanceEffect>();
    const add = (
      warehouseId: bigint,
      inventoryItemId: bigint,
      delta: Prisma.Decimal,
      opening: boolean,
    ) => {
      const key = balanceKey(warehouseId, inventoryItemId);
      const current = effects.get(key);
      effects.set(key, {
        warehouseId,
        inventoryItemId,
        delta: current ? current.delta.plus(delta) : delta,
        opening: current?.opening || opening,
      });
    };
    for (const line of input.lines) {
      const route = routeFor(input.movementType, line);
      const quantity = new Prisma.Decimal(line.quantity);
      if (route.fromWarehouseId !== null) {
        add(route.fromWarehouseId, line.inventoryItemId, quantity.negated(), false);
      }
      if (route.toWarehouseId !== null) {
        add(
          route.toWarehouseId,
          line.inventoryItemId,
          quantity,
          input.movementType === "OPENING_BALANCE",
        );
      }
    }
    return effects;
  }

  private async lockWarehouses(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    lines: InventoryMovementLineInput[],
  ) {
    const ids = [...new Set(lines.flatMap((line) => [line.fromWarehouseId, line.toWarehouseId])
      .filter((value): value is bigint => value !== null && value !== undefined)
      .map(String))]
      .map(BigInt)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const result = new Map<string, LockedWarehouse>();
    for (const id of ids) {
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM warehouses
        WHERE id = ${id} AND company_id = ${companyId}
        FOR UPDATE
      `;
      if (!locked[0]) throw new InventoryMovementError("INVALID_WAREHOUSE");
      const warehouse = await tx.warehouse.findFirstOrThrow({ where: { id, companyId } });
      if (!warehouse.isActive) throw new InventoryMovementError("WAREHOUSE_INACTIVE");
      result.set(id.toString(), warehouse);
    }
    return result;
  }

  private async lockItems(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    lines: InventoryMovementLineInput[],
  ) {
    const ids = [...new Set(lines.map((line) => line.inventoryItemId.toString()))]
      .map(BigInt)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const references = await tx.inventoryItem.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, unitOfMeasureId: true },
    });
    if (references.length !== ids.length) {
      throw new InventoryMovementError("INVALID_INVENTORY_ITEM");
    }
    const unitIds = [...new Set(references.map(({ unitOfMeasureId }) => unitOfMeasureId.toString()))]
      .map(BigInt)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const lockedUnitIds = new Set<string>();
    for (const unitId of unitIds) {
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM units_of_measure
        WHERE id = ${unitId} AND company_id = ${companyId}
        FOR UPDATE
      `;
      if (!locked[0]) throw new InventoryMovementError("ITEM_INACTIVE");
      lockedUnitIds.add(unitId.toString());
    }
    const result = new Map<string, LockedItem>();
    for (const id of ids) {
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM inventory_items
        WHERE id = ${id} AND company_id = ${companyId}
        FOR UPDATE
      `;
      if (!locked[0]) throw new InventoryMovementError("INVALID_INVENTORY_ITEM");
      const item = await tx.inventoryItem.findFirstOrThrow({
        where: { id, companyId },
        include: { unitOfMeasure: true },
      });
      if (
        !lockedUnitIds.has(item.unitOfMeasureId.toString()) ||
        !item.isActive ||
        !item.unitOfMeasure.isActive
      ) {
        throw new InventoryMovementError("ITEM_INACTIVE");
      }
      result.set(id.toString(), item);
    }
    return result;
  }

  private async lockBalances(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    effects: Map<string, BalanceEffect>,
  ) {
    const result = new Map<string, { id: bigint; onHand: Prisma.Decimal; version: number; movementCount: number }>();
    for (const [key, effect] of [...effects.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      await tx.inventoryBalance.upsert({
        where: {
          companyId_warehouseId_inventoryItemId: {
            companyId,
            warehouseId: effect.warehouseId,
            inventoryItemId: effect.inventoryItemId,
          },
        },
        update: {},
        create: {
          companyId,
          warehouseId: effect.warehouseId,
          inventoryItemId: effect.inventoryItemId,
        },
      });
      await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM inventory_balances
        WHERE company_id = ${companyId}
          AND warehouse_id = ${effect.warehouseId}
          AND inventory_item_id = ${effect.inventoryItemId}
        FOR UPDATE
      `;
      const value = await tx.inventoryBalance.findUniqueOrThrow({
        where: {
          companyId_warehouseId_inventoryItemId: {
            companyId,
            warehouseId: effect.warehouseId,
            inventoryItemId: effect.inventoryItemId,
          },
        },
      });
      result.set(key, value);
    }
    return result;
  }

  private async reserveMovementNumber(tx: Prisma.TransactionClient, companyId: bigint) {
    const sequence = await tx.inventoryMovementSequence.upsert({
      where: { companyId },
      update: {},
      create: { companyId },
    });
    await tx.$executeRaw`
      UPDATE inventory_movement_sequences
      SET next_number = LAST_INSERT_ID(next_number + 1), updated_at = CURRENT_TIMESTAMP(3)
      WHERE company_id = ${companyId}
    `;
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT LAST_INSERT_ID() AS value`;
    return `${sequence.prefix}${(rows[0]!.value - 1n).toString().padStart(sequence.padding, "0")}`;
  }
}
