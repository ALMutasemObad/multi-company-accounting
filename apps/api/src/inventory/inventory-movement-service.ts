import { Prisma, type InventoryMovementType, type PrismaClient } from "@prisma/client";
import {
  lockFiscalPeriod,
  PostingEngine,
  type PostingEntryPlan,
  type PostingFailureReason,
} from "../core-accounting/posting-engine.js";
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
  | "INVALID_UNIT_COST"
  | "INVALID_VALUATION_REASON"
  | "INVALID_REVERSAL_REASON"
  | "INSUFFICIENT_STOCK"
  | "INVENTORY_VALUATION_REQUIRED"
  | "INSUFFICIENT_INVENTORY_VALUE"
  | "INVENTORY_VALUE_MISMATCH"
  | "INVENTORY_ACCOUNTING_NOT_CONFIGURED"
  | "NON_ZERO_COST_REQUIRED"
  | "OPENING_BALANCE_EXISTS"
  | "VALUATION_ALREADY_INITIALIZED"
  | "VERSION_CONFLICT"
  | "SOURCE_MISMATCH"
  | "GENERATED_MOVEMENT_NOT_REVERSIBLE"
  | "INVALID_STATE"
  | "PERIOD_CLOSED"
  | "DATE_OUTSIDE_PERIOD"
  | "INVALID_ACCOUNT"
  | "INVALID_COST_CENTER"
  | "INVALID_CURRENCY"
  | "INVALID_LINE"
  | "UNBALANCED"
  | "ALREADY_REVERSED"
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
  unitCostBase?: string | null | undefined;
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
  sourceInvoiceId?: bigint | null | undefined;
  lines: Array<{
    inventoryItemId: bigint;
    quantity: string;
    baseNetAmount?: string | null | undefined;
  }>;
};

export type InventoryInvoiceStockResult = {
  movementId: string;
  movementNumber: string;
  baseCurrencyId: bigint;
  inventoryAccountId: bigint;
  costOfGoodsSoldAccountId: bigint;
  totalCostBase: Prisma.Decimal;
  lines: Array<{
    inventoryItemId: bigint;
    quantity: Prisma.Decimal;
    unitCostBase: Prisma.Decimal;
    totalCostBase: Prisma.Decimal;
    isCostInitialized: boolean;
  }>;
};

