import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { FiscalService } from "../fiscal/fiscal-service.js";
import type { ActorContext } from "../users/user-service.js";
import { archiveDocument } from "../printing/print-archive.js";

export type PaymentErrorReason =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "PERIOD_CLOSED"
  | "DATE_OUTSIDE_PERIOD"
  | "COUNTERPARTY_REQUIRED"
  | "INVALID_SUPPLIER"
  | "INVALID_ACCOUNT"
  | "INVALID_CASH_BANK_ACCOUNT"
  | "INVALID_PAYMENT_METHOD"
  | "REFERENCE_REQUIRED"
  | "INVALID_CURRENCY"
  | "INVALID_AMOUNT"
  | "ALLOCATION_MISMATCH"
  | "INVALID_ALLOCATION"
  | "OVER_ALLOCATION"
  | "ALREADY_REVERSED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";
export class PaymentError extends Error {
  constructor(public readonly reason: PaymentErrorReason) {
    super(reason);
  }
}
const retryableTransactionError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2034" ||
    (error.code === "P2010" && String(error.meta?.code) === "1213"));

async function withTransactionRetry<T>(operation: () => Promise<T>) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 5 || !retryableTransactionError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw new Error("Unreachable transaction retry state");
}
export type AllocationInput = {
  targetJournalLineId: bigint;
  allocatedAmount: string;
};
export type PaymentInput = {
  fiscalPeriodId: bigint;
  documentDate: string;
  description: string;
  supplierId?: bigint | null | undefined;
  counterAccountId?: bigint | null | undefined;
  cashBankAccountId: bigint;
  paymentMethodId: bigint;
  currencyId: bigint;
  exchangeRate: string;
  amount: string;
  referenceNumber?: string | null | undefined;
  counterpartyName: string;
  counterpartyTaxNumber?: string | null | undefined;
  counterpartyAddress?: string | null | undefined;
  notes?: string | null | undefined;
  allocations?: AllocationInput[] | undefined;
};
export type PaymentUpdate = { version: number } & Partial<PaymentInput>;
const date = (v: string) => new Date(`${v}T00:00:00.000Z`);
const digest = (v: string) =>
  new Uint8Array(createHash("sha256").update(v).digest());
const last4 = (v?: string | null) =>
  v ? v.replace(/\s/g, "").slice(-4) : null;
