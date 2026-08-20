import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ActorContext } from '../users/user-service.js';

export class FiscalError extends Error {
  constructor(public readonly reason: 'NOT_FOUND' | 'DATE_RANGE_INVALID' | 'OVERLAP' | 'PERIOD_OUTSIDE_YEAR' | 'VERSION_CONFLICT' | 'INVALID_STATE' | 'ORDER_VIOLATION' | 'DATES_LOCKED' | 'DRAFT_DOCUMENTS_EXIST' | 'RECONCILIATION_FAILED' | 'IDEMPOTENCY_MISMATCH' | 'IDEMPOTENCY_IN_PROGRESS') { super(reason); }
}

export type PeriodInput = { periodNumber: number; name: string; startDate: string; endDate: string };
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const prefix = (start: Date, end: Date) => `${start.toISOString().slice(0, 10).replaceAll('-', '')}-${end.toISOString().slice(0, 10).replaceAll('-', '')}-`;
const digest = (value: string) => new Uint8Array(createHash('sha256').update(value).digest());

function assertDateRange(start: Date, end: Date) {
  if (end < start) throw new FiscalError('DATE_RANGE_INVALID');
}

function validatePeriods(yearStart: Date, yearEnd: Date, periods: PeriodInput[]) {
  const seen = new Set<number>();
  const ranges = periods.map((period) => {
    if (seen.has(period.periodNumber)) throw new FiscalError('OVERLAP');
    seen.add(period.periodNumber);
    const startDate = date(period.startDate); const endDate = date(period.endDate);
    assertDateRange(startDate, endDate);
    if (startDate < yearStart || endDate > yearEnd) throw new FiscalError('PERIOD_OUTSIDE_YEAR');
    return { ...period, startDate, endDate };
  }).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  for (let index = 1; index < ranges.length; index += 1) if (ranges[index]!.startDate <= ranges[index - 1]!.endDate) throw new FiscalError('OVERLAP');
  return ranges;
}

export class FiscalService {
  constructor(private readonly prisma: PrismaClient) {}

