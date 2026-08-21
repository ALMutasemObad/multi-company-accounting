import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";
import { archiveDocument } from "../printing/print-archive.js";
import { FiscalService } from "../fiscal/fiscal-service.js";

export type JournalErrorReason =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "PERIOD_CLOSED"
  | "DATE_OUTSIDE_PERIOD"
  | "INVALID_ACCOUNT"
  | "INVALID_COST_CENTER"
  | "INVALID_CURRENCY"
  | "INVALID_LINE"
  | "DUPLICATE_NUMBER"
  | "UNBALANCED"
  | "MAKER_CHECKER_VIOLATION"
  | "ALREADY_REVERSED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";
export class JournalError extends Error {
  constructor(public readonly reason: JournalErrorReason) {
    super(reason);
  }
}
export type JournalLineInput = {
  lineNumber: number;
  accountId: bigint;
  costCenterId?: bigint | null | undefined;
  customerId?: bigint | null | undefined;
  supplierId?: bigint | null | undefined;
  description?: string | null | undefined;
  currencyId: bigint;
  exchangeRate: string;
  debitAmount: string;
  creditAmount: string;
};
export type JournalEntryInput = {
  entryNumber: number;
  entryDate: string;
  description: string;
  lines: JournalLineInput[];
};
export type JournalCreateInput = {
  fiscalPeriodId: bigint;
  documentDate: string;
  description: string;
  entries: JournalEntryInput[];
};
export type JournalUpdateInput = {
  version: number;
  fiscalPeriodId?: bigint | undefined;
  documentDate?: string | undefined;
  description?: string | undefined;
  entries?: JournalEntryInput[] | undefined;
};
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const digest = (value: string) =>
  new Uint8Array(createHash("sha256").update(value).digest());
const serializeDocument = (v: any) => ({
  id: v.id.toString(),
  documentType: v.documentType,
  documentNumber: v.documentNumber,
  documentDate: v.documentDate.toISOString().slice(0, 10),
  description: v.description,
  status: v.status,
  fiscalPeriodId: v.fiscalPeriodId.toString(),
  version: v.version,
  createdBy: v.createdBy.toString(),
  createdAt: v.createdAt.toISOString(),
  postedBy: v.postedBy?.toString() ?? null,
  postedAt: v.postedAt?.toISOString() ?? null,
  reversedByDocumentId: v.reversedByDocumentId?.toString() ?? null,
});

export class ManualJournalService {
  private readonly fiscal: FiscalService;
  constructor(private readonly prisma: PrismaClient) {
    this.fiscal = new FiscalService(prisma);
  }