const documentJson = (v: any) => ({
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

export class PaymentService {
  private readonly fiscal: FiscalService;
  constructor(private readonly prisma: PrismaClient) {
    this.fiscal = new FiscalService(prisma);
  }
  private include() {
    return {
      accountingDocument: true,
      allocations: { orderBy: { id: "asc" as const } },
    } as const;
  }
  async list(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      status?: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED" | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      supplierId?: bigint | undefined;
      search?: string | undefined;
    },
  ) {
    const where: Prisma.PaymentWhereInput = {
      companyId: context.companyId,
      ...(input.supplierId ? { supplierId: input.supplierId } : {}),
      accountingDocument: {
        documentType: "PAYMENT",
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
      },
    };
    return this.prisma.$transaction(async (tx) => ({
      data: await tx.payment.findMany({
        where,
        include: this.include(),
        orderBy: { accountingDocument: { documentDate: "desc" } },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.payment.count({ where }),
    }));
  }
  async get(context: ActorContext, id: bigint) {
    const value = await this.prisma.payment.findFirst({
      where: { id, companyId: context.companyId },
      include: this.include(),
    });
    if (!value) throw new PaymentError("NOT_FOUND");
    return value;
  }
  async create(context: ActorContext, input: PaymentInput) {
    const period = await this.openPeriod(
      context.companyId,
      input.fiscalPeriodId,
    );
    this.validDate(period, input.documentDate);
    const documentNumber = await this.fiscal.reserveDocumentNumber(
      context,
      period.fiscalYearId,
      "PAYMENT",
    );
    return withTransactionRetry(() => this.prisma.$transaction(
      async (tx) => {
        const prepared = await this.prepare(tx, context.companyId, input);
        const currentPeriod = await tx.fiscalPeriod.findFirst({
          where: { id: input.fiscalPeriodId, companyId: context.companyId },
        });
        if (!currentPeriod || currentPeriod.status === "CLOSED")
          throw new PaymentError("PERIOD_CLOSED");
        this.validDate(currentPeriod, input.documentDate);
        const document = await tx.accountingDocument.create({
          data: {
            companyId: context.companyId,
            fiscalPeriodId: input.fiscalPeriodId,
            documentType: "PAYMENT",
            documentNumber,
            documentDate: date(input.documentDate),
            description: input.description,
            createdBy: context.userId,
          },
        });
        const { cashBankLedgerAccountId: _cash, counterLedgerAccountId: _counter, ...paymentData } = prepared;
        const payment = await tx.payment.create({
          data: {
            companyId: context.companyId,
            accountingDocumentId: document.id,
            ...paymentData,
          },
          include: this.include(),
        });
        await this.audit(tx, context, "PAYMENT_CREATED", payment.id);
        return payment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ));
  }
  async update(context: ActorContext, id: bigint, input: PaymentUpdate) {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.payment.findFirst({
          where: { id, companyId: context.companyId },
          include: this.include(),
        });
        if (!current) throw new PaymentError("NOT_FOUND");
        if (current.accountingDocument.status !== "DRAFT")
          throw new PaymentError("INVALID_STATE");
        if (current.accountingDocument.version !== input.version)
          throw new PaymentError("VERSION_CONFLICT");
        const merged: PaymentInput = {
          fiscalPeriodId:
            input.fiscalPeriodId ?? current.accountingDocument.fiscalPeriodId,
          documentDate:
            input.documentDate ??
            current.accountingDocument.documentDate.toISOString().slice(0, 10),
          description:
            input.description ?? current.accountingDocument.description,
          supplierId:
            input.supplierId === undefined
              ? current.supplierId
              : input.supplierId,
          counterAccountId:
            input.counterAccountId === undefined
              ? current.counterAccountId
              : input.counterAccountId,
          cashBankAccountId:
            input.cashBankAccountId ?? current.cashBankAccountId,
          paymentMethodId: input.paymentMethodId ?? current.paymentMethodId,
          currencyId: input.currencyId ?? current.currencyId,
          exchangeRate: input.exchangeRate ?? current.exchangeRate.toFixed(8),
          amount: input.amount ?? current.amount.toFixed(4),
          referenceNumber:
            input.referenceNumber === undefined
              ? current.referenceNumber
              : input.referenceNumber,
          counterpartyName:
            input.counterpartyName ?? current.counterpartyNameSnapshot,
          counterpartyTaxNumber: input.counterpartyTaxNumber,
          counterpartyAddress:
            input.counterpartyAddress === undefined
              ? current.counterpartyAddressSnapshot
              : input.counterpartyAddress,
          notes: input.notes === undefined ? current.notes : input.notes,
          allocations:
            input.allocations ??
            current.allocations.map((a) => ({
              targetJournalLineId: a.targetJournalLineId,
              allocatedAmount: a.allocatedAmount.toFixed(4),
            })),
        };
        const period = await tx.fiscalPeriod.findFirst({
          where: { id: merged.fiscalPeriodId, companyId: context.companyId },
        });
        if (!period || period.status === "CLOSED")
          throw new PaymentError("PERIOD_CLOSED");
        this.validDate(period, merged.documentDate);
        const prepared = await this.prepare(tx, context.companyId, merged);
        if (input.counterpartyTaxNumber === undefined) prepared.counterpartyTaxLast4 = current.counterpartyTaxLast4;
        const changed = await tx.accountingDocument.updateMany({
          where: {
            id: current.accountingDocumentId,
            companyId: context.companyId,
            status: "DRAFT",
            version: input.version,
          },
          data: {
            fiscalPeriodId: merged.fiscalPeriodId,
            documentDate: date(merged.documentDate),
            description: merged.description,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new PaymentError("VERSION_CONFLICT");
        await tx.paymentAllocation.deleteMany({
          where: { paymentId: id, companyId: context.companyId },
        });
        const { cashBankLedgerAccountId: _cash, counterLedgerAccountId: _counter, ...paymentData } = prepared;
        await tx.payment.update({ where: { id }, data: paymentData });
        await this.audit(tx, context, "PAYMENT_UPDATED", id);
        return tx.payment.findUniqueOrThrow({
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
      "POST_PAYMENT",
      key,
      JSON.stringify({ id: id.toString(), version }),
      async (tx, payment) => {
        if (payment.accountingDocument.status !== "DRAFT")
          throw new PaymentError("INVALID_STATE");
        if (payment.accountingDocument.version !== version)
          throw new PaymentError("VERSION_CONFLICT");
        const period = await tx.fiscalPeriod.findFirst({
          where: {
            id: payment.accountingDocument.fiscalPeriodId,
            companyId: context.companyId,
          },
        });
        if (!period || period.status === "CLOSED")
          throw new PaymentError("PERIOD_CLOSED");
        const prepared = await this.prepare(
          tx,
          context.companyId,
          this.inputFrom(payment),
        );
        await this.validateOutstanding(tx, context.companyId, payment);
        const entry = await tx.journalEntry.create({
          data: {
            companyId: context.companyId,
            accountingDocumentId: payment.accountingDocumentId,
            entryNumber: 1,
            entryDate: payment.accountingDocument.documentDate,
            description: payment.accountingDocument.description,
            lines: {
              create: [
                {
                  lineNumber: 1,
                  accountId: prepared.cashBankLedgerAccountId,
                  description: payment.accountingDocument.description,
                  currencyId: payment.currencyId,
                  exchangeRate: payment.exchangeRate,
                  debitAmount: new Prisma.Decimal(0),
                  creditAmount: payment.amount,
                  baseDebitAmount: new Prisma.Decimal(0),
                  baseCreditAmount: payment.baseAmount,
                },
                {
                  lineNumber: 2,
                  accountId: prepared.counterLedgerAccountId,
                  supplierId: payment.supplierId,
                  description: payment.accountingDocument.description,
                  currencyId: payment.currencyId,
                  exchangeRate: payment.exchangeRate,
                  debitAmount: payment.amount,
                  creditAmount: new Prisma.Decimal(0),
                  baseDebitAmount: payment.baseAmount,
                  baseCreditAmount: new Prisma.Decimal(0),
                },
              ],
            },
          },
        });
        const changed = await tx.accountingDocument.updateMany({
          where: {
            id: payment.accountingDocumentId,
            companyId: context.companyId,
            status: "DRAFT",
            version,
          },
          data: {
            status: "POSTED",
            postedBy: context.userId,
            postedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new PaymentError("VERSION_CONFLICT");
        await archiveDocument(tx, context, payment.accountingDocumentId);
        return {
          document: await tx.accountingDocument.findUniqueOrThrow({
            where: { id: payment.accountingDocumentId },
          }),
          ids: [entry.id.toString()],
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
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id, companyId: context.companyId },
        include: { accountingDocument: true },
      });
      if (!payment) throw new PaymentError("NOT_FOUND");
      if (payment.accountingDocument.status !== "DRAFT")
        throw new PaymentError("INVALID_STATE");
      const changed = await tx.accountingDocument.updateMany({
        where: { id: payment.accountingDocumentId, status: "DRAFT", version },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new PaymentError("VERSION_CONFLICT");
      await this.audit(tx, context, "PAYMENT_CANCELLED", id, { reason });
      return {
        document: await tx.accountingDocument.findUniqueOrThrow({
          where: { id: payment.accountingDocumentId },
        }),
        ids: [] as string[],
        requestId: randomUUID(),
      };
    });
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
      "REVERSE_PAYMENT",
      key,
      JSON.stringify({ id: id.toString(), ...input }),
      async (tx, payment) => {
        const originalDocument = payment.accountingDocument;
        if (
          originalDocument.status === "REVERSED" ||
          originalDocument.reversedByDocumentId
        )
          throw new PaymentError("ALREADY_REVERSED");
        if (originalDocument.status !== "POSTED")
          throw new PaymentError("INVALID_STATE");
        if (originalDocument.version !== input.version)
          throw new PaymentError("VERSION_CONFLICT");
        const reversalDate = date(input.reversalDate);
        const period = await tx.fiscalPeriod.findFirst({
          where: {
            companyId: context.companyId,
            startDate: { lte: reversalDate },
            endDate: { gte: reversalDate },
            status: { not: "CLOSED" },
          },
        });
        if (!period) throw new PaymentError("PERIOD_CLOSED");
        const originalEntry = await tx.journalEntry.findFirstOrThrow({
          where: {
            accountingDocumentId: originalDocument.id,
            companyId: context.companyId,
          },
          include: { lines: true },
        });
        const documentNumber = await this.reserveInTransaction(
          tx,
          context.companyId,
          period.fiscalYearId,
          "PAYMENT",
        );
        const reversal = await tx.accountingDocument.create({
          data: {
            companyId: context.companyId,
            fiscalPeriodId: period.id,
            documentType: "PAYMENT",
            documentNumber,
            documentDate: reversalDate,
            description: `عكس ${originalDocument.documentNumber}: ${input.reason}`,
            status: "POSTED",
            createdBy: context.userId,
            postedBy: context.userId,
            postedAt: new Date(),
            journalEntries: {
              create: [
                {
                  entryNumber: 1,
                  entryDate: reversalDate,
                  description: `عكس: ${originalEntry.description}`,
                  reversalOfJournalEntryId: originalEntry.id,
                  lines: {
                    create: originalEntry.lines.map((line) => ({
                      lineNumber: line.lineNumber,
                      accountId: line.accountId,
                      costCenterId: line.costCenterId,
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
                },
              ],
            },
          },
          include: { journalEntries: true },
        });
        const changed = await tx.accountingDocument.updateMany({
          where: {
            id: originalDocument.id,
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
        if (changed.count !== 1) throw new PaymentError("VERSION_CONFLICT");
        await archiveDocument(tx, context, reversal.id);
        return {
          document: await tx.accountingDocument.findUniqueOrThrow({
            where: { id: originalDocument.id },
          }),
          ids: reversal.journalEntries.map((e) => e.id.toString()),
        };
      },
    );
  }
  static json(v: any) {
    return {
      id: v.id.toString(),
      document: documentJson(v.accountingDocument),
      supplierId: v.supplierId?.toString() ?? null,
      counterAccountId: v.counterAccountId?.toString() ?? null,
      cashBankAccountId: v.cashBankAccountId.toString(),
      paymentMethodId: v.paymentMethodId.toString(),
      currencyId: v.currencyId.toString(),
      exchangeRate: v.exchangeRate.toFixed(8),
      amount: v.amount.toFixed(4),
      baseAmount: v.baseAmount.toFixed(4),
      referenceNumber: v.referenceNumber,
      counterpartyNameSnapshot: v.counterpartyNameSnapshot,
      counterpartyTaxMasked: v.counterpartyTaxLast4
        ? `****${v.counterpartyTaxLast4}`
        : null,
      counterpartyAddressSnapshot: v.counterpartyAddressSnapshot,
      notes: v.notes,
      allocations: v.allocations.map((a: any) => ({
        id: a.id.toString(),
        targetJournalLineId: a.targetJournalLineId.toString(),
        allocatedAmount: a.allocatedAmount.toFixed(4),
      })),
    };
  }
  static commandJson(v: any) {
    return {
      document:
        typeof v.document.id === "string"
          ? v.document
          : documentJson(v.document),
      generatedJournalEntryIds: v.generatedJournalEntryIds ?? v.ids ?? [],
      requestId: v.requestId,
    };
  }
  private async openPeriod(companyId: bigint, id: bigint) {
    const value = await this.prisma.fiscalPeriod.findFirst({
      where: { id, companyId },
    });
    if (!value) throw new PaymentError("NOT_FOUND");
    if (value.status === "CLOSED") throw new PaymentError("PERIOD_CLOSED");
    return value;
  }
  private validDate(period: { startDate: Date; endDate: Date }, value: string) {
    const d = date(value);
    if (d < period.startDate || d > period.endDate)
      throw new PaymentError("DATE_OUTSIDE_PERIOD");
  }
  private async validAccount(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    id: bigint,
  ) {
    const value = await tx.account.findFirst({
      where: { id, companyId },
      include: { _count: { select: { children: true } } },
    });
    if (
      !value ||
      !value.isActive ||
      !value.allowsPosting ||
      value._count.children
    )
      throw new PaymentError("INVALID_ACCOUNT");
    return value;
  }
  private async prepare(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    input: PaymentInput,
  ) {
    if ((input.supplierId == null) === (input.counterAccountId == null))
      throw new PaymentError("COUNTERPARTY_REQUIRED");
    const amount = new Prisma.Decimal(input.amount),
      rate = new Prisma.Decimal(input.exchangeRate);
    if (amount.lte(0) || rate.lte(0)) throw new PaymentError("INVALID_AMOUNT");
    let counterLedgerAccountId: bigint;
    if (input.supplierId != null) {
      const supplier = await tx.supplier.findFirst({
        where: { id: input.supplierId, companyId, isActive: true },
      });
      if (!supplier) throw new PaymentError("INVALID_SUPPLIER");
      await this.validAccount(tx, companyId, supplier.payableAccountId);
      counterLedgerAccountId = supplier.payableAccountId;
    } else {
      await this.validAccount(tx, companyId, input.counterAccountId!);
      counterLedgerAccountId = input.counterAccountId!;
    }
    const cash = await tx.cashBankAccount.findFirst({
      where: { id: input.cashBankAccountId, companyId, isActive: true },
    });
    if (!cash) throw new PaymentError("INVALID_CASH_BANK_ACCOUNT");
    await this.validAccount(tx, companyId, cash.ledgerAccountId);
    const method = await tx.paymentMethod.findFirst({
      where: {
        id: input.paymentMethodId,
        isActive: true,
        OR: [
          { scope: "GLOBAL", companyId: null },
          { scope: "COMPANY", companyId },
        ],
      },
    });
    if (!method) throw new PaymentError("INVALID_PAYMENT_METHOD");
    if (method.requiresReference && !input.referenceNumber?.trim())
      throw new PaymentError("REFERENCE_REQUIRED");
    const currency = await tx.currency.findFirst({
      where: { id: input.currencyId, isActive: true },
    });
    if (!currency) throw new PaymentError("INVALID_CURRENCY");
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    if (input.currencyId === company.baseCurrencyId && !rate.equals(1))
      throw new PaymentError("INVALID_CURRENCY");
    const allocations = input.allocations ?? [];
    if (
      new Set(allocations.map((a) => a.targetJournalLineId.toString())).size !==
      allocations.length
    )
      throw new PaymentError("INVALID_ALLOCATION");
    const allocationSum = allocations.reduce(
      (sum, a) => sum.add(a.allocatedAmount),
      new Prisma.Decimal(0),
    );
    if (allocations.some((a) => new Prisma.Decimal(a.allocatedAmount).lte(0)))
      throw new PaymentError("INVALID_ALLOCATION");
    if (allocations.length && !allocationSum.equals(amount))
      throw new PaymentError("ALLOCATION_MISMATCH");
    for (const allocation of allocations) {
      const line = await tx.journalLine.findFirst({
        where: {
          id: allocation.targetJournalLineId,
          companyId,
          currencyId: input.currencyId,
          journalEntry: { accountingDocument: { status: "POSTED" } },
        },
      });
      if (
        !line ||
        line.creditAmount.lte(line.debitAmount) ||
        (input.supplierId != null && line.supplierId !== input.supplierId)
      )
        throw new PaymentError("INVALID_ALLOCATION");
    }
    return {
      supplierId: input.supplierId ?? null,
      counterAccountId: input.counterAccountId ?? null,
      cashBankAccountId: input.cashBankAccountId,
      paymentMethodId: input.paymentMethodId,
      currencyId: input.currencyId,
      exchangeRate: rate,
      amount,
      baseAmount: amount.mul(rate).toDecimalPlaces(4),
      referenceNumber: input.referenceNumber ?? null,
      counterpartyNameSnapshot: input.counterpartyName,
      counterpartyTaxLast4: last4(input.counterpartyTaxNumber),
      counterpartyAddressSnapshot: input.counterpartyAddress ?? null,
      notes: input.notes ?? null,
      ...(allocations.length
        ? { allocations: {
            create: allocations.map((a) => ({
              targetJournalLineId: a.targetJournalLineId,
              allocatedAmount: new Prisma.Decimal(a.allocatedAmount),
            })),
          } }
        : {}),
      cashBankLedgerAccountId: cash.ledgerAccountId,
      counterLedgerAccountId,
    };
  }
  private inputFrom(v: any): PaymentInput {
    return {
      fiscalPeriodId: v.accountingDocument.fiscalPeriodId,
      documentDate: v.accountingDocument.documentDate
        .toISOString()
        .slice(0, 10),
      description: v.accountingDocument.description,
      supplierId: v.supplierId,
      counterAccountId: v.counterAccountId,
      cashBankAccountId: v.cashBankAccountId,
      paymentMethodId: v.paymentMethodId,
      currencyId: v.currencyId,
      exchangeRate: v.exchangeRate.toFixed(8),
      amount: v.amount.toFixed(4),
      referenceNumber: v.referenceNumber,
      counterpartyName: v.counterpartyNameSnapshot,
      counterpartyAddress: v.counterpartyAddressSnapshot,
      notes: v.notes,
      allocations: v.allocations.map((a: any) => ({
        targetJournalLineId: a.targetJournalLineId,
        allocatedAmount: a.allocatedAmount.toFixed(4),
      })),
    };
  }
  private async validateOutstanding(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    payment: any,
  ) {
    for (const allocation of payment.allocations) {
      const target = await tx.journalLine.findFirstOrThrow({
        where: { id: allocation.targetJournalLineId, companyId },
      });
      const used = await tx.paymentAllocation.aggregate({
        where: {
          companyId,
          targetJournalLineId: target.id,
          paymentId: { not: payment.id },
          payment: { accountingDocument: { status: "POSTED" } },
        },
        _sum: { allocatedAmount: true },
      });
      if (
        new Prisma.Decimal(used._sum.allocatedAmount ?? 0)
          .add(allocation.allocatedAmount)
          .gt(target.creditAmount.sub(target.debitAmount))
      )
        throw new PaymentError("OVER_ALLOCATION");
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
    if (!year) throw new PaymentError("NOT_FOUND");
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
        entityType: "PAYMENT",
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
      payment: any,
    ) => Promise<{ document: any; ids: string[] }>,
  ) {
    const keyHash = digest(key),
      requestFingerprint = digest(fingerprint);
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
              throw new PaymentError("IDEMPOTENCY_MISMATCH");
            if (existing.status === "COMPLETED")
              return existing.responseBody as any;
            throw new PaymentError("IDEMPOTENCY_IN_PROGRESS");
          }
          const payment = await tx.payment.findFirst({
            where: { id, companyId: context.companyId },
            include: this.include(),
          });
          if (!payment) throw new PaymentError("NOT_FOUND");
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
          const result = await execute(tx, payment);
          await this.audit(tx, context, operation, id);
          const response = {
            document: documentJson(result.document),
            generatedJournalEntryIds: result.ids,
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
      for (let i = 1; i <= 10; i++) {
        await new Promise((r) => setTimeout(r, i * 10));
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
          throw new PaymentError("IDEMPOTENCY_MISMATCH");
        if (existing.status === "COMPLETED")
          return existing.responseBody as any;
      }
      throw new PaymentError("IDEMPOTENCY_IN_PROGRESS");
    }
  }
}