  listYears(context: ActorContext, page: number, pageSize: number) {
    const where = { companyId: context.companyId };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.fiscalYear.findMany({ where, include: { periods: { orderBy: { periodNumber: 'asc' } } }, orderBy: { startDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      total: await tx.fiscalYear.count({ where }),
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async getYear(context: ActorContext, id: bigint) {
    const year = await this.prisma.fiscalYear.findFirst({ where: { id, companyId: context.companyId }, include: { periods: { orderBy: { periodNumber: 'asc' } } } });
    if (!year) throw new FiscalError('NOT_FOUND');
    return year;
  }

  async createYear(context: ActorContext, input: { name: string; startDate: string; endDate: string; periods: PeriodInput[] }) {
    const startDate = date(input.startDate); const endDate = date(input.endDate);
    assertDateRange(startDate, endDate);
    const periods = validatePeriods(startDate, endDate, input.periods);
    return this.prisma.$transaction(async (tx) => {
      const overlap = await tx.fiscalYear.findFirst({ where: { companyId: context.companyId, startDate: { lte: endDate }, endDate: { gte: startDate } }, select: { id: true } });
      if (overlap) throw new FiscalError('OVERLAP');
      const year = await tx.fiscalYear.create({ data: { companyId: context.companyId, name: input.name, startDate, endDate, periods: { create: periods } } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'FISCAL_YEAR_CREATED', entityType: 'FISCAL_YEAR', entityId: year.id.toString() } });
      return tx.fiscalYear.findUniqueOrThrow({ where: { id: year.id }, include: { periods: { orderBy: { periodNumber: 'asc' } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updateYear(context: ActorContext, id: bigint, input: { name?: string | undefined; startDate?: string | undefined; endDate?: string | undefined }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.fiscalYear.findFirst({ where: { id, companyId: context.companyId }, include: { periods: true, sequences: true } });
      if (!current) throw new FiscalError('NOT_FOUND');
      if (current.status !== 'OPEN') throw new FiscalError('INVALID_STATE');
      const startDate = input.startDate ? date(input.startDate) : current.startDate;
      const endDate = input.endDate ? date(input.endDate) : current.endDate;
      assertDateRange(startDate, endDate);
      const changesDates = startDate.getTime() !== current.startDate.getTime() || endDate.getTime() !== current.endDate.getTime();
      const documentCount = changesDates ? await tx.accountingDocument.count({ where: { fiscalPeriod: { fiscalYearId: id } } }) : 0;
      if (changesDates && (current.sequences.some((sequence) => sequence.nextNumber > 1n) || documentCount > 0)) throw new FiscalError('DATES_LOCKED');
      if (current.periods.some((period) => period.startDate < startDate || period.endDate > endDate)) throw new FiscalError('PERIOD_OUTSIDE_YEAR');
      const overlap = await tx.fiscalYear.findFirst({ where: { companyId: context.companyId, id: { not: id }, startDate: { lte: endDate }, endDate: { gte: startDate } } });
      if (overlap) throw new FiscalError('OVERLAP');
      await tx.fiscalYear.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), startDate, endDate } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'FISCAL_YEAR_UPDATED', entityType: 'FISCAL_YEAR', entityId: id.toString() } });
      return tx.fiscalYear.findUniqueOrThrow({ where: { id }, include: { periods: { orderBy: { periodNumber: 'asc' } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  listPeriods(context: ActorContext, input: { page: number; pageSize: number; status?: 'OPEN' | 'CLOSED' | 'REOPENED' | undefined }) {
    const where = { companyId: context.companyId, ...(input.status ? { status: input.status } : {}) };
    return this.prisma.$transaction(async (tx) => ({ data: await tx.fiscalPeriod.findMany({ where, orderBy: { startDate: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }), total: await tx.fiscalPeriod.count({ where }) }));
  }

  async getPeriod(context: ActorContext, id: bigint) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id, companyId: context.companyId } });
    if (!period) throw new FiscalError('NOT_FOUND');
    return period;
  }

  async updatePeriod(context: ActorContext, id: bigint, input: { version: number; name?: string | undefined; startDate?: string | undefined; endDate?: string | undefined }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.fiscalPeriod.findFirst({ where: { id, companyId: context.companyId }, include: { fiscalYear: { include: { sequences: true } } } });
      if (!current) throw new FiscalError('NOT_FOUND');
      if (current.version !== input.version) throw new FiscalError('VERSION_CONFLICT');
      if (current.status === 'CLOSED') throw new FiscalError('INVALID_STATE');
      const startDate = input.startDate ? date(input.startDate) : current.startDate; const endDate = input.endDate ? date(input.endDate) : current.endDate;
      assertDateRange(startDate, endDate);
      if (startDate < current.fiscalYear.startDate || endDate > current.fiscalYear.endDate) throw new FiscalError('PERIOD_OUTSIDE_YEAR');
      const changesDates = startDate.getTime() !== current.startDate.getTime() || endDate.getTime() !== current.endDate.getTime();
      const documentCount = changesDates ? await tx.accountingDocument.count({ where: { fiscalPeriodId: id } }) : 0;
      if (changesDates && (current.fiscalYear.sequences.some((sequence) => sequence.nextNumber > 1n) || documentCount > 0)) throw new FiscalError('DATES_LOCKED');
      const overlap = await tx.fiscalPeriod.findFirst({ where: { companyId: context.companyId, id: { not: id }, startDate: { lte: endDate }, endDate: { gte: startDate } } });
      if (overlap) throw new FiscalError('OVERLAP');
      const updated = await tx.fiscalPeriod.updateMany({ where: { id, version: input.version }, data: { ...(input.name ? { name: input.name } : {}), startDate, endDate, version: { increment: 1 } } });
      if (updated.count !== 1) throw new FiscalError('VERSION_CONFLICT');
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'FISCAL_PERIOD_UPDATED', entityType: 'FISCAL_PERIOD', entityId: id.toString() } });
      return tx.fiscalPeriod.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async closePeriod(context: ActorContext, id: bigint, input: { version: number; idempotencyKey: string; reviewConfirmed: true; requirePeriodCloseDocument?: boolean | undefined }) {
    return this.periodCommand(context, id, 'CLOSE_PERIOD', input.idempotencyKey, JSON.stringify({ id: id.toString(), version: input.version, reviewConfirmed: input.reviewConfirmed, requirePeriodCloseDocument: input.requirePeriodCloseDocument ?? false }), async (tx, period) => {
      if (period.version !== input.version) throw new FiscalError('VERSION_CONFLICT');
      if (period.status === 'CLOSED') throw new FiscalError('INVALID_STATE');
      const earlierOpen = await tx.fiscalPeriod.findFirst({ where: { companyId: context.companyId, startDate: { lt: period.startDate }, status: { not: 'CLOSED' } } });
      if (earlierOpen) throw new FiscalError('ORDER_VIOLATION');
      const drafts = await tx.accountingDocument.count({ where: { companyId: context.companyId, fiscalPeriodId: id, status: 'DRAFT' } });
      if (drafts > 0) throw new FiscalError('DRAFT_DOCUMENTS_EXIST');
      const reconciliation = await tx.$queryRaw<Array<{ document_id: bigint; entry_id: bigint | null; line_count: bigint; debit: Prisma.Decimal; credit: Prisma.Decimal }>>`
        SELECT d.id AS document_id, e.id AS entry_id, COUNT(l.id) AS line_count,
          COALESCE(SUM(l.base_debit_amount),0) AS debit, COALESCE(SUM(l.base_credit_amount),0) AS credit
        FROM accounting_documents d
        LEFT JOIN journal_entries e ON e.accounting_document_id=d.id AND e.company_id=d.company_id
        LEFT JOIN journal_lines l ON l.journal_entry_id=e.id AND l.company_id=e.company_id
        WHERE d.company_id=${context.companyId} AND d.fiscal_period_id=${id} AND d.status IN ('POSTED','REVERSED')
        GROUP BY d.id,e.id`;
      const invalid = reconciliation.some((row) => row.entry_id === null || Number(row.line_count) < 2 || !new Prisma.Decimal(row.debit).equals(new Prisma.Decimal(row.credit)));
      if (invalid) throw new FiscalError('RECONCILIATION_FAILED');
      if (input.requirePeriodCloseDocument) {
        const closeDocument = await tx.accountingDocument.count({ where: { companyId: context.companyId, fiscalPeriodId: id, documentType: 'PERIOD_CLOSE', status: 'POSTED' } });
        if (closeDocument === 0) throw new FiscalError('RECONCILIATION_FAILED');
      }
      const now = new Date();
      const changed = await tx.fiscalPeriod.updateMany({ where: { id, version: input.version, status: { not: 'CLOSED' } }, data: { status: 'CLOSED', closedBy: context.userId, closedAt: now, version: { increment: 1 } } });
      if (changed.count !== 1) throw new FiscalError('VERSION_CONFLICT');
      const updated = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id } });
      const remaining = await tx.fiscalPeriod.count({ where: { fiscalYearId: period.fiscalYearId, status: { not: 'CLOSED' } } });
      if (remaining === 0) await tx.fiscalYear.update({ where: { id: period.fiscalYearId }, data: { status: 'CLOSED' } });
      return updated;
    });
  }

  async reopenPeriod(context: ActorContext, id: bigint, input: { version: number; reason: string; idempotencyKey: string }) {
    return this.periodCommand(context, id, 'REOPEN_PERIOD', input.idempotencyKey, JSON.stringify({ id: id.toString(), version: input.version, reason: input.reason }), async (tx, period) => {
      if (period.version !== input.version) throw new FiscalError('VERSION_CONFLICT');
      if (period.status !== 'CLOSED') throw new FiscalError('INVALID_STATE');
      const laterClosed = await tx.fiscalPeriod.findFirst({ where: { companyId: context.companyId, startDate: { gt: period.startDate }, status: 'CLOSED' } });
      if (laterClosed) throw new FiscalError('ORDER_VIOLATION');
      const changed = await tx.fiscalPeriod.updateMany({ where: { id, version: input.version, status: 'CLOSED' }, data: { status: 'REOPENED', reopenedBy: context.userId, reopenedAt: new Date(), reopenReason: input.reason, version: { increment: 1 } } });
      if (changed.count !== 1) throw new FiscalError('VERSION_CONFLICT');
      const updated = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id } });
      await tx.fiscalYear.update({ where: { id: period.fiscalYearId }, data: { status: 'OPEN' } });
      return updated;
    });
  }

  private async periodCommand(context: ActorContext, id: bigint, operation: string, key: string, fingerprintSource: string, execute: (tx: Prisma.TransactionClient, period: Awaited<ReturnType<Prisma.TransactionClient['fiscalPeriod']['findFirstOrThrow']>>) => Promise<any>) {
    const keyHash = digest(key); const requestFingerprint = digest(fingerprintSource); const requestId = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.idempotencyRecord.findUnique({ where: { companyId_userId_operation_keyHash: { companyId: context.companyId, userId: context.userId, operation, keyHash } } });
      if (existing) {
        if (!Buffer.from(existing.requestFingerprint).equals(Buffer.from(requestFingerprint))) throw new FiscalError('IDEMPOTENCY_MISMATCH');
        if (existing.status === 'COMPLETED') return existing.responseBody as any;
        throw new FiscalError('IDEMPOTENCY_IN_PROGRESS');
      }
      const period = await tx.fiscalPeriod.findFirstOrThrow({ where: { id, companyId: context.companyId } }).catch(() => { throw new FiscalError('NOT_FOUND'); });
      const idem = await tx.idempotencyRecord.create({ data: { companyId: context.companyId, userId: context.userId, operation, keyHash, requestFingerprint, status: 'IN_PROGRESS', expiresAt: new Date(Date.now() + 86_400_000) } });
      const updated = await execute(tx, period);
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: operation, entityType: 'FISCAL_PERIOD', entityId: id.toString() } });
      const response = { period: FiscalService.serializePeriod(updated), requestId, reconciliation: { balanced: true, differences: [] } };
      await tx.idempotencyRecord.update({ where: { id: idem.id }, data: { status: 'COMPLETED', responseStatus: 200, responseBody: response, completedAt: new Date() } });
      return response;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) throw error;
      let existing = null;
      for (let attempt = 1; attempt <= 10 && !existing; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
        existing = await this.prisma.idempotencyRecord.findUnique({ where: { companyId_userId_operation_keyHash: { companyId: context.companyId, userId: context.userId, operation, keyHash } } });
      }
      if (!existing || !Buffer.from(existing.requestFingerprint).equals(Buffer.from(requestFingerprint))) throw new FiscalError('IDEMPOTENCY_MISMATCH');
      if (existing.status !== 'COMPLETED') throw new FiscalError('IDEMPOTENCY_IN_PROGRESS');
      return existing.responseBody as any;
    }
  }

  async reserveDocumentNumber(context: ActorContext, fiscalYearId: bigint, documentType: string, padding = 6) {
    const year = await this.prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId: context.companyId } });
    if (!year) throw new FiscalError('NOT_FOUND');
    const generatedPrefix = prefix(year.startDate, year.endDate);
    let sequence;
    try {
      sequence = await this.prisma.documentSequence.upsert({
        where: { fiscalYearId_documentType: { fiscalYearId, documentType } },
        update: {},
        create: { companyId: context.companyId, fiscalYearId, documentType, prefix: generatedPrefix, padding },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      sequence = await this.prisma.documentSequence.findUniqueOrThrow({ where: { fiscalYearId_documentType: { fiscalYearId, documentType } } });
    }
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE document_sequences SET next_number=LAST_INSERT_ID(next_number + 1), updated_at=CURRENT_TIMESTAMP(3) WHERE id=${sequence.id}`;
          const rows = await tx.$queryRaw<Array<{ next_number: bigint }>>`SELECT LAST_INSERT_ID() AS next_number`;
          const nextNumber = rows[0]?.next_number; if (!nextNumber) throw new FiscalError('NOT_FOUND');
          const reserved = nextNumber - 1n;
          return `${sequence.prefix}${reserved.toString().padStart(sequence.padding, '0')}`;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === 'P2034' || (error.code === 'P2010' && String(error.meta?.code) === '1213'));
        if (attempt === 5 || !retryable) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
      }
    }
    throw new Error('Unreachable sequence reservation state');
  }

  static serializePeriod(period: any) {
    return { id: period.id.toString(), fiscalYearId: period.fiscalYearId.toString(), periodNumber: period.periodNumber, name: period.name, startDate: period.startDate.toISOString().slice(0, 10), endDate: period.endDate.toISOString().slice(0, 10), status: period.status, closedBy: period.closedBy?.toString() ?? null, closedAt: period.closedAt?.toISOString() ?? null, reopenedBy: period.reopenedBy?.toString() ?? null, reopenedAt: period.reopenedAt?.toISOString() ?? null, reopenReason: period.reopenReason, version: period.version };
  }
}