  async list(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      status?: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED" | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      search?: string | undefined;
    },
  ) {
    const where: Prisma.AccountingDocumentWhereInput = {
      companyId: context.companyId,
      documentType: "MANUAL_JOURNAL",
      ...(input.status ? { status: input.status } : {}),
      ...(input.dateFrom || input.dateTo
        ? {
            documentDate: {
              ...(input.dateFrom ? { gte: date(input.dateFrom) } : {}),
              ...(input.dateTo ? { lte: date(input.dateTo) } : {}),
            },
          }
        : {}),
      ...(input.search
        ? {
            OR: [
              { documentNumber: { contains: input.search } },
              { description: { contains: input.search } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.accountingDocument.findMany({
        where,
        include: this.include(),
        orderBy: [{ documentDate: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.accountingDocument.count({ where }),
    }));
  }
  async get(context: ActorContext, id: bigint) {
    const value = await this.prisma.accountingDocument.findFirst({
      where: {
        id,
        companyId: context.companyId,
        documentType: "MANUAL_JOURNAL",
      },
      include: this.include(),
    });
    if (!value) throw new JournalError("NOT_FOUND");
    return value;
  }

  async create(context: ActorContext, input: JournalCreateInput) {
    const period = await this.openPeriod(
      context.companyId,
      input.fiscalPeriodId,
    );
    this.assertDates(period, input.documentDate, input.entries);
    const documentNumber = await this.fiscal.reserveDocumentNumber(
      context,
      period.fiscalYearId,
      "MANUAL_JOURNAL",
    );
    return this.prisma.$transaction(
      async (tx) => {
        const currentPeriod = await tx.fiscalPeriod.findFirst({
          where: { id: input.fiscalPeriodId, companyId: context.companyId },
        });
        if (!currentPeriod || currentPeriod.status === "CLOSED")
          throw new JournalError("PERIOD_CLOSED");
        this.assertDates(currentPeriod, input.documentDate, input.entries);
        const entries = await this.prepareEntries(
          tx,
          context.companyId,
          input.entries,
        );
        const value = await tx.accountingDocument.create({
          data: {
            companyId: context.companyId,
            fiscalPeriodId: input.fiscalPeriodId,
            documentType: "MANUAL_JOURNAL",
            documentNumber,
            documentDate: date(input.documentDate),
            description: input.description,
            createdBy: context.userId,
            journalEntries: { create: entries },
          },
          include: this.include(),
        });
        await this.audit(tx, context, "MANUAL_JOURNAL_CREATED", value.id);
        return value;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async update(context: ActorContext, id: bigint, input: JournalUpdateInput) {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.accountingDocument.findFirst({
          where: {
            id,
            companyId: context.companyId,
            documentType: "MANUAL_JOURNAL",
          },
          include: { journalEntries: true },
        });
        if (!current) throw new JournalError("NOT_FOUND");
        if (current.status !== "DRAFT") throw new JournalError("INVALID_STATE");
        if (current.version !== input.version)
          throw new JournalError("VERSION_CONFLICT");
        const periodId = input.fiscalPeriodId ?? current.fiscalPeriodId;
        const period = await tx.fiscalPeriod.findFirst({
          where: { id: periodId, companyId: context.companyId },
        });
        if (!period || period.status === "CLOSED")
          throw new JournalError("PERIOD_CLOSED");
        const documentDate =
          input.documentDate ?? current.documentDate.toISOString().slice(0, 10);
        let entries:
          | Awaited<ReturnType<ManualJournalService["prepareEntries"]>>
          | undefined;
        if (input.entries) {
          this.assertDates(period, documentDate, input.entries);
          entries = await this.prepareEntries(
            tx,
            context.companyId,
            input.entries,
          );
        } else {
          if (
            date(documentDate) < period.startDate ||
            date(documentDate) > period.endDate
          )
            throw new JournalError("DATE_OUTSIDE_PERIOD");
          const invalidExisting = current.journalEntries.some(
            (entry) =>
              entry.entryDate < period.startDate ||
              entry.entryDate > period.endDate,
          );
          if (invalidExisting) throw new JournalError("DATE_OUTSIDE_PERIOD");
        }
        const changed = await tx.accountingDocument.updateMany({
          where: {
            id,
            companyId: context.companyId,
            status: "DRAFT",
            version: input.version,
          },
          data: {
            fiscalPeriodId: periodId,
            documentDate: date(documentDate),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new JournalError("VERSION_CONFLICT");
        if (entries) {
          await tx.journalLine.deleteMany({
            where: { companyId: context.companyId, journalEntry: { accountingDocumentId: id } },
          });
          await tx.journalEntry.deleteMany({
            where: { accountingDocumentId: id, companyId: context.companyId },
          });
          for (const entry of entries)
            await tx.journalEntry.create({
              data: {
                ...entry,
                accountingDocumentId: id,
                companyId: context.companyId,
              },
            });
        }
        await this.audit(tx, context, "MANUAL_JOURNAL_UPDATED", id);
        return tx.accountingDocument.findUniqueOrThrow({
          where: { id },
          include: this.include(),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  post(context: ActorContext, id: bigint, version: number, key: string) {
    return this.command(
      context,
      id,
      "POST_MANUAL_JOURNAL",
      key,
      JSON.stringify({ id: id.toString(), version }),
      async (tx, document) => {
        if (document.status !== "DRAFT")
          throw new JournalError("INVALID_STATE");
        if (document.version !== version)
          throw new JournalError("VERSION_CONFLICT");
        const company = await tx.company.findUniqueOrThrow({
          where: { id: context.companyId },
        });
        if (
          company.manualJournalMakerCheckerEnabled &&
          document.createdBy === context.userId
        )
          throw new JournalError("MAKER_CHECKER_VIOLATION");
        const period = await tx.fiscalPeriod.findFirst({
          where: { id: document.fiscalPeriodId, companyId: context.companyId },
        });
        if (!period || period.status === "CLOSED")
          throw new JournalError("PERIOD_CLOSED");
        const full = await tx.accountingDocument.findUniqueOrThrow({
          where: { id },
          include: this.include(),
        });
        this.assertDates(
          period,
          full.documentDate.toISOString().slice(0, 10),
          full.journalEntries.map((entry) => ({
            entryNumber: entry.entryNumber,
            entryDate: entry.entryDate.toISOString().slice(0, 10),
            description: entry.description,
            lines: entry.lines.map((line) => ({
              lineNumber: line.lineNumber,
              accountId: line.accountId,
              costCenterId: line.costCenterId,
              customerId: line.customerId,
              supplierId: line.supplierId,
              description: line.description,
              currencyId: line.currencyId,
              exchangeRate: line.exchangeRate.toFixed(8),
              debitAmount: line.debitAmount.toFixed(4),
              creditAmount: line.creditAmount.toFixed(4),
            })),
          })),
        );
        await this.validatePersisted(tx, context.companyId, full);
        const changed = await tx.accountingDocument.updateMany({
          where: { id, companyId: context.companyId, status: "DRAFT", version },
          data: {
            status: "POSTED",
            postedBy: context.userId,
            postedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new JournalError("VERSION_CONFLICT");
        await archiveDocument(tx, context, id);
        return {
          document: await tx.accountingDocument.findUniqueOrThrow({
            where: { id },
          }),
          generatedJournalEntryIds: full.journalEntries.map((entry) =>
            entry.id.toString(),
          ),
        };
      },
    );
  }

  async cancel(
    context: ActorContext,
    id: bigint,
    version: number,
    reason: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.accountingDocument.findFirst({
          where: {
            id,
            companyId: context.companyId,
            documentType: "MANUAL_JOURNAL",
          },
        });
        if (!current) throw new JournalError("NOT_FOUND");
        if (current.status !== "DRAFT") throw new JournalError("INVALID_STATE");
        const changed = await tx.accountingDocument.updateMany({
          where: { id, companyId: context.companyId, status: "DRAFT", version },
          data: { status: "CANCELLED", version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new JournalError("VERSION_CONFLICT");
        await this.audit(tx, context, "MANUAL_JOURNAL_CANCELLED", id, {
          reason,
        });
        return {
          document: await tx.accountingDocument.findUniqueOrThrow({
            where: { id },
          }),
          generatedJournalEntryIds: [] as string[],
          requestId: randomUUID(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  reverse(
    context: ActorContext,
    id: bigint,
    input: { version: number; reversalDate: string; reason: string },
    key: string,
  ) {
    return this.command(
      context,
      id,
      "REVERSE_MANUAL_JOURNAL",
      key,
      JSON.stringify({ id: id.toString(), ...input }),
      async (tx, document) => {
        if (document.status === "REVERSED" || document.reversedByDocumentId)
          throw new JournalError("ALREADY_REVERSED");
        if (document.status !== "POSTED")
          throw new JournalError("INVALID_STATE");
        if (document.version !== input.version)
          throw new JournalError("VERSION_CONFLICT");
        const reversalDate = date(input.reversalDate);
        const period = await tx.fiscalPeriod.findFirst({
          where: {
            companyId: context.companyId,
            startDate: { lte: reversalDate },
            endDate: { gte: reversalDate },
            status: { not: "CLOSED" },
          },
        });
        if (!period) throw new JournalError("PERIOD_CLOSED");
        const original = await tx.accountingDocument.findUniqueOrThrow({
          where: { id },
          include: this.include(),
        });
        const documentNumber = await this.reserveInTransaction(
          tx,
          context.companyId,
          period.fiscalYearId,
          "MANUAL_JOURNAL",
        );
        const reversal = await tx.accountingDocument.create({
          data: {
            companyId: context.companyId,
            fiscalPeriodId: period.id,
            documentType: "MANUAL_JOURNAL",
            documentNumber,
            documentDate: reversalDate,
            description: `عكس ${original.documentNumber}: ${input.reason}`,
            status: "POSTED",
            createdBy: context.userId,
            postedBy: context.userId,
            postedAt: new Date(),
            journalEntries: {
              create: original.journalEntries.map((entry) => ({
                entryNumber: entry.entryNumber,
                entryDate: reversalDate,
                description: `عكس: ${entry.description}`,
                reversalOfJournalEntryId: entry.id,
                lines: {
                  create: entry.lines.map((line) => ({
                    lineNumber: line.lineNumber,
                    accountId: line.accountId,
                    costCenterId: line.costCenterId,
                    customerId: line.customerId,
                    supplierId: line.supplierId,
                    description: line.description,
                    currencyId: line.currencyId,
                    exchangeRate: line.exchangeRate,
                    debitAmount: line.creditAmount,
                    creditAmount: line.debitAmount,
                    baseDebitAmount: line.baseCreditAmount,
                    baseCreditAmount: line.baseDebitAmount,
                  })),
                },
              })),
            },
          },
          include: this.include(),
        });
        const changed = await tx.accountingDocument.updateMany({
          where: {
            id,
            companyId: context.companyId,
            status: "POSTED",
            version: input.version,
            reversedByDocumentId: null,
          },
          data: {
            status: "REVERSED",
            reversedByDocumentId: reversal.id,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new JournalError("VERSION_CONFLICT");
        await archiveDocument(tx, context, reversal.id);
        return {
          document: await tx.accountingDocument.findUniqueOrThrow({
            where: { id },
          }),
          generatedJournalEntryIds: reversal.journalEntries.map((entry) =>
            entry.id.toString(),
          ),
        };
      },
    );
  }

  static serialize(value: any) {
    return {
      document: serializeDocument(value),
      entries: value.journalEntries.map((entry: any) => ({
        id: entry.id.toString(),
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate.toISOString().slice(0, 10),
        description: entry.description,
        reversalOfJournalEntryId:
          entry.reversalOfJournalEntryId?.toString() ?? null,
        lines: entry.lines.map((line: any) => ({
          id: line.id.toString(),
          lineNumber: line.lineNumber,
          accountId: line.accountId.toString(),
          costCenterId: line.costCenterId?.toString() ?? null,
          customerId: line.customerId?.toString() ?? null,
          supplierId: line.supplierId?.toString() ?? null,
          description: line.description,
          currencyId: line.currencyId.toString(),
          exchangeRate: line.exchangeRate.toFixed(8),
          debitAmount: line.debitAmount.toFixed(4),
          creditAmount: line.creditAmount.toFixed(4),
          baseDebitAmount: line.baseDebitAmount.toFixed(4),
          baseCreditAmount: line.baseCreditAmount.toFixed(4),
        })),
      })),
    };
  }
  static serializeCommand(value: any) {
    return {
      document:
        typeof value.document.id === "string"
          ? value.document
          : serializeDocument(value.document),
      generatedJournalEntryIds: value.generatedJournalEntryIds ?? [],
      requestId: value.requestId,
    };
  }

  private include() {
    return {
      journalEntries: {
        include: { lines: true },
        orderBy: { entryNumber: "asc" as const },
      },
    } as const;
  }
  private async openPeriod(companyId: bigint, id: bigint) {
    const value = await this.prisma.fiscalPeriod.findFirst({
      where: { id, companyId },
    });
    if (!value) throw new JournalError("NOT_FOUND");
    if (value.status === "CLOSED") throw new JournalError("PERIOD_CLOSED");
    return value;
  }
  private assertDates(
    period: { startDate: Date; endDate: Date },
    documentDate: string,
    entries: JournalEntryInput[],
  ) {
    const dates = [
      date(documentDate),
      ...entries.map((entry) => date(entry.entryDate)),
    ];
    if (
      dates.some((value) => value < period.startDate || value > period.endDate)
    )
      throw new JournalError("DATE_OUTSIDE_PERIOD");
  }
  private async prepareEntries(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    entries: JournalEntryInput[],
  ) {
    if (
      new Set(entries.map((entry) => entry.entryNumber)).size !== entries.length
    )
      throw new JournalError("DUPLICATE_NUMBER");
    const output = [];
    for (const entry of entries) {
      if (
        new Set(entry.lines.map((line) => line.lineNumber)).size !==
        entry.lines.length
      )
        throw new JournalError("DUPLICATE_NUMBER");
      const lines = [];
      for (const line of entry.lines) {
        const debit = new Prisma.Decimal(line.debitAmount);
        const credit = new Prisma.Decimal(line.creditAmount);
        const rate = new Prisma.Decimal(line.exchangeRate);
        if (
          rate.lte(0) ||
          debit.gt(0) === credit.gt(0) ||
          debit.lt(0) ||
          credit.lt(0) ||
          (line.customerId != null && line.supplierId != null)
        )
          throw new JournalError("INVALID_LINE");
        const account = await tx.account.findFirst({
          where: { id: line.accountId, companyId },
          include: { _count: { select: { children: true } } },
        });
        if (
          !account ||
          !account.isActive ||
          !account.allowsPosting ||
          account._count.children > 0
        )
          throw new JournalError("INVALID_ACCOUNT");
        if (
          line.costCenterId != null &&
          !(await tx.costCenter.findFirst({
            where: { id: line.costCenterId, companyId, isActive: true },
          }))
        )
          throw new JournalError("INVALID_COST_CENTER");
        const currency = await tx.companyCurrency.findFirst({
          where: { companyId, currencyId: line.currencyId, isActive: true, currency: { isActive: true } },
        });
        if (!currency) throw new JournalError("INVALID_CURRENCY");
        const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
        });
        if (line.currencyId === company.baseCurrencyId && !rate.equals(1))
          throw new JournalError("INVALID_CURRENCY");
        lines.push({
          lineNumber: line.lineNumber,
          accountId: line.accountId,
          costCenterId: line.costCenterId ?? null,
          customerId: line.customerId ?? null,
          supplierId: line.supplierId ?? null,
          description: line.description ?? null,
          currencyId: line.currencyId,
          exchangeRate: rate,
          debitAmount: debit,
          creditAmount: credit,
          baseDebitAmount: debit.mul(rate).toDecimalPlaces(4),
          baseCreditAmount: credit.mul(rate).toDecimalPlaces(4),
        });
      }
      output.push({
        entryNumber: entry.entryNumber,
        entryDate: date(entry.entryDate),
        description: entry.description,
        lines: { create: lines },
      });
    }
    return output;
  }
  private async validatePersisted(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    document: any,
  ) {
    if (!document.journalEntries.length) throw new JournalError("INVALID_LINE");
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    for (const entry of document.journalEntries) {
      if (entry.lines.length < 2) throw new JournalError("INVALID_LINE");
      let debit = new Prisma.Decimal(0);
      let credit = new Prisma.Decimal(0);
      for (const line of entry.lines) {
        const hasDebit = line.debitAmount.gt(0);
        const hasCredit = line.creditAmount.gt(0);
        if (
          hasDebit === hasCredit ||
          line.debitAmount.lt(0) ||
          line.creditAmount.lt(0) ||
          line.exchangeRate.lte(0) ||
          (line.customerId != null && line.supplierId != null)
        ) throw new JournalError("INVALID_LINE");
        const account = await tx.account.findFirst({
          where: { id: line.accountId, companyId },
          include: { _count: { select: { children: true } } },
        });
        if (
          !account ||
          !account.isActive ||
          !account.allowsPosting ||
          account._count.children > 0
        )
          throw new JournalError("INVALID_ACCOUNT");
        if (
          line.costCenterId &&
          !(await tx.costCenter.findFirst({
            where: { id: line.costCenterId, companyId, isActive: true },
          }))
        )
          throw new JournalError("INVALID_COST_CENTER");
        const currency = await tx.companyCurrency.findFirst({
            where: { companyId, currencyId: line.currencyId, isActive: true, currency: { isActive: true } },
          });
        if (!currency || (line.currencyId === company.baseCurrencyId && !line.exchangeRate.equals(1))) throw new JournalError("INVALID_CURRENCY");
        if (
          !line.baseDebitAmount.equals(line.debitAmount.mul(line.exchangeRate).toDecimalPlaces(4)) ||
          !line.baseCreditAmount.equals(line.creditAmount.mul(line.exchangeRate).toDecimalPlaces(4))
        ) throw new JournalError("INVALID_LINE");
        debit = debit.add(line.baseDebitAmount);
        credit = credit.add(line.baseCreditAmount);
      }
      if (!debit.equals(credit)) throw new JournalError("UNBALANCED");
    }
  }
  private async reserveInTransaction(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    fiscalYearId: bigint,
    documentType: string,
  ) {
    const year = await tx.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId },
    });
    if (!year) throw new JournalError("NOT_FOUND");
    const prefix = `${year.startDate.toISOString().slice(0, 10).replaceAll("-", "")}-${year.endDate.toISOString().slice(0, 10).replaceAll("-", "")}-`;
    const sequence = await tx.documentSequence.upsert({
      where: { fiscalYearId_documentType: { fiscalYearId, documentType } },
      update: {},
      create: { companyId, fiscalYearId, documentType, prefix },
    });
    await tx.$executeRaw`UPDATE document_sequences SET next_number=LAST_INSERT_ID(next_number + 1), updated_at=CURRENT_TIMESTAMP(3) WHERE id=${sequence.id}`;
    const rows = await tx.$queryRaw<
      Array<{ value: bigint }>
    >`SELECT LAST_INSERT_ID() AS value`;
    return `${prefix}${(rows[0]!.value - 1n).toString().padStart(sequence.padding, "0")}`;
  }
  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    id: bigint,
    details?: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType: "MANUAL_JOURNAL",
        entityId: id.toString(),
        ...(details ? { details } : {}),
      },
    });
  }
  private async command(
    context: ActorContext,
    id: bigint,
    operation: string,
    key: string,
    fingerprint: string,
    execute: (
      tx: Prisma.TransactionClient,
      document: any,
    ) => Promise<{ document: any; generatedJournalEntryIds: string[] }>,
  ) {
    const keyHash = digest(key);
    const requestFingerprint = digest(fingerprint);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.idempotencyRecord.findUnique({
            where: {
              companyId_userId_operation_keyHash: {
                companyId: context.companyId,
                userId: context.userId,
                operation,
                keyHash,
              },
            },
          });
          if (existing) {
            if (
              !Buffer.from(existing.requestFingerprint).equals(
                Buffer.from(requestFingerprint),
              )
            )
              throw new JournalError("IDEMPOTENCY_MISMATCH");
            if (existing.status === "COMPLETED")
              return existing.responseBody as any;
            throw new JournalError("IDEMPOTENCY_IN_PROGRESS");
          }
          const document = await tx.accountingDocument.findFirst({
            where: {
              id,
              companyId: context.companyId,
              documentType: "MANUAL_JOURNAL",
            },
          });
          if (!document) throw new JournalError("NOT_FOUND");
          const idem = await tx.idempotencyRecord.create({
            data: {
              companyId: context.companyId,
              userId: context.userId,
              operation,
              keyHash,
              requestFingerprint,
              status: "IN_PROGRESS",
              expiresAt: new Date(Date.now() + 86_400_000),
            },
          });
          const result = await execute(tx, document);
          await this.audit(tx, context, operation, id);
          const response = {
            document: serializeDocument(result.document),
            generatedJournalEntryIds: result.generatedJournalEntryIds,
            requestId: randomUUID(),
          };
          await tx.idempotencyRecord.update({
            where: { id: idem.id },
            data: {
              status: "COMPLETED",
              responseStatus: 200,
              responseBody: response,
              completedAt: new Date(),
            },
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !["P2002", "P2034"].includes(error.code)
      )
        throw error;
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
        const existing = await this.prisma.idempotencyRecord.findUnique({
          where: {
            companyId_userId_operation_keyHash: {
              companyId: context.companyId,
              userId: context.userId,
              operation,
              keyHash,
            },
          },
        });
        if (!existing) continue;
        if (
          !Buffer.from(existing.requestFingerprint).equals(
            Buffer.from(requestFingerprint),
          )
        )
          throw new JournalError("IDEMPOTENCY_MISMATCH");
        if (existing.status === "COMPLETED")
          return existing.responseBody as any;
      }
      throw new JournalError("IDEMPOTENCY_IN_PROGRESS");
    }
  }
}
