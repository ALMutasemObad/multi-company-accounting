import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { ActorContext } from "../../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../../platform/transaction-executor.js";

export type InventoryCountErrorReason =
  | "NOT_FOUND"
  | "WAREHOUSE_INACTIVE"
  | "EMPTY_WAREHOUSE"
  | "INVALID_COMMITTEE"
  | "INVALID_COUNT"
  | "INVALID_VARIANCE_REASON"
  | "INVALID_STATE"
  | "INCOMPLETE_COUNT"
  | "VERSION_CONFLICT"
  | "DUPLICATE_LINE"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class InventoryCountError extends Error {
  constructor(public readonly reason: InventoryCountErrorReason) {
    super(reason);
  }
}

export type CommitteeMemberInput = { name: string; role: string };
export type CountLocationInput = {
  inventoryItemId: bigint;
  location?: string | null | undefined;
  shelf?: string | null | undefined;
};
export type CreateInventoryCountInput = {
  warehouseId: bigint;
  countDate: Date;
  committee?: CommitteeMemberInput[] | undefined;
  locations?: CountLocationInput[] | undefined;
};
export type BulkCountRow = {
  lineId: bigint;
  expectedVersion: number;
  countedQuantity: string;
  varianceReason?: string | null | undefined;
};
export type BulkCountConflict = {
  lineId: string;
  expectedVersion: number;
  actualVersion: number | null;
};
export type CountEntryInput = {
  inventoryItemId: bigint;
  quantity: string;
  locationReference?: string | null | undefined;
  entryKey: string;
};
export type InventoryCountSummary = {
  total: number;
  counted: number;
  remaining: number;
  surplus: number;
  shortage: number;
  conflicts: number;
};

const trimmed = (value: string | null | undefined, max: number) => {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, max) : null;
};

const parseQuantity = (value: string) => {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)) {
    throw new InventoryCountError("INVALID_COUNT");
  }
  return new Prisma.Decimal(normalized);
};

const normalizeCommittee = (members: CommitteeMemberInput[]) => {
  const normalized = members.map((member) => ({
    name: trimmed(member.name, 160),
    role: trimmed(member.role, 120),
  }));
  if (
    normalized.some((member) => !member.name || !member.role) ||
    new Set(normalized.map((member) => `${member.name}\u0000${member.role}`)).size !== normalized.length
  ) {
    throw new InventoryCountError("INVALID_COMMITTEE");
  }
  return normalized as Array<{ name: string; role: string }>;
};

const assertDistinctRows = (rows: BulkCountRow[]) => {
  if (new Set(rows.map((row) => row.lineId.toString())).size !== rows.length) {
    throw new InventoryCountError("DUPLICATE_LINE");
  }
};

const numericBigIntSort = (left: bigint, right: bigint) => (left < right ? -1 : left > right ? 1 : 0);

const sessionSelect = {
  id: true,
  warehouseId: true,
  countDate: true,
  snapshotAt: true,
  status: true,
  version: true,
  lastReceiptMovementId: true,
  lastReceiptMovementNumber: true,
  lastIssueMovementId: true,
  lastIssueMovementNumber: true,
  submittedAt: true,
  approvedAt: true,
  approvedByName: true,
  settlementDate: true,
  surplusMovementId: true,
  shortageMovementId: true,
  settledAt: true,
} satisfies Prisma.StockCountSessionSelect;

const toSessionDto = (session: Prisma.StockCountSessionGetPayload<{ select: typeof sessionSelect }>) => ({
  id: session.id.toString(),
  warehouseId: session.warehouseId.toString(),
  countDate: session.countDate.toISOString().slice(0, 10),
  snapshotAt: session.snapshotAt.toISOString(),
  status: session.status,
  version: session.version,
  cutoff: {
    receipt: session.lastReceiptMovementId === null ? null : {
      id: session.lastReceiptMovementId.toString(),
      number: session.lastReceiptMovementNumber!,
    },
    issue: session.lastIssueMovementId === null ? null : {
      id: session.lastIssueMovementId.toString(),
      number: session.lastIssueMovementNumber!,
    },
  },
  submittedAt: session.submittedAt?.toISOString() ?? null,
  approvedAt: session.approvedAt?.toISOString() ?? null,
  approvedByName: session.approvedByName,
  settlement: session.settlementDate && session.settledAt ? {
    date: session.settlementDate.toISOString().slice(0, 10),
    settledAt: session.settledAt.toISOString(),
    surplusMovementId: session.surplusMovementId?.toString() ?? null,
    shortageMovementId: session.shortageMovementId?.toString() ?? null,
  } : null,
});