export interface InventoryInvoiceStockPort {
  /**
   * Runs inside the invoice command transaction after the fiscal period and
   * source document are locked, and before financial line locks.
   */
  applyInvoiceStockMovement(
    tx: Prisma.TransactionClient,
    input: InventoryInvoiceStockInput,
  ): Promise<InventoryInvoiceStockResult | null>;
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

type LockedBalance = {
  id: bigint;
  warehouseId: bigint;
  inventoryItemId: bigint;
  onHand: Prisma.Decimal;
  inventoryValueBase: Prisma.Decimal;
  averageUnitCostBase: Prisma.Decimal;
  isValuationInitialized: boolean;
  version: number;
  movementCount: number;
};

type CostedMovementLine = {
  unitCostBase: Prisma.Decimal;
  totalCostBase: Prisma.Decimal;
};

const movementDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateDay = (value: Date) => value.toISOString().slice(0, 10);
const nullableTrimmed = (value: string | null | undefined) => value?.trim() || null;
const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
const unitCost = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
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
  private readonly posting = new PostingEngine();

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
        include: {
          _count: { select: { lines: true } },
          createdBy: { select: { displayName: true } },
          accountingDocument: { select: { documentNumber: true, status: true, version: true } },
          offsetAccount: { select: { id: true, code: true, nameAr: true } },
        },
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
        accountingDocument: { select: { documentNumber: true, status: true, version: true } },
        offsetAccount: { select: { id: true, code: true, nameAr: true } },
        reversalOfMovement: { select: { id: true, movementNumber: true } },
        reversedByMovement: { select: { id: true, movementNumber: true } },
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
    this.validateInput(input, true);
    const fingerprint = JSON.stringify({
      ...input,
      description: input.description.trim(),
      externalReference: nullableTrimmed(input.externalReference),
      lines: input.lines.map((line) => ({
        inventoryItemId: line.inventoryItemId.toString(),
        fromWarehouseId: line.fromWarehouseId?.toString() ?? null,
        toWarehouseId: line.toWarehouseId?.toString() ?? null,
        quantity: new Prisma.Decimal(line.quantity).toFixed(6),
        unitCostBase: line.unitCostBase == null
          ? null
          : unitCost(line.unitCostBase).toFixed(8),
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
        if (input.movementType === "TRANSFER") {
          return InventoryMovementService.movementJson(
            await this.createInTransaction(tx, context, input),
          );
        }
        return InventoryMovementService.movementJson(
          await this.createAccountedManualMovement(tx, context, input),
        );
      },
    );
  }

  async reverseMovement(
    context: ActorContext,
    id: bigint,
    input: { version: number; reversalDate: string; reason: string },
    idempotencyKey: string,
  ) {
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new InventoryMovementError("INVALID_REVERSAL_REASON");
    }
    const fingerprint = JSON.stringify({
      id: id.toString(),
      version: input.version,
      reversalDate: input.reversalDate,
      reason,
    });
    return this.commands.execute(
      {
        context,
        operation: "REVERSE_INVENTORY_MOVEMENT",
        key: idempotencyKey,
        fingerprint,
        errors: {
          mismatch: () => new InventoryMovementError("IDEMPOTENCY_MISMATCH"),
          inProgress: () => new InventoryMovementError("IDEMPOTENCY_IN_PROGRESS"),
        },
      },
      async (tx) => {
        const original = await tx.inventoryMovement.findFirst({
          where: { id, companyId: context.companyId },
          include: {
            accountingDocument: true,
            lines: { orderBy: { lineNumber: "asc" } },
          },
        });
        if (!original) throw new InventoryMovementError("NOT_FOUND");
        this.assertManualMovementReversible(original, input.version);
        let reversalMovementId: bigint;

        if (original.accountingDocument) {
          let createdId = 0n;
          const result = await this.posting.reverse(tx, {
            companyId: context.companyId,
            documentId: original.accountingDocument.id,
            expectedVersion: original.accountingDocument.version,
            actorUserId: context.userId,
            reversalDate: movementDate(input.reversalDate),
            description: () => `عكس ${original.movementNumber}: ${reason}`,
            reserveDocumentNumber: (sequenceTx, period, documentType) =>
              this.reserveDocumentNumberInTransaction(
                sequenceTx,
                context.companyId,
                period.fiscalYearId,
                documentType,
              ),
            beforeLedger: async (postingTx) => {
              const lockedOriginal = await this.lockManualMovement(
                postingTx,
                context.companyId,
                original.id,
                input.version,
              );
              const reversalInput = this.reversalInput(
                lockedOriginal,
                input.reversalDate,
                reason,
              );
              const exactCosts = new Map(lockedOriginal.lines.map((line) => [
                line.inventoryItemId.toString(),
                line.totalCostBase,
              ]));
              const created = await this.createInTransaction(
                postingTx,
                context,
                reversalInput,
                undefined,
                exactCosts,
                original.id,
              );
              createdId = created.id;
            },
            error: (postingReason) => this.postingError(postingReason),
          });
          if (createdId === 0n) throw new InventoryMovementError("INVALID_STATE");
          reversalMovementId = createdId;
          await tx.inventoryMovement.update({
            where: { id: reversalMovementId },
            data: {
              accountingDocumentId: result.reversalDocument.id,
              offsetAccountId: original.offsetAccountId,
            },
          });
        } else {
          const lockedOriginal = await this.lockManualMovement(
            tx,
            context.companyId,
            original.id,
            input.version,
          );
          const reversalInput = this.reversalInput(
            lockedOriginal,
            input.reversalDate,
            reason,
          );
          const exactCosts = new Map(lockedOriginal.lines.map((line) => [
            line.inventoryItemId.toString(),
            line.totalCostBase,
          ]));
          const created = await this.createInTransaction(
            tx,
            context,
            reversalInput,
            undefined,
            exactCosts,
            original.id,
          );
          reversalMovementId = created.id;
        }

        const changed = await tx.inventoryMovement.updateMany({
          where: {
            id: original.id,
            companyId: context.companyId,
            status: "POSTED",
            version: input.version,
          },
          data: { status: "REVERSED", version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new InventoryMovementError("VERSION_CONFLICT");
        await tx.auditLog.create({
          data: {
            companyId: context.companyId,
            actorUserId: context.userId,
            action: "INVENTORY_MOVEMENT_REVERSED",
            entityType: "INVENTORY_MOVEMENT",
            entityId: original.id.toString(),
            details: {
              reversalMovementId: reversalMovementId.toString(),
              reason,
            },
          },
        });
        return {
          original: InventoryMovementService.movementJson(
            await this.getMovementInTransaction(tx, context.companyId, original.id),
          ),
          reversal: InventoryMovementService.movementJson(
            await this.getMovementInTransaction(tx, context.companyId, reversalMovementId),
          ),
        };
      },
    );
  }

  private async createAccountedManualMovement(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: InventoryMovementInput,
  ) {
    const documentDate = movementDate(input.movementDate);
    const period = await tx.fiscalPeriod.findFirst({
      where: {
        companyId: context.companyId,
        startDate: { lte: documentDate },
        endDate: { gte: documentDate },
      },
    });
    if (!period || period.status === "CLOSED") {
      throw new InventoryMovementError("PERIOD_CLOSED");
    }
    if (!(await lockFiscalPeriod(tx, context.companyId, period.id))) {
      throw new InventoryMovementError("PERIOD_CLOSED");
    }
    const lockedPeriod = await tx.fiscalPeriod.findFirst({
      where: { id: period.id, companyId: context.companyId },
    });
    if (!lockedPeriod || lockedPeriod.status === "CLOSED") {
      throw new InventoryMovementError("PERIOD_CLOSED");
    }
    const documentNumber = await this.reserveDocumentNumberInTransaction(
      tx,
      context.companyId,
      lockedPeriod.fiscalYearId,
      "INVENTORY_ADJUSTMENT",
    );
    const document = await tx.accountingDocument.create({
      data: {
        companyId: context.companyId,
        fiscalPeriodId: lockedPeriod.id,
        documentType: "INVENTORY_ADJUSTMENT",
        documentNumber,
        documentDate,
        description: input.description.trim(),
        createdBy: context.userId,
      },
    });
    const entries: PostingEntryPlan[] = [{
      entryNumber: 1,
      entryDate: documentDate,
      description: input.description.trim(),
      lines: [],
    }];
    let movementId = 0n;
    let offsetAccountId = 0n;
    await this.posting.postPlan(tx, {
      companyId: context.companyId,
      documentId: document.id,
      expectedVersion: document.version,
      actorUserId: context.userId,
      entries,
      beforeLedger: async (postingTx) => {
        const created = await this.createInTransaction(postingTx, context, input);
        const totalCostBase = money(created.lines.reduce(
          (sum, line) => sum.add(line.totalCostBase),
          new Prisma.Decimal(0),
        ));
        if (!totalCostBase.gt(0)) {
          throw new InventoryMovementError("NON_ZERO_COST_REQUIRED");
        }
        const policy = await this.resolveManualAccountingPolicy(
          postingTx,
          context.companyId,
          input.movementType,
        );
        const inbound = ["OPENING_BALANCE", "RECEIPT", "ADJUSTMENT_IN"]
          .includes(input.movementType);
        entries[0]!.lines = [
          {
            lineNumber: 1,
            accountId: inbound ? policy.inventoryAccountId : policy.offsetAccountId,
            description: input.description.trim(),
            currencyId: policy.baseCurrencyId,
            exchangeRate: 1,
            debitAmount: totalCostBase,
            creditAmount: 0,
            baseDebitAmount: totalCostBase,
            baseCreditAmount: 0,
          },
          {
            lineNumber: 2,
            accountId: inbound ? policy.offsetAccountId : policy.inventoryAccountId,
            description: input.description.trim(),
            currencyId: policy.baseCurrencyId,
            exchangeRate: 1,
            debitAmount: 0,
            creditAmount: totalCostBase,
            baseDebitAmount: 0,
            baseCreditAmount: totalCostBase,
          },
        ];
        movementId = created.id;
        offsetAccountId = policy.offsetAccountId;
      },
      error: (postingReason) => this.postingError(postingReason),
    });
    if (movementId === 0n || offsetAccountId === 0n) {
      throw new InventoryMovementError("INVALID_STATE");
    }
    await tx.inventoryMovement.update({
      where: { id: movementId },
      data: { accountingDocumentId: document.id, offsetAccountId },
    });
    await tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action: "INVENTORY_MOVEMENT_ACCOUNTING_POSTED",
        entityType: "INVENTORY_MOVEMENT",
        entityId: movementId.toString(),
        details: { accountingDocumentId: document.id.toString(), documentNumber },
      },
    });
    return this.getMovementInTransaction(tx, context.companyId, movementId);
  }

  async initializeBalanceValuation(
    context: ActorContext,
    balanceId: bigint,
    input: { version: number; unitCostBase: string; reason: string },
    idempotencyKey: string,
  ) {
    const parsedUnitCost = this.parseUnitCost(input.unitCostBase);
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new InventoryMovementError("INVALID_VALUATION_REASON");
    }
    const fingerprint = JSON.stringify({
      balanceId: balanceId.toString(),
      version: input.version,
      unitCostBase: parsedUnitCost.toFixed(8),
      reason,
    });
    return this.commands.execute(
      {
        context,
        operation: "INITIALIZE_INVENTORY_VALUATION",
        key: idempotencyKey,
        fingerprint,
        errors: {
          mismatch: () => new InventoryMovementError("IDEMPOTENCY_MISMATCH"),
          inProgress: () => new InventoryMovementError("IDEMPOTENCY_IN_PROGRESS"),
        },
      },
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT id FROM inventory_balances
          WHERE id = ${balanceId} AND company_id = ${context.companyId}
          FOR UPDATE
        `;
        if (!locked[0]) throw new InventoryMovementError("NOT_FOUND");
        const balance = await tx.inventoryBalance.findFirst({
          where: { id: balanceId, companyId: context.companyId },
        });
        if (!balance) throw new InventoryMovementError("NOT_FOUND");
        if (balance.version !== input.version) {
          throw new InventoryMovementError("VERSION_CONFLICT");
        }
        if (balance.isValuationInitialized) {
          throw new InventoryMovementError("VALUATION_ALREADY_INITIALIZED");
        }
        const totalValueBase = money(balance.onHand.mul(parsedUnitCost));
        const changed = await tx.inventoryBalance.updateMany({
          where: {
            id: balance.id,
            companyId: context.companyId,
            version: input.version,
            isValuationInitialized: false,
          },
          data: {
            inventoryValueBase: totalValueBase,
            averageUnitCostBase: parsedUnitCost,
            isValuationInitialized: true,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new InventoryMovementError("VERSION_CONFLICT");
        const initialization = await tx.inventoryValuationInitialization.create({
          data: {
            companyId: context.companyId,
            inventoryBalanceId: balance.id,
            quantitySnapshot: balance.onHand,
            unitCostBase: parsedUnitCost,
            totalValueBase,
            reason,
            createdById: context.userId,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: context.companyId,
            actorUserId: context.userId,
            action: "INVENTORY_VALUATION_INITIALIZED",
            entityType: "INVENTORY_BALANCE",
            entityId: balance.id.toString(),
            details: {
              initializationId: initialization.id.toString(),
              quantity: balance.onHand.toFixed(6),
              unitCostBase: parsedUnitCost.toFixed(8),
              totalValueBase: totalValueBase.toFixed(4),
              reason,
            },
          },
        });
        const value = await tx.inventoryBalance.findFirstOrThrow({
          where: { id: balance.id, companyId: context.companyId },
          include: {
            warehouse: true,
            inventoryItem: { include: { unitOfMeasure: true } },
          },
        });
        return InventoryMovementService.balanceJson(value);
      },
    );
  }

  async applyInvoiceStockMovement(
    tx: Prisma.TransactionClient,
    input: InventoryInvoiceStockInput,
  ): Promise<InventoryInvoiceStockResult | null> {
    if (input.lines.length === 0) return null;

    const quantities = new Map<string, {
      inventoryItemId: bigint;
      quantity: Prisma.Decimal;
      baseNetAmount: Prisma.Decimal;
      hasBaseNetAmount: boolean;
    }>();
    for (const line of input.lines) {
      let quantity: Prisma.Decimal;
      let baseNetAmount: Prisma.Decimal;
      try {
        quantity = new Prisma.Decimal(line.quantity);
        baseNetAmount = new Prisma.Decimal(line.baseNetAmount ?? 0);
      } catch {
        throw new InventoryMovementError("INVALID_QUANTITY");
      }
      const key = line.inventoryItemId.toString();
      const existing = quantities.get(key);
      quantities.set(key, {
        inventoryItemId: line.inventoryItemId,
        quantity: existing ? existing.quantity.plus(quantity) : quantity,
        baseNetAmount: existing
          ? existing.baseNetAmount.plus(baseNetAmount)
          : baseNetAmount,
        hasBaseNetAmount: Boolean(line.baseNetAmount != null) &&
          (existing?.hasBaseNetAmount ?? true),
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
            unitCostBase: true,
            totalCostBase: true,
            isCostInitialized: true,
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
      return this.invoiceValuationResult(
        await this.resolveAccountingPolicy(tx, input.companyId),
        existing,
      );
    }

    let reversalOfMovementId: bigint | undefined;
    let reversalOfMovementVersion: number | undefined;
    if (input.sourceEvent === "REVERSE") {
      const candidate = await tx.inventoryMovement.findUnique({
        where: {
          companyId_sourceType_sourceId_sourceEvent: {
            companyId: input.companyId,
            sourceType,
            sourceId: input.invoiceId,
            sourceEvent: "POST",
          },
        },
        select: { id: true },
      });
      if (!candidate) throw new InventoryMovementError("SOURCE_MISMATCH");
      await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM inventory_movements
        WHERE id = ${candidate.id} AND company_id = ${input.companyId}
        FOR UPDATE
      `;
      const original = await tx.inventoryMovement.findFirst({
        where: { id: candidate.id, companyId: input.companyId },
        select: { id: true, status: true, version: true },
      });
      if (!original || original.status !== "POSTED") {
        throw new InventoryMovementError("SOURCE_MISMATCH");
      }
      reversalOfMovementId = original.id;
      reversalOfMovementVersion = original.version;
    }

    const exactCosts = await this.resolveInvoiceExactCosts(
      tx,
      input,
      quantities,
    );

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
        ...(movementType === "RECEIPT" && exactCosts.has(inventoryItemId.toString())
          ? {
              unitCostBase: unitCost(
                exactCosts.get(inventoryItemId.toString())!.div(quantity),
              ).toFixed(8),
            }
          : {}),
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
      exactCosts,
      reversalOfMovementId,
    );
    if (reversalOfMovementId !== undefined && reversalOfMovementVersion !== undefined) {
      const changed = await tx.inventoryMovement.updateMany({
        where: {
          id: reversalOfMovementId,
          companyId: input.companyId,
          status: "POSTED",
          version: reversalOfMovementVersion,
        },
        data: { status: "REVERSED", version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new InventoryMovementError("SOURCE_MISMATCH");
    }
    return this.invoiceValuationResult(
      await this.resolveAccountingPolicy(tx, input.companyId),
      created,
    );
  }

  private async createInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: InventoryMovementInput,
    source?: InventoryMovementSource,
    exactCosts = new Map<string, Prisma.Decimal>(),
    reversalOfMovementId?: bigint,
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

    const valueEffects = new Map<string, Prisma.Decimal>();
    const addValueEffect = (key: string, amount: Prisma.Decimal) => {
      valueEffects.set(key, money((valueEffects.get(key) ?? new Prisma.Decimal(0)).add(amount)));
    };
    const costedLines: CostedMovementLine[] = input.lines.map((line) => {
      const route = routeFor(input.movementType, line);
      const quantity = new Prisma.Decimal(line.quantity);
      const exactCost = exactCosts.get(line.inventoryItemId.toString());
      let totalCostBase: Prisma.Decimal;
      if (route.fromWarehouseId !== null) {
        const sourceBalance = balances.get(balanceKey(route.fromWarehouseId, line.inventoryItemId))!;
        if (!sourceBalance.isValuationInitialized) {
          throw new InventoryMovementError("INVENTORY_VALUATION_REQUIRED");
        }
        if (quantity.gt(sourceBalance.onHand)) {
          throw new InventoryMovementError("INSUFFICIENT_STOCK");
        }
        totalCostBase = exactCost ?? (
          quantity.equals(sourceBalance.onHand)
            ? sourceBalance.inventoryValueBase
            : money(quantity.mul(sourceBalance.averageUnitCostBase))
        );
        if (totalCostBase.gt(sourceBalance.inventoryValueBase)) {
          throw new InventoryMovementError("INSUFFICIENT_INVENTORY_VALUE");
        }
        addValueEffect(
          balanceKey(route.fromWarehouseId, line.inventoryItemId),
          totalCostBase.negated(),
        );
      } else {
        const destinationBalance = balances.get(balanceKey(route.toWarehouseId!, line.inventoryItemId))!;
        if (!destinationBalance.isValuationInitialized && destinationBalance.onHand.gt(0)) {
          throw new InventoryMovementError("INVENTORY_VALUATION_REQUIRED");
        }
        totalCostBase = exactCost ?? money(quantity.mul(this.parseUnitCost(line.unitCostBase)));
      }
      if (route.toWarehouseId !== null) {
        const destinationBalance = balances.get(balanceKey(route.toWarehouseId, line.inventoryItemId))!;
        if (!destinationBalance.isValuationInitialized && destinationBalance.onHand.gt(0)) {
          throw new InventoryMovementError("INVENTORY_VALUATION_REQUIRED");
        }
        addValueEffect(
          balanceKey(route.toWarehouseId, line.inventoryItemId),
          totalCostBase,
        );
      }
      return {
        totalCostBase,
        unitCostBase: unitCost(totalCostBase.div(quantity)),
      };
    });

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
        ...(reversalOfMovementId ? { reversalOfMovementId } : {}),
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
          unitCostBase: costedLines[index]!.unitCostBase,
          totalCostBase: costedLines[index]!.totalCostBase,
          isCostInitialized: true,
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
      const nextValue = money(current.inventoryValueBase.add(valueEffects.get(key) ?? 0));
      if (nextValue.isNegative()) {
        throw new InventoryMovementError("INSUFFICIENT_INVENTORY_VALUE");
      }
      if (next.isZero() && !nextValue.isZero()) {
        throw new InventoryMovementError("INVENTORY_VALUE_MISMATCH");
      }
      const nextAverage = next.isZero() ? unitCost(0) : unitCost(nextValue.div(next));
      const changed = await tx.inventoryBalance.updateMany({
        where: { id: current.id, companyId: context.companyId, version: current.version },
        data: {
          onHand: next,
          inventoryValueBase: nextValue,
          averageUnitCostBase: nextAverage,
          isValuationInitialized: true,
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
        accountingDocument: { select: { documentNumber: true, status: true, version: true } },
        offsetAccount: { select: { id: true, code: true, nameAr: true } },
        reversalOfMovement: { select: { id: true, movementNumber: true } },
        reversedByMovement: { select: { id: true, movementNumber: true } },
        lines: { orderBy: { lineNumber: "asc" } },
      },
    });
  }

  static balanceJson(value: {
    id: bigint;
    onHand: Prisma.Decimal;
    inventoryValueBase: Prisma.Decimal;
    averageUnitCostBase: Prisma.Decimal;
    isValuationInitialized: boolean;
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
      inventoryValueBase: value.inventoryValueBase.toFixed(4),
      averageUnitCostBase: value.averageUnitCostBase.toFixed(8),
      isValuationInitialized: value.isValuationInitialized,
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
    status?: "POSTED" | "REVERSED";
    version?: number;
    createdAt: Date;
    createdBy: { displayName: string };
    accountingDocument?: {
      documentNumber: string;
      status: "DRAFT" | "POSTED" | "REVERSED" | "CANCELLED";
      version: number;
    } | null;
    offsetAccount?: { id: bigint; code: string; nameAr: string } | null;
    reversalOfMovement?: { id: bigint; movementNumber: string } | null;
    reversedByMovement?: { id: bigint; movementNumber: string } | null;
    _count?: { lines: number };
    lines?: Array<{
      id: bigint;
      lineNumber: number;
      inventoryItemId: bigint;
      fromWarehouseId: bigint | null;
      toWarehouseId: bigint | null;
      quantity: Prisma.Decimal;
      unitCostBase: Prisma.Decimal;
      totalCostBase: Prisma.Decimal;
      isCostInitialized: boolean;
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
      status: value.status ?? "POSTED",
      version: value.version ?? 0,
      source: value.sourceType && value.sourceId && value.sourceEvent && value.sourceDocumentNumberSnapshot
        ? {
            type: value.sourceType,
            id: value.sourceId.toString(),
            event: value.sourceEvent,
            documentNumber: value.sourceDocumentNumberSnapshot,
          }
        : null,
      accounting: value.accountingDocument
        ? {
            documentNumber: value.accountingDocument.documentNumber,
            status: value.accountingDocument.status,
            version: value.accountingDocument.version,
            offsetAccount: value.offsetAccount
              ? {
                  id: value.offsetAccount.id.toString(),
                  code: value.offsetAccount.code,
                  nameAr: value.offsetAccount.nameAr,
                }
              : null,
          }
        : null,
      reversalOf: value.reversalOfMovement
        ? {
            id: value.reversalOfMovement.id.toString(),
            movementNumber: value.reversalOfMovement.movementNumber,
          }
        : null,
      reversedBy: value.reversedByMovement
        ? {
            id: value.reversedByMovement.id.toString(),
            movementNumber: value.reversedByMovement.movementNumber,
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
              unitCostBase: line.unitCostBase.toFixed(8),
              totalCostBase: line.totalCostBase.toFixed(4),
              isCostInitialized: line.isCostInitialized,
            })),
          }
        : {}),
    };
  }

  private validateInput(input: InventoryMovementInput, requirePositiveInboundCost = false) {
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
      if (["OPENING_BALANCE", "RECEIPT", "ADJUSTMENT_IN"].includes(input.movementType)) {
        const parsedUnitCost = this.parseUnitCost(line.unitCostBase);
        if (requirePositiveInboundCost && !parsedUnitCost.gt(0)) {
          throw new InventoryMovementError("NON_ZERO_COST_REQUIRED");
        }
      } else if (line.unitCostBase != null) {
        throw new InventoryMovementError("INVALID_UNIT_COST");
      }
    }
  }

  private parseUnitCost(value: string | null | undefined) {
    let parsed: Prisma.Decimal;
    try {
      parsed = new Prisma.Decimal(value ?? "");
    } catch {
      throw new InventoryMovementError("INVALID_UNIT_COST");
    }
    if (
      parsed.lt(0) ||
      parsed.gte("100000000000") ||
      parsed.decimalPlaces() > 8
    ) {
      throw new InventoryMovementError("INVALID_UNIT_COST");
    }
    return unitCost(parsed);
  }

  private assertManualMovementReversible(
    movement: {
      sourceType: InventoryInvoiceDocumentType | null;
      reversalOfMovementId: bigint | null;
      status: "POSTED" | "REVERSED";
      version: number;
    },
    expectedVersion: number,
  ) {
    if (movement.sourceType !== null) {
      throw new InventoryMovementError("GENERATED_MOVEMENT_NOT_REVERSIBLE");
    }
    if (movement.reversalOfMovementId !== null) {
      throw new InventoryMovementError("INVALID_STATE");
    }
    if (movement.status === "REVERSED") {
      throw new InventoryMovementError("ALREADY_REVERSED");
    }
    if (movement.status !== "POSTED") {
      throw new InventoryMovementError("INVALID_STATE");
    }
    if (movement.version !== expectedVersion) {
      throw new InventoryMovementError("VERSION_CONFLICT");
    }
  }

  private async lockManualMovement(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    id: bigint,
    expectedVersion: number,
  ) {
    const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM inventory_movements
      WHERE id = ${id} AND company_id = ${companyId}
      FOR UPDATE
    `;
    if (!locked[0]) throw new InventoryMovementError("NOT_FOUND");
    const movement = await tx.inventoryMovement.findFirst({
      where: { id, companyId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!movement) throw new InventoryMovementError("NOT_FOUND");
    this.assertManualMovementReversible(movement, expectedVersion);
    return movement;
  }

  private reversalInput(
    original: {
      movementNumber: string;
      movementType: InventoryMovementType;
      lines: Array<{
        inventoryItemId: bigint;
        fromWarehouseId: bigint | null;
        toWarehouseId: bigint | null;
        quantity: Prisma.Decimal;
        unitCostBase: Prisma.Decimal;
      }>;
    },
    reversalDate: string,
    reason: string,
  ): InventoryMovementInput {
    const wasInbound = ["OPENING_BALANCE", "RECEIPT", "ADJUSTMENT_IN"]
      .includes(original.movementType);
    const movementType: InventoryMovementType = original.movementType === "TRANSFER"
      ? "TRANSFER"
      : wasInbound
        ? "ADJUSTMENT_OUT"
        : "ADJUSTMENT_IN";
    return {
      movementType,
      movementDate: reversalDate,
      description: `عكس ${original.movementNumber}: ${reason}`,
      externalReference: original.movementNumber,
      lines: original.lines.map((line) => ({
        inventoryItemId: line.inventoryItemId,
        fromWarehouseId: line.toWarehouseId,
        toWarehouseId: line.fromWarehouseId,
        quantity: line.quantity.toFixed(6),
        ...(movementType === "ADJUSTMENT_IN"
          ? { unitCostBase: line.unitCostBase.toFixed(8) }
          : {}),
      })),
    };
  }

  private async getMovementInTransaction(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    id: bigint,
  ) {
    return tx.inventoryMovement.findFirstOrThrow({
      where: { id, companyId },
      include: {
        createdBy: { select: { displayName: true } },
        accountingDocument: { select: { documentNumber: true, status: true, version: true } },
        offsetAccount: { select: { id: true, code: true, nameAr: true } },
        reversalOfMovement: { select: { id: true, movementNumber: true } },
        reversedByMovement: { select: { id: true, movementNumber: true } },
        lines: { orderBy: { lineNumber: "asc" } },
      },
    });
  }

  private async resolveManualAccountingPolicy(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    movementType: InventoryMovementType,
  ) {
    const offsetKey = movementType === "OPENING_BALANCE"
      ? "retained-earnings"
      : ["RECEIPT", "ADJUSTMENT_IN"].includes(movementType)
        ? "misc-income"
        : "misc-expense";
    const expectedOffsetClass = movementType === "OPENING_BALANCE"
      ? "EQUITY"
      : ["RECEIPT", "ADJUSTMENT_IN"].includes(movementType)
        ? "REVENUE"
        : "EXPENSE";
    const company = await tx.company.findFirst({
      where: { id: companyId },
      select: { baseCurrencyId: true },
    });
    const accounts = await tx.account.findMany({
      where: {
        companyId,
        sourceTemplateCode: "SMALL_BUSINESS_GENERAL",
        sourceTemplateKey: { in: ["inventory", offsetKey] },
      },
      include: {
        accountType: { select: { class: true } },
        _count: { select: { children: true } },
      },
    });
    const inventory = accounts.find((account) => account.sourceTemplateKey === "inventory");
    const offset = accounts.find((account) => account.sourceTemplateKey === offsetKey);
    const invalid = (account: typeof inventory) => !account ||
      !account.isActive ||
      !account.allowsPosting ||
      account._count.children > 0;
    if (
      !company ||
      invalid(inventory) ||
      invalid(offset) ||
      inventory!.accountType.class !== "ASSET" ||
      offset!.accountType.class !== expectedOffsetClass
    ) {
      throw new InventoryMovementError("INVENTORY_ACCOUNTING_NOT_CONFIGURED");
    }
    return {
      baseCurrencyId: company.baseCurrencyId,
      inventoryAccountId: inventory!.id,
      offsetAccountId: offset!.id,
    };
  }

  private postingError(reason: PostingFailureReason) {
    return new InventoryMovementError(reason);
  }

  private async resolveInvoiceExactCosts(
    tx: Prisma.TransactionClient,
    input: InventoryInvoiceStockInput,
    quantities: Map<string, {
      inventoryItemId: bigint;
      quantity: Prisma.Decimal;
      baseNetAmount: Prisma.Decimal;
      hasBaseNetAmount: boolean;
    }>,
  ) {
    if (input.sourceEvent === "REVERSE") {
      const original = await this.loadInvoiceMovementCosts(
        tx,
        input.companyId,
        input.documentType,
        input.invoiceId,
      );
      const result = new Map<string, Prisma.Decimal>();
      if (original.size !== quantities.size) {
        throw new InventoryMovementError("SOURCE_MISMATCH");
      }
      for (const [key, requested] of quantities) {
        const sourceLine = original.get(key);
        if (!sourceLine || !sourceLine.quantity.equals(requested.quantity)) {
          throw new InventoryMovementError("SOURCE_MISMATCH");
        }
        result.set(key, sourceLine.totalCostBase);
      }
      return result;
    }

    if (input.documentType === "PURCHASE_INVOICE") {
      const result = new Map<string, Prisma.Decimal>();
      for (const [key, line] of quantities) {
        if (
          !line.hasBaseNetAmount ||
          line.baseNetAmount.lt(0) ||
          line.baseNetAmount.gte("1000000000000000") ||
          line.baseNetAmount.decimalPlaces() > 4
        ) {
          throw new InventoryMovementError("INVALID_UNIT_COST");
        }
        result.set(key, money(line.baseNetAmount));
      }
      return result;
    }

    if (input.documentType === "SALES_CREDIT_NOTE") {
      if (!input.sourceInvoiceId) throw new InventoryMovementError("SOURCE_MISMATCH");
      const source = await this.loadInvoiceMovementCosts(
        tx,
        input.companyId,
        "SALES_INVOICE",
        input.sourceInvoiceId,
      );
      const priorCredits = await tx.salesInvoice.findMany({
        where: {
          companyId: input.companyId,
          sourceInvoiceId: input.sourceInvoiceId,
          id: { not: input.invoiceId },
          accountingDocument: { documentType: "SALES_CREDIT_NOTE", status: "POSTED" },
        },
        select: { id: true },
      });
      const priorMovements = priorCredits.length === 0
        ? []
        : await tx.inventoryMovement.findMany({
            where: {
              companyId: input.companyId,
              sourceType: "SALES_CREDIT_NOTE",
              sourceEvent: "POST",
              sourceId: { in: priorCredits.map((credit) => credit.id) },
            },
            select: {
              lines: {
                select: {
                  inventoryItemId: true,
                  quantity: true,
                  totalCostBase: true,
                  isCostInitialized: true,
                },
              },
            },
          });
      const priorByItem = new Map<string, {
        quantity: Prisma.Decimal;
        totalCostBase: Prisma.Decimal;
      }>();
      for (const movement of priorMovements) {
        for (const line of movement.lines) {
          if (!line.isCostInitialized) {
            throw new InventoryMovementError("INVENTORY_VALUATION_REQUIRED");
          }
          const key = line.inventoryItemId.toString();
          const prior = priorByItem.get(key);
          priorByItem.set(key, {
            quantity: (prior?.quantity ?? new Prisma.Decimal(0)).add(line.quantity),
            totalCostBase: money(
              (prior?.totalCostBase ?? new Prisma.Decimal(0)).add(line.totalCostBase),
            ),
          });
        }
      }
      const result = new Map<string, Prisma.Decimal>();
      for (const [key, requested] of quantities) {
        const sourceLine = source.get(key);
        const prior = priorByItem.get(key) ?? {
          quantity: new Prisma.Decimal(0),
          totalCostBase: new Prisma.Decimal(0),
        };
        const cumulativeQuantity = prior.quantity.add(requested.quantity);
        if (!sourceLine || cumulativeQuantity.gt(sourceLine.quantity)) {
          throw new InventoryMovementError("SOURCE_MISMATCH");
        }
        const allocatedCost = cumulativeQuantity.equals(sourceLine.quantity)
          ? money(sourceLine.totalCostBase.sub(prior.totalCostBase))
          : money(requested.quantity.mul(sourceLine.unitCostBase));
        if (allocatedCost.lt(0)) throw new InventoryMovementError("SOURCE_MISMATCH");
        result.set(
          key,
          allocatedCost,
        );
      }
      return result;
    }

    return new Map<string, Prisma.Decimal>();
  }

  private async loadInvoiceMovementCosts(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    sourceType: InventoryInvoiceDocumentType,
    sourceId: bigint,
  ) {
    const movement = await tx.inventoryMovement.findUnique({
      where: {
        companyId_sourceType_sourceId_sourceEvent: {
          companyId,
          sourceType,
          sourceId,
          sourceEvent: "POST",
        },
      },
      select: {
        lines: {
          select: {
            inventoryItemId: true,
            quantity: true,
            unitCostBase: true,
            totalCostBase: true,
            isCostInitialized: true,
          },
        },
      },
    });
    if (!movement) throw new InventoryMovementError("SOURCE_MISMATCH");
    if (movement.lines.some((line) => !line.isCostInitialized)) {
      throw new InventoryMovementError("INVENTORY_VALUATION_REQUIRED");
    }
    return new Map(movement.lines.map((line) => [
      line.inventoryItemId.toString(),
      line,
    ]));
  }

  private async resolveAccountingPolicy(tx: Prisma.TransactionClient, companyId: bigint) {
    const company = await tx.company.findFirst({
      where: { id: companyId },
      select: { baseCurrencyId: true },
    });
    if (!company) throw new InventoryMovementError("INVENTORY_ACCOUNTING_NOT_CONFIGURED");
    const accounts = await tx.account.findMany({
      where: {
        companyId,
        sourceTemplateCode: "SMALL_BUSINESS_GENERAL",
        sourceTemplateKey: { in: ["inventory", "purchases"] },
      },
      include: {
        accountType: { select: { class: true } },
        _count: { select: { children: true } },
      },
    });
    const inventory = accounts.find((account) => account.sourceTemplateKey === "inventory");
    const costOfGoodsSold = accounts.find((account) => account.sourceTemplateKey === "purchases");
    if (
      !inventory ||
      !costOfGoodsSold ||
      !inventory.isActive ||
      !costOfGoodsSold.isActive ||
      !inventory.allowsPosting ||
      !costOfGoodsSold.allowsPosting ||
      inventory._count.children > 0 ||
      costOfGoodsSold._count.children > 0 ||
      inventory.accountType.class !== "ASSET" ||
      costOfGoodsSold.accountType.class !== "EXPENSE"
    ) {
      throw new InventoryMovementError("INVENTORY_ACCOUNTING_NOT_CONFIGURED");
    }
    return {
      baseCurrencyId: company.baseCurrencyId,
      inventoryAccountId: inventory.id,
      costOfGoodsSoldAccountId: costOfGoodsSold.id,
    };
  }

  private invoiceValuationResult(
    policy: {
      baseCurrencyId: bigint;
      inventoryAccountId: bigint;
      costOfGoodsSoldAccountId: bigint;
    },
    movement: {
      id: bigint;
      movementNumber: string;
      lines: Array<{
        inventoryItemId: bigint;
        quantity: Prisma.Decimal;
        unitCostBase: Prisma.Decimal;
        totalCostBase: Prisma.Decimal;
        isCostInitialized: boolean;
      }>;
    },
  ): InventoryInvoiceStockResult {
    return {
      movementId: movement.id.toString(),
      movementNumber: movement.movementNumber,
      ...policy,
      totalCostBase: money(movement.lines.reduce(
        (sum, line) => sum.add(line.totalCostBase),
        new Prisma.Decimal(0),
      )),
      lines: movement.lines.map((line) => ({
        inventoryItemId: line.inventoryItemId,
        quantity: line.quantity,
        unitCostBase: line.unitCostBase,
        totalCostBase: line.totalCostBase,
        isCostInitialized: line.isCostInitialized,
      })),
    };
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
    const result = new Map<string, LockedBalance>();
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

  private async reserveDocumentNumberInTransaction(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    fiscalYearId: bigint,
    documentType: string,
  ) {
    const year = await tx.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId },
      select: { startDate: true, endDate: true },
    });
    if (!year) throw new InventoryMovementError("PERIOD_CLOSED");
    const prefix = `${year.startDate.toISOString().slice(0, 10).replaceAll("-", "")}-${year.endDate.toISOString().slice(0, 10).replaceAll("-", "")}-`;
    const sequence = await tx.documentSequence.upsert({
      where: { fiscalYearId_documentType: { fiscalYearId, documentType } },
      update: {},
      create: { companyId, fiscalYearId, documentType, prefix },
    });
    if (sequence.companyId !== companyId) {
      throw new InventoryMovementError("PERIOD_CLOSED");
    }
    await tx.$executeRaw`
      UPDATE document_sequences
      SET next_number = LAST_INSERT_ID(next_number + 1), updated_at = CURRENT_TIMESTAMP(3)
      WHERE fiscal_year_id = ${fiscalYearId} AND document_type = ${documentType}
    `;
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
      SELECT LAST_INSERT_ID() AS value
    `;
    return `${prefix}${(rows[0]!.value - 1n).toString().padStart(sequence.padding, "0")}`;
  }
}