export class InventoryCountService {
  private readonly transactions: TransactionExecutor;
  private readonly idempotency: IdempotentCommandExecutor;

  constructor(private readonly prisma: PrismaClient) {
    this.transactions = new TransactionExecutor(prisma);
    this.idempotency = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async listSessions(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      warehouseId?: bigint | undefined;
      status?: "DRAFT" | "SUBMITTED" | "APPROVED" | "SETTLED" | undefined;
    },
  ) {
    const where: Prisma.StockCountSessionWhereInput = {
      companyId: context.companyId,
      ...(input.warehouseId === undefined ? {} : { warehouseId: input.warehouseId }),
      ...(input.status === undefined ? {} : { status: input.status }),
    };
    const [sessions, total] = await this.prisma.$transaction([
      this.prisma.stockCountSession.findMany({
        where,
        select: sessionSelect,
        orderBy: [{ countDate: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.stockCountSession.count({ where }),
    ]);
    return { data: sessions.map(toSessionDto), total };
  }

  async getSession(context: ActorContext, sessionId: bigint) {
    const session = await this.prisma.stockCountSession.findFirst({
      where: { id: sessionId, companyId: context.companyId },
      select: {
        ...sessionSelect,
        committeeMembers: {
          select: { id: true, memberName: true, memberRole: true },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!session) throw new InventoryCountError("NOT_FOUND");
    return {
      ...toSessionDto(session),
      committee: session.committeeMembers.map((member) => ({
        id: member.id.toString(),
        name: member.memberName,
        role: member.memberRole,
      })),
      summary: await this.summary(context, sessionId, 0),
    };
  }

  async createSession(
    context: ActorContext,
    input: CreateInventoryCountInput,
    idempotencyKey: string,
  ) {
    const committee = normalizeCommittee(input.committee ?? []);
    const locations = new Map<string, { location: string | null; shelf: string | null }>();
    for (const value of input.locations ?? []) {
      const key = value.inventoryItemId.toString();
      if (locations.has(key)) throw new InventoryCountError("DUPLICATE_LINE");
      locations.set(key, {
        location: trimmed(value.location, 300),
        shelf: trimmed(value.shelf, 120),
      });
    }
    const fingerprint = JSON.stringify({
      warehouseId: input.warehouseId.toString(),
      countDate: input.countDate.toISOString().slice(0, 10),
      committee: [...committee].sort((a, b) => `${a.name}\u0000${a.role}`.localeCompare(`${b.name}\u0000${b.role}`)),
      locations: [...locations.entries()].sort(([a], [b]) => numericBigIntSort(BigInt(a), BigInt(b))),
    });
    return this.idempotency.execute(
      {
        context,
        operation: "CREATE_STOCK_COUNT_SESSION",
        key: idempotencyKey,
        fingerprint,
        responseStatus: 201,
        errors: {
          mismatch: () => new InventoryCountError("IDEMPOTENCY_MISMATCH"),
          inProgress: () => new InventoryCountError("IDEMPOTENCY_IN_PROGRESS"),
        },
      },
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM warehouses WHERE id = ${input.warehouseId} AND company_id = ${context.companyId} FOR UPDATE`);
        const warehouse = await tx.warehouse.findFirst({
          where: { id: input.warehouseId, companyId: context.companyId },
          select: { id: true, isActive: true, address: true },
        });
        if (!warehouse) throw new InventoryCountError("NOT_FOUND");
        if (!warehouse.isActive) throw new InventoryCountError("WAREHOUSE_INACTIVE");
        const items = await tx.inventoryItem.findMany({
          where: { companyId: context.companyId, isActive: true },
          include: { unitOfMeasure: true },
          orderBy: { id: "asc" },
        });
        if (items.length === 0) throw new InventoryCountError("EMPTY_WAREHOUSE");
        const balances = await tx.inventoryBalance.findMany({
          where: { companyId: context.companyId, warehouseId: input.warehouseId },
          orderBy: { inventoryItemId: "asc" },
        });
        const balancesByItemId = new Map(balances.map((balance) => [balance.inventoryItemId.toString(), balance]));
        const unknownLocation = [...locations.keys()].some(
          (itemId) => !items.some((item) => item.id.toString() === itemId),
        );
        if (unknownLocation) throw new InventoryCountError("NOT_FOUND");
        const movementBase = {
          companyId: context.companyId,
          movementDate: { lte: input.countDate },
        } as const;
        const [receipt, issue] = await Promise.all([
          tx.inventoryMovement.findFirst({
            where: { ...movementBase, movementType: "RECEIPT", lines: { some: { toWarehouseId: input.warehouseId } } },
            select: { id: true, movementNumber: true },
            orderBy: [{ movementDate: "desc" }, { id: "desc" }],
          }),
          tx.inventoryMovement.findFirst({
            where: { ...movementBase, movementType: "ISSUE", lines: { some: { fromWarehouseId: input.warehouseId } } },
            select: { id: true, movementNumber: true },
            orderBy: [{ movementDate: "desc" }, { id: "desc" }],
          }),
        ]);
        const session = await tx.stockCountSession.create({
          data: {
            companyId: context.companyId,
            warehouseId: input.warehouseId,
            countDate: input.countDate,
            snapshotAt: new Date(),
            createdById: context.userId,
            lastReceiptMovementId: receipt?.id ?? null,
            lastReceiptMovementNumber: receipt?.movementNumber ?? null,
            lastIssueMovementId: issue?.id ?? null,
            lastIssueMovementNumber: issue?.movementNumber ?? null,
            committeeMembers: {
              create: committee.map((member) => ({ memberName: member.name, memberRole: member.role })),
            },
            lines: {
              create: items.map((item) => {
                const balance = balancesByItemId.get(item.id.toString());
                const location = locations.get(item.id.toString());
                return {
                  inventoryItemId: item.id,
                  itemCodeSnapshot: item.code,
                  itemTitleSnapshot: item.nameAr,
                  unitCodeSnapshot: item.unitOfMeasure.code,
                  locationSnapshot: location?.location ?? warehouse.address,
                  shelfSnapshot: location?.shelf ?? null,
                  bookQuantity: balance?.onHand ?? new Prisma.Decimal(0),
                  bookUnitCostBase: balance?.averageUnitCostBase ?? new Prisma.Decimal(0),
                  bookValueBase: balance?.inventoryValueBase ?? new Prisma.Decimal(0),
                  isValuationInitialized: balance?.isValuationInitialized ?? false,
                };
              }),
            },
          },
          select: sessionSelect,
        });
        return toSessionDto(session);
      },
    );
  }

  async listLines(
    context: ActorContext,
    sessionId: bigint,
    input: { page: number; pageSize: number; search?: string | undefined },
  ) {
    const session = await this.prisma.stockCountSession.findFirst({ where: { id: sessionId, companyId: context.companyId }, select: { id: true } });
    if (!session) throw new InventoryCountError("NOT_FOUND");
    const where: Prisma.StockCountLineWhereInput = {
      companyId: context.companyId,
      sessionId,
      ...(input.search?.trim() ? { OR: [
        { itemCodeSnapshot: { contains: input.search.trim() } },
        { itemTitleSnapshot: { contains: input.search.trim() } },
        { inventoryItem: { barcodes: { some: { value: { contains: input.search.trim() }, isActive: true } } } },
        { locationSnapshot: { contains: input.search.trim() } },
        { shelfSnapshot: { contains: input.search.trim() } },
      ] } : {}),
    };
    const [lines, total, counted, surplus, shortage] = await this.prisma.$transaction([
      this.prisma.stockCountLine.findMany({
        where,
        include: { inventoryItem: { select: { barcodes: { where: { isActive: true }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1, select: { value: true } } } } },
        orderBy: [{ itemTitleSnapshot: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.stockCountLine.count({ where: { companyId: context.companyId, sessionId } }),
      this.prisma.stockCountLine.count({ where: { companyId: context.companyId, sessionId, countedQuantity: { not: null } } }),
      this.prisma.stockCountLine.count({ where: { companyId: context.companyId, sessionId, varianceQuantity: { gt: 0 } } }),
      this.prisma.stockCountLine.count({ where: { companyId: context.companyId, sessionId, varianceQuantity: { lt: 0 } } }),
    ]);
    return {
      data: lines.map((line) => ({
        id: line.id.toString(), inventoryItemId: line.inventoryItemId.toString(), code: line.itemCodeSnapshot,
        barcode: line.inventoryItem.barcodes[0]?.value ?? null,
        title: line.itemTitleSnapshot, unitCode: line.unitCodeSnapshot, location: line.locationSnapshot, shelf: line.shelfSnapshot,
        bookQuantity: line.bookQuantity.toString(), bookUnitCostBase: line.bookUnitCostBase.toString(), bookValueBase: line.bookValueBase.toString(),
        countedQuantity: line.countedQuantity?.toString() ?? null, varianceQuantity: line.varianceQuantity?.toString() ?? null,
        varianceReason: line.varianceReason, countedByName: line.countedByNameSnapshot, countedAt: line.countedAt?.toISOString() ?? null, version: line.version,
      })),
      summary: { total, counted, remaining: total - counted, surplus, shortage, conflicts: 0 } satisfies InventoryCountSummary,
    };
  }

  async bulkEnterCounts(context: ActorContext, sessionId: bigint, rows: BulkCountRow[]) {
    assertDistinctRows(rows);
    if (rows.length === 0) return { conflicts: [], summary: await this.summary(context, sessionId, 0) };
    return this.transactions.execute(
      { operation: "BULK_ENTER_STOCK_COUNTS", companyId: context.companyId },
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_count_sessions WHERE id = ${sessionId} AND company_id = ${context.companyId} FOR UPDATE`);
        const session = await tx.stockCountSession.findFirst({ where: { id: sessionId, companyId: context.companyId }, select: { id: true, status: true } });
        if (!session) throw new InventoryCountError("NOT_FOUND");
        if (session.status !== "DRAFT") throw new InventoryCountError("INVALID_STATE");
        const ids = rows.map((row) => row.lineId).sort(numericBigIntSort);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_count_lines WHERE company_id = ${context.companyId} AND session_id = ${sessionId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
        const current = await tx.stockCountLine.findMany({
          where: { companyId: context.companyId, sessionId, id: { in: ids } },
          include: { _count: { select: { entries: true } } },
          orderBy: { id: "asc" },
        });
        const byId = new Map(current.map((line) => [line.id.toString(), line]));
        const conflicts: BulkCountConflict[] = [];
        const counterName = await this.resolveCounterName(tx, context.userId);
        for (const row of rows) {
          const line = byId.get(row.lineId.toString());
          if (!line || line.version !== row.expectedVersion) {
            conflicts.push({ lineId: row.lineId.toString(), expectedVersion: row.expectedVersion, actualVersion: line?.version ?? null });
            continue;
          }
          const counted = parseQuantity(row.countedQuantity);
          const variance = counted.minus(line.bookQuantity);
          const reason = trimmed(row.varianceReason, 500);
          if (!variance.isZero() && !reason) throw new InventoryCountError("INVALID_VARIANCE_REASON");
          if ((line._count?.entries ?? 0) > 0 && line.countedQuantity && !counted.equals(line.countedQuantity)) {
            await tx.stockCountEntry.create({
              data: {
                companyId: context.companyId,
                sessionId,
                lineId: line.id,
                entryKey: `CORRECTION-${randomUUID()}`,
                quantity: counted.minus(line.countedQuantity),
                locationReference: `تصحيح مشرف: ${reason ?? "مطابقة الإجمالي"}`.slice(0, 200),
                counterNameSnapshot: counterName,
                createdById: context.userId,
              },
            });
          }
          const updated = await tx.stockCountLine.updateMany({
            where: { id: row.lineId, companyId: context.companyId, sessionId, version: row.expectedVersion },
            data: {
              countedQuantity: counted,
              varianceQuantity: variance,
              varianceReason: variance.isZero() ? null : reason,
              countedById: context.userId,
              countedByNameSnapshot: counterName,
              countedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) conflicts.push({ lineId: row.lineId.toString(), expectedVersion: row.expectedVersion, actualVersion: line.version });
        }
        return { conflicts, summary: await this.summaryInTransaction(tx, context, sessionId, conflicts.length) };
      },
    );
  }

  async addEntry(context: ActorContext, sessionId: bigint, input: CountEntryInput) {
    const quantity = parseQuantity(input.quantity);
    if (quantity.isZero()) throw new InventoryCountError("INVALID_COUNT");
    const locationReference = trimmed(input.locationReference, 200);
    const entryKey = input.entryKey.trim().slice(0, 100);
    if (entryKey.length < 8) throw new InventoryCountError("INVALID_COUNT");
    return this.transactions.execute(
      { operation: "ADD_STOCK_COUNT_ENTRY", companyId: context.companyId },
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_count_sessions WHERE id = ${sessionId} AND company_id = ${context.companyId} FOR UPDATE`);
        const session = await tx.stockCountSession.findFirst({ where: { id: sessionId, companyId: context.companyId }, select: { status: true } });
        if (!session) throw new InventoryCountError("NOT_FOUND");
        if (session.status !== "DRAFT") throw new InventoryCountError("INVALID_STATE");
        const existing = await tx.stockCountEntry.findFirst({ where: { companyId: context.companyId, entryKey }, select: { lineId: true } });
        if (existing) return this.entryResult(tx, context, sessionId, existing.lineId, true);
        let line = await tx.stockCountLine.findFirst({
          where: { companyId: context.companyId, sessionId, inventoryItemId: input.inventoryItemId },
        });
        if (!line) {
          const [item, sessionRecord] = await Promise.all([
            tx.inventoryItem.findFirst({ where: { id: input.inventoryItemId, companyId: context.companyId, isActive: true }, include: { unitOfMeasure: true } }),
            tx.stockCountSession.findFirstOrThrow({ where: { id: sessionId, companyId: context.companyId }, select: { warehouseId: true } }),
          ]);
          if (!item) throw new InventoryCountError("NOT_FOUND");
          const balance = await tx.inventoryBalance.findFirst({ where: { companyId: context.companyId, warehouseId: sessionRecord.warehouseId, inventoryItemId: item.id } });
          line = await tx.stockCountLine.create({
            data: {
              companyId: context.companyId, sessionId, inventoryItemId: item.id,
              itemCodeSnapshot: item.code, itemTitleSnapshot: item.nameAr, unitCodeSnapshot: item.unitOfMeasure.code,
              bookQuantity: balance?.onHand ?? new Prisma.Decimal(0), bookUnitCostBase: balance?.averageUnitCostBase ?? new Prisma.Decimal(0),
              bookValueBase: balance?.inventoryValueBase ?? new Prisma.Decimal(0), isValuationInitialized: balance?.isValuationInitialized ?? false,
            },
          });
        }
        await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_count_lines WHERE id = ${line.id} AND company_id = ${context.companyId} FOR UPDATE`);
        const locked = await tx.stockCountLine.findFirstOrThrow({ where: { id: line.id, companyId: context.companyId } });
        const counterName = await this.resolveCounterName(tx, context.userId);
        const total = (locked.countedQuantity ?? new Prisma.Decimal(0)).plus(quantity);
        const variance = total.minus(locked.bookQuantity);
        await tx.stockCountEntry.create({
          data: {
            companyId: context.companyId,
            sessionId,
            lineId: locked.id,
            entryKey,
            quantity,
            locationReference,
            counterNameSnapshot: counterName,
            createdById: context.userId,
          },
        });
        await tx.stockCountLine.update({
          where: { id: locked.id },
          data: {
            countedQuantity: total,
            varianceQuantity: variance,
            ...(variance.isZero() ? { varianceReason: null } : {}),
            countedById: context.userId,
            countedByNameSnapshot: counterName,
            countedAt: new Date(),
            version: { increment: 1 },
          },
        });
        return this.entryResult(tx, context, sessionId, locked.id, false);
      },
    );
  }

  async listEntries(context: ActorContext, sessionId: bigint, lineId?: bigint) {
    const session = await this.prisma.stockCountSession.findFirst({ where: { id: sessionId, companyId: context.companyId }, select: { id: true } });
    if (!session) throw new InventoryCountError("NOT_FOUND");
    const entries = await this.prisma.stockCountEntry.findMany({
      where: { companyId: context.companyId, sessionId, ...(lineId ? { lineId } : {}) },
      include: { line: { select: { itemCodeSnapshot: true, itemTitleSnapshot: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500,
    });
    return entries.map((entry) => ({
      id: entry.id.toString(),
      lineId: entry.lineId.toString(),
      code: entry.line.itemCodeSnapshot,
      title: entry.line.itemTitleSnapshot,
      quantity: entry.quantity.toString(),
      locationReference: entry.locationReference,
      counterName: entry.counterNameSnapshot,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  async report(context: ActorContext, sessionId: bigint) {
    const session = await this.prisma.stockCountSession.findFirst({
      where: { id: sessionId, companyId: context.companyId },
      include: {
        warehouse: { select: { code: true, nameAr: true } },
        committeeMembers: { select: { memberName: true, memberRole: true }, orderBy: { id: "asc" } },
      },
    });
    if (!session) throw new InventoryCountError("NOT_FOUND");
    const lines = await this.prisma.stockCountLine.findMany({
      where: { companyId: context.companyId, sessionId },
      include: { inventoryItem: { select: { barcodes: { where: { isActive: true }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1, select: { value: true } } } } },
      orderBy: [{ itemTitleSnapshot: "asc" }, { id: "asc" }],
    });
    return {
      session: {
        id: session.id.toString(), countDate: session.countDate.toISOString().slice(0, 10), status: session.status, warehouse: session.warehouse,
        cutoff: { receiptNumber: session.lastReceiptMovementNumber, issueNumber: session.lastIssueMovementNumber },
        committee: session.committeeMembers.map((member) => ({ name: member.memberName, role: member.memberRole })),
        approvedByName: session.approvedByName,
        approvedAt: session.approvedAt?.toISOString() ?? null,
        settlement: session.settlementDate && session.settledAt ? {
          date: session.settlementDate.toISOString().slice(0, 10),
          surplusMovementId: session.surplusMovementId?.toString() ?? null,
          shortageMovementId: session.shortageMovementId?.toString() ?? null,
        } : null,
      },
      rows: lines.map((line) => ({
        code: line.itemCodeSnapshot, barcode: line.inventoryItem.barcodes[0]?.value ?? null, title: line.itemTitleSnapshot, unitCode: line.unitCodeSnapshot,
        locationReference: line.locationSnapshot ?? line.shelfSnapshot,
        bookQuantity: line.bookQuantity.toString(), countedQuantity: line.countedQuantity?.toString() ?? "",
        varianceQuantity: line.varianceQuantity?.toString() ?? "", unitCostBase: line.bookUnitCostBase.toString(),
        varianceValueBase: line.varianceQuantity?.times(line.bookUnitCostBase).toFixed(4) ?? "",
        varianceReason: line.varianceReason ?? "", countedBy: line.countedByNameSnapshot ?? "",
      })),
    };
  }

  async submit(context: ActorContext, sessionId: bigint, expectedVersion: number) {
    return this.transition(context, sessionId, expectedVersion, "DRAFT", async (tx, now) => {
      const remaining = await tx.stockCountLine.count({ where: { companyId: context.companyId, sessionId, countedQuantity: null } });
      if (remaining !== 0) throw new InventoryCountError("INCOMPLETE_COUNT");
      const unexplained = await tx.stockCountLine.count({ where: { companyId: context.companyId, sessionId, varianceQuantity: { not: 0 }, varianceReason: null } });
      if (unexplained !== 0) throw new InventoryCountError("INVALID_VARIANCE_REASON");
      return { status: "SUBMITTED" as const, submittedById: context.userId, submittedAt: now };
    });
  }

  async approve(context: ActorContext, sessionId: bigint, expectedVersion: number, approverName: string) {
    const name = trimmed(approverName, 160);
    if (!name) throw new InventoryCountError("INVALID_COMMITTEE");
    return this.transition(context, sessionId, expectedVersion, "SUBMITTED", async (tx, now) => {
      return { status: "APPROVED" as const, approvedById: context.userId, approvedByName: name, approvedAt: now };
    });
  }

  private async transition(
    context: ActorContext,
    sessionId: bigint,
    expectedVersion: number,
    expectedStatus: "DRAFT" | "SUBMITTED",
    data: (tx: Prisma.TransactionClient, now: Date) => Promise<Prisma.StockCountSessionUpdateManyMutationInput>,
  ) {
    return this.transactions.execute({ operation: `STOCK_COUNT_${expectedStatus}`, companyId: context.companyId }, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_count_sessions WHERE id = ${sessionId} AND company_id = ${context.companyId} FOR UPDATE`);
      const session = await tx.stockCountSession.findFirst({ where: { id: sessionId, companyId: context.companyId }, select: { status: true, version: true } });
      if (!session) throw new InventoryCountError("NOT_FOUND");
      if (session.status !== expectedStatus) throw new InventoryCountError("INVALID_STATE");
      if (session.version !== expectedVersion) throw new InventoryCountError("VERSION_CONFLICT");
      const updated = await tx.stockCountSession.updateMany({
        where: { id: sessionId, companyId: context.companyId, version: expectedVersion, status: expectedStatus },
        data: { ...(await data(tx, new Date())), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new InventoryCountError("VERSION_CONFLICT");
      return toSessionDto((await tx.stockCountSession.findFirst({ where: { id: sessionId, companyId: context.companyId }, select: sessionSelect }))!);
    });
  }

  private async resolveCounterName(tx: Prisma.TransactionClient, userId: bigint) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    if (!user) throw new InventoryCountError("NOT_FOUND");
    return user.displayName;
  }

  private async entryResult(tx: Prisma.TransactionClient, context: ActorContext, sessionId: bigint, lineId: bigint, duplicate: boolean) {
    const line = await tx.stockCountLine.findFirstOrThrow({ where: { id: lineId, companyId: context.companyId, sessionId } });
    return {
      duplicate,
      line: {
        id: line.id.toString(), inventoryItemId: line.inventoryItemId.toString(), code: line.itemCodeSnapshot,
        title: line.itemTitleSnapshot, countedQuantity: line.countedQuantity?.toString() ?? null,
        varianceQuantity: line.varianceQuantity?.toString() ?? null, version: line.version,
      },
    };
  }

  private summary(context: ActorContext, sessionId: bigint, conflicts: number) {
    return this.prisma.$transaction((tx) => this.summaryInTransaction(tx, context, sessionId, conflicts));
  }

  private async summaryInTransaction(tx: Prisma.TransactionClient, context: ActorContext, sessionId: bigint, conflicts: number): Promise<InventoryCountSummary> {
    const where = { companyId: context.companyId, sessionId };
    const [total, counted, surplus, shortage] = await Promise.all([
      tx.stockCountLine.count({ where }),
      tx.stockCountLine.count({ where: { ...where, countedQuantity: { not: null } } }),
      tx.stockCountLine.count({ where: { ...where, varianceQuantity: { gt: 0 } } }),
      tx.stockCountLine.count({ where: { ...where, varianceQuantity: { lt: 0 } } }),
    ]);
    return { total, counted, remaining: total - counted, surplus, shortage, conflicts };
  }
}
