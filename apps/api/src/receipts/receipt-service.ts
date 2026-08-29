import { randomUUID } from "node:crypto";
import { Prisma, type AccountingDocument, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import {
  PostingEngine,
  type PostingFailureReason,
  type PostingEntryPlan,
} from "../core-accounting/posting-engine.js";
import {
  type RealizedFxAccountPort,
  type RealizedFxAccounts,
} from "../core-accounting/realized-fx-account-service.js";
import { FiscalService } from "../fiscal/fiscal-service.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import type { ReceivableSettlementPort } from "../receivables/receivable-item-service.js";
import {
  TreasuryError,
  type TreasuryInstrumentPort,
  type TreasuryInstrumentQuote,
} from "../treasury/treasury-service.js";
import type { ActorContext } from "../platform/actor-context.js";
import { archiveDocument } from "../printing/print-archive.js";

export type ReceiptErrorReason =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "PERIOD_CLOSED"
  | "DATE_OUTSIDE_PERIOD"
  | "COUNTERPARTY_REQUIRED"
  | "INVALID_CUSTOMER"
  | "INVALID_ACCOUNT"
  | "INVALID_CASH_BANK_ACCOUNT"
  | "INVALID_PAYMENT_METHOD"
  | "REFERENCE_REQUIRED"
  | "INVALID_CURRENCY"
  | "INVALID_AMOUNT"
  | "ALLOCATION_REQUIRED"
  | "ALLOCATION_MISMATCH"
  | "INVALID_ALLOCATION"
  | "OVER_ALLOCATION"
  | "REALIZED_FX_ACCOUNT_NOT_CONFIGURED"
  | "ALREADY_REVERSED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";
export class ReceiptError extends Error {
  constructor(public readonly reason: ReceiptErrorReason) {
    super(reason);
  }
}
export type AllocationInput = {
  receivableItemId: bigint;
  allocatedAmount: string;
};

export type ReceiptDependencies = {
  treasury: TreasuryInstrumentPort;
  fxAccounts: RealizedFxAccountPort;
  receivables: ReceivableSettlementPort;
};
export type ReceiptInput = {
  fiscalPeriodId: bigint;
  documentDate: string;
  description: string;
  customerId?: bigint | null | undefined;
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
export type ReceiptUpdate = { version: number } & Partial<ReceiptInput>;
export type PosReceiptCheckoutResult = {
  receiptId: bigint;
  documentId: bigint;
  documentNumber: string;
  documentStatus: string;
  journalEntryIds: string[];
};
export interface PosReceiptCheckoutPort {
  captureInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ReceiptInput,
  ): Promise<PosReceiptCheckoutResult>;
}
const date = (v: string) => new Date(`${v}T00:00:00.000Z`);
const last4 = (v?: string | null) =>
  v ? v.replace(/\s/g, "").slice(-4) : null;
const documentJson = (v: AccountingDocument) => ({
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

const receiptInclude = {
  accountingDocument: true,
  allocations: {
    orderBy: { id: "asc" as const },
    include: {
      receivableItem: {
        include: {
          salesInvoice: {
            include: { accountingDocument: true },
          },
        },
      },
    },
  },
} as const;
type ReceiptRecord = Prisma.ReceiptGetPayload<{ include: typeof receiptInclude }>;
type SerializedAccountingDocument = ReturnType<typeof documentJson>;
type ReceiptCommandJsonInput = {
  document: AccountingDocument | SerializedAccountingDocument;
  generatedJournalEntryIds?: string[];
  ids?: string[];
  requestId: string;
};

export class ReceiptService {
  private readonly fiscal: FiscalService;
  private readonly posting = new PostingEngine();
  private readonly receivables: ReceivableSettlementPort;
  private readonly treasury: TreasuryInstrumentPort;
  private readonly fxAccounts: RealizedFxAccountPort;
  private readonly commands: IdempotentCommandExecutor;
  constructor(
    private readonly prisma: PrismaClient,
    dependencies: ReceiptDependencies,
  ) {
    this.fiscal = new FiscalService(prisma);
    this.treasury = dependencies.treasury;
    this.fxAccounts = dependencies.fxAccounts;
    this.receivables = dependencies.receivables;
    this.commands = new IdempotentCommandExecutor(prisma);
  }
  private include() {
    return receiptInclude;
  }
  async list(
    context: ActorContext,
    input: {
      page: number;
      pageSize: number;
      status?: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED" | undefined;
      dateFrom?: string | undefined;
      dateTo?: string | undefined;
      customerId?: bigint | undefined;
      search?: string | undefined;
    },
  ) {
    const where: Prisma.ReceiptWhereInput = {
      companyId: context.companyId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      accountingDocument: {
        documentType: "RECEIPT",
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
      data: await tx.receipt.findMany({
        where,
        include: this.include(),
        orderBy: { accountingDocument: { documentDate: "desc" } },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      total: await tx.receipt.count({ where }),
    }));
  }
  async get(context: ActorContext, id: bigint) {
    const value = await this.prisma.receipt.findFirst({
      where: { id, companyId: context.companyId },
      include: this.include(),
    });
    if (!value) throw new ReceiptError("NOT_FOUND");
    return value;
  }
  async create(context: ActorContext, input: ReceiptInput) {
    const period = await this.openPeriod(
      context.companyId,
      input.fiscalPeriodId,
    );
    this.validDate(period, input.documentDate);
    const documentNumber = await this.fiscal.reserveDocumentNumber(
      context,
      period.fiscalYearId,
      "RECEIPT",
    );
    return this.prisma.$transaction(
      async (tx) => {
        const prepared = await this.prepare(tx, context.companyId, input);
        const currentPeriod = await tx.fiscalPeriod.findFirst({
          where: { id: input.fiscalPeriodId, companyId: context.companyId },
        });
        if (!currentPeriod || currentPeriod.status === "CLOSED")
          throw new ReceiptError("PERIOD_CLOSED");
        this.validDate(currentPeriod, input.documentDate);
        const document = await tx.accountingDocument.create({
          data: {
            companyId: context.companyId,
            fiscalPeriodId: input.fiscalPeriodId,
            documentType: "RECEIPT",
            documentNumber,
            documentDate: date(input.documentDate),
            description: input.description,
            createdBy: context.userId,
          },
        });
        const { cashBankLedgerAccountId: _cash, counterLedgerAccountId: _counter, ...receiptData } = prepared;
        const receipt = await tx.receipt.create({
          data: {
            companyId: context.companyId,
            accountingDocumentId: document.id,
            ...receiptData,
          },
          include: this.include(),
        });
        await this.audit(tx, context, "RECEIPT_CREATED", receipt.id);
        return receipt;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async update(context: ActorContext, id: bigint, input: ReceiptUpdate) {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.receipt.findFirst({
          where: { id, companyId: context.companyId },
          include: this.include(),
        });
        if (!current) throw new ReceiptError("NOT_FOUND");
        if (current.accountingDocument.status !== "DRAFT")
          throw new ReceiptError("INVALID_STATE");
        if (current.accountingDocument.version !== input.version)
          throw new ReceiptError("VERSION_CONFLICT");
        const merged: ReceiptInput = {
          fiscalPeriodId:
            input.fiscalPeriodId ?? current.accountingDocument.fiscalPeriodId,
          documentDate:
            input.documentDate ??
            current.accountingDocument.documentDate.toISOString().slice(0, 10),
          description:
            input.description ?? current.accountingDocument.description,
          customerId:
            input.customerId === undefined
              ? current.customerId
              : input.customerId,
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
              receivableItemId: a.receivableItemId,
              allocatedAmount: a.allocatedAmount.toFixed(4),
            })),
        };
        const period = await tx.fiscalPeriod.findFirst({
          where: { id: merged.fiscalPeriodId, companyId: context.companyId },
        });
        if (!period || period.status === "CLOSED")
          throw new ReceiptError("PERIOD_CLOSED");
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
        if (changed.count !== 1) throw new ReceiptError("VERSION_CONFLICT");
        await tx.receiptAllocation.deleteMany({
          where: { receiptId: id, companyId: context.companyId },
        });
        const { cashBankLedgerAccountId: _cash, counterLedgerAccountId: _counter, ...receiptData } = prepared;
        await tx.receipt.update({ where: { id }, data: receiptData });
        await this.audit(tx, context, "RECEIPT_UPDATED", id);
        return tx.receipt.findUniqueOrThrow({
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
      "POST_RECEIPT",
      key,
      JSON.stringify({ id: id.toString(), version }),
      (tx, receipt) => this.postInTransaction(tx, context, id, version, receipt),
    );
  }
  private async postInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    id: bigint,
    version: number,
    receipt: ReceiptRecord,
  ) {
        const prepared = await this.prepare(
          tx,
          context.companyId,
          this.inputFrom(receipt),
        );
        const zero = new Prisma.Decimal(0);
        const result = await this.posting.postPlan(tx, {
          companyId: context.companyId,
          documentId: receipt.accountingDocumentId,
          expectedVersion: version,
          actorUserId: context.userId,
          error: (reason) => this.postingError(reason),
          beforeLedger: async (postingTx) => {
            const settlementBases = this.allocateSettlementBase(
              receipt.allocations,
              receipt.baseAmount,
              receipt.exchangeRate,
            );
            const carryingAllocations = await this.receivables.applyReceipt(postingTx, {
              companyId: context.companyId,
              customerId: receipt.customerId,
              currencyId: receipt.currencyId,
              allocations: receipt.allocations,
              errors: {
                invalid: () => new ReceiptError("INVALID_ALLOCATION"),
                overAllocation: () => new ReceiptError("OVER_ALLOCATION"),
                conflict: () => new ReceiptError("VERSION_CONFLICT"),
              },
            });
            const carryingByItem = new Map(carryingAllocations.map((allocation) => [
              allocation.receivableItemId.toString(),
              allocation.carryingBaseAmount,
            ]));
            let carryingBaseTotal = zero;
            let realizedFxBaseTotal = zero;
            for (const allocation of receipt.allocations) {
              const settlementBaseAmount = settlementBases.get(allocation.id.toString());
              const carryingBaseAmount = carryingByItem.get(allocation.receivableItemId.toString());
              if (!settlementBaseAmount || !carryingBaseAmount) {
                throw new ReceiptError("INVALID_ALLOCATION");
              }
              const realizedFxBaseAmount = settlementBaseAmount.sub(carryingBaseAmount);
              const changed = await postingTx.receiptAllocation.updateMany({
                where: {
                  id: allocation.id,
                  companyId: context.companyId,
                  receiptId: receipt.id,
                  carryingBaseAmount: null,
                  settlementBaseAmount: null,
                  realizedFxBaseAmount: null,
                },
                data: { carryingBaseAmount, settlementBaseAmount, realizedFxBaseAmount },
              });
              if (changed.count !== 1) throw new ReceiptError("VERSION_CONFLICT");
              carryingBaseTotal = carryingBaseTotal.add(carryingBaseAmount);
              realizedFxBaseTotal = realizedFxBaseTotal.add(realizedFxBaseAmount);
            }
            const accounts = realizedFxBaseTotal.equals(0)
              ? null
              : await this.fxAccounts.resolve(
                  postingTx,
                  context.companyId,
                  () => new ReceiptError("REALIZED_FX_ACCOUNT_NOT_CONFIGURED"),
                );
            if (!realizedFxBaseTotal.equals(0)) {
              await this.audit(postingTx, context, "RECEIPT_REALIZED_FX_RECORDED", receipt.id, {
                realizedFxBaseAmount: realizedFxBaseTotal.toFixed(4),
              });
            }
            return [this.postingEntry(
              receipt,
              prepared,
              receipt.allocations.length ? carryingBaseTotal : receipt.baseAmount,
              realizedFxBaseTotal,
              accounts,
            )];
          },
          entries: [this.postingEntry(receipt, prepared, receipt.baseAmount, zero, null)],
        });
        await archiveDocument(tx, context, receipt.accountingDocumentId);
        return {
          document: result.document,
          ids: result.entries.map((entry) => entry.id.toString()),
        };
  }
  private async createDraftInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ReceiptInput,
  ) {
    const period = await tx.fiscalPeriod.findFirst({
      where: { id: input.fiscalPeriodId, companyId: context.companyId },
    });
    if (!period || period.status === "CLOSED") throw new ReceiptError("PERIOD_CLOSED");
    this.validDate(period, input.documentDate);
    const prepared = await this.prepare(tx, context.companyId, input);
    const documentNumber = await this.reserveInTransaction(
      tx,
      context.companyId,
      period.fiscalYearId,
      "RECEIPT",
    );
    const document = await tx.accountingDocument.create({
      data: {
        companyId: context.companyId,
        fiscalPeriodId: input.fiscalPeriodId,
        documentType: "RECEIPT",
        documentNumber,
        documentDate: date(input.documentDate),
        description: input.description,
        createdBy: context.userId,
      },
    });
    const { cashBankLedgerAccountId: _cash, counterLedgerAccountId: _counter, ...receiptData } = prepared;
    const receipt = await tx.receipt.create({
      data: {
        companyId: context.companyId,
        accountingDocumentId: document.id,
        ...receiptData,
      },
      include: this.include(),
    });
    await this.audit(tx, context, "RECEIPT_CREATED", receipt.id, { source: "POS" });
    return receipt;
  }
  async captureInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ReceiptInput,
  ): Promise<PosReceiptCheckoutResult> {
    const receipt = await this.createDraftInTransaction(tx, context, input);
    const posted = await this.postInTransaction(tx, context, receipt.id, 0, receipt);
    await this.audit(tx, context, "POST_RECEIPT", receipt.id, { source: "POS" });
    return {
      receiptId: receipt.id,
      documentId: posted.document.id,
      documentNumber: posted.document.documentNumber,
      documentStatus: posted.document.status,
      journalEntryIds: posted.ids,
    };
  }
  async cancel(
    context: ActorContext,
    id: bigint,
    version: number,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.findFirst({
        where: { id, companyId: context.companyId },
        include: { accountingDocument: true },
      });
      if (!receipt) throw new ReceiptError("NOT_FOUND");
      if (receipt.accountingDocument.status !== "DRAFT")
        throw new ReceiptError("INVALID_STATE");
      const changed = await tx.accountingDocument.updateMany({
        where: { id: receipt.accountingDocumentId, status: "DRAFT", version },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ReceiptError("VERSION_CONFLICT");
      await this.audit(tx, context, "RECEIPT_CANCELLED", id, { reason });
      return {
        document: await tx.accountingDocument.findUniqueOrThrow({
          where: { id: receipt.accountingDocumentId },
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
      "REVERSE_RECEIPT",
      key,
      JSON.stringify({ id: id.toString(), ...input }),
      async (tx, receipt) => {
        const result = await this.posting.reverse(tx, {
          companyId: context.companyId,
          documentId: receipt.accountingDocumentId,
          expectedVersion: input.version,
          actorUserId: context.userId,
          reversalDate: date(input.reversalDate),
          description: (original) =>
            `عكس ${original.documentNumber}: ${input.reason}`,
          reserveDocumentNumber: (sequenceTx, period) =>
            this.reserveInTransaction(
              sequenceTx,
              context.companyId,
              period.fiscalYearId,
              "RECEIPT",
            ),
          beforeLedger: async (postingTx) => {
            await this.receivables.reverseReceipt(postingTx, {
              companyId: context.companyId,
              customerId: receipt.customerId,
              currencyId: receipt.currencyId,
              allocations: receipt.allocations,
              errors: {
                invalid: () => new ReceiptError("INVALID_ALLOCATION"),
                overAllocation: () => new ReceiptError("OVER_ALLOCATION"),
                conflict: () => new ReceiptError("VERSION_CONFLICT"),
              },
            });
          },
          error: (reason) => this.postingError(reason),
        });
        await archiveDocument(tx, context, result.reversalDocument.id);
        return {
          document: result.document,
          ids: result.entries.map((entry) => entry.id.toString()),
        };
      },
    );
  }
  static json(v: ReceiptRecord) {
    const realizedFxBaseAmount = v.allocations.reduce(
      (sum, allocation) =>
        sum.add(allocation.realizedFxBaseAmount ?? 0),
      new Prisma.Decimal(0),
    );
    return {
      id: v.id.toString(),
      document: documentJson(v.accountingDocument),
      customerId: v.customerId?.toString() ?? null,
      counterAccountId: v.counterAccountId?.toString() ?? null,
      cashBankAccountId: v.cashBankAccountId.toString(),
      paymentMethodId: v.paymentMethodId.toString(),
      currencyId: v.currencyId.toString(),
      exchangeRate: v.exchangeRate.toFixed(8),
      amount: v.amount.toFixed(4),
      baseAmount: v.baseAmount.toFixed(4),
      realizedFxBaseAmount: realizedFxBaseAmount.toFixed(4),
      referenceNumber: v.referenceNumber,
      counterpartyNameSnapshot: v.counterpartyNameSnapshot,
      counterpartyTaxMasked: v.counterpartyTaxLast4
        ? `****${v.counterpartyTaxLast4}`
        : null,
      counterpartyAddressSnapshot: v.counterpartyAddressSnapshot,
      notes: v.notes,
      allocations: v.allocations.map((a) => ({
        id: a.id.toString(),
        receivableItemId: a.receivableItemId.toString(),
        allocatedAmount: a.allocatedAmount.toFixed(4),
        carryingBaseAmount: a.carryingBaseAmount?.toFixed(4) ?? null,
        settlementBaseAmount: a.settlementBaseAmount?.toFixed(4) ?? null,
        realizedFxBaseAmount: a.realizedFxBaseAmount?.toFixed(4) ?? null,
        invoiceNumber: a.receivableItem.salesInvoice.accountingDocument.documentNumber,
        customerName: a.receivableItem.salesInvoice.customerNameSnapshot,
        dueDate: a.receivableItem.dueDate.toISOString().slice(0, 10),
      })),
    };
  }
  static commandJson(v: ReceiptCommandJsonInput) {
    return {
      document:
        "companyId" in v.document ? documentJson(v.document) : v.document,
      generatedJournalEntryIds: v.generatedJournalEntryIds ?? v.ids ?? [],
      requestId: v.requestId,
    };
  }
  private postingEntry(
    receipt: ReceiptRecord,
    prepared: {
      cashBankLedgerAccountId: bigint;
      counterLedgerAccountId: bigint;
    },
    carryingBaseAmount: Prisma.Decimal,
    realizedFxBaseAmount: Prisma.Decimal,
    accounts: RealizedFxAccounts | null,
  ): PostingEntryPlan {
    const zero = new Prisma.Decimal(0);
    const lines: PostingEntryPlan["lines"] = [
      {
        lineNumber: 1,
        accountId: prepared.cashBankLedgerAccountId,
        description: receipt.accountingDocument.description,
        currencyId: receipt.currencyId,
        exchangeRate: receipt.exchangeRate,
        debitAmount: receipt.amount,
        creditAmount: zero,
        baseDebitAmount: receipt.baseAmount,
        baseCreditAmount: zero,
      },
      {
        lineNumber: 2,
        accountId: prepared.counterLedgerAccountId,
        customerId: receipt.customerId,
        description: receipt.accountingDocument.description,
        currencyId: receipt.currencyId,
        exchangeRate: carryingBaseAmount
          .div(receipt.amount)
          .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP),
        debitAmount: zero,
        creditAmount: receipt.amount,
        baseDebitAmount: zero,
        baseCreditAmount: carryingBaseAmount,
      },
    ];
    if (!realizedFxBaseAmount.equals(0)) {
      if (!accounts) throw new ReceiptError("REALIZED_FX_ACCOUNT_NOT_CONFIGURED");
      const gain = realizedFxBaseAmount.gt(0);
      const amount = realizedFxBaseAmount.abs();
      lines.push({
        lineNumber: 3,
        accountId: gain ? accounts.gainAccountId : accounts.lossAccountId,
        description: gain ? "ربح فرق عملة محقق" : "خسارة فرق عملة محققة",
        currencyId: accounts.baseCurrencyId,
        exchangeRate: new Prisma.Decimal(1),
        debitAmount: gain ? zero : amount,
        creditAmount: gain ? amount : zero,
        baseDebitAmount: gain ? zero : amount,
        baseCreditAmount: gain ? amount : zero,
      });
    }
    return {
      entryNumber: 1,
      entryDate: receipt.accountingDocument.documentDate,
      description: receipt.accountingDocument.description,
      lines,
    };
  }
  private allocateSettlementBase(
    allocations: Array<{ id: bigint; allocatedAmount: Prisma.Decimal }>,
    totalBaseAmount: Prisma.Decimal,
    exchangeRate: Prisma.Decimal,
  ) {
    const result = new Map<string, Prisma.Decimal>();
    let assigned = new Prisma.Decimal(0);
    allocations.forEach((allocation, index) => {
      const baseAmount = index === allocations.length - 1
        ? totalBaseAmount.sub(assigned)
        : allocation.allocatedAmount
            .mul(exchangeRate)
            .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      if (baseAmount.lte(0)) throw new ReceiptError("INVALID_ALLOCATION");
      result.set(allocation.id.toString(), baseAmount);
      assigned = assigned.add(baseAmount);
    });
    if (allocations.length > 0 && !assigned.equals(totalBaseAmount)) {
      throw new ReceiptError("INVALID_ALLOCATION");
    }
    return result;
  }
  private async openPeriod(companyId: bigint, id: bigint) {
    const value = await this.prisma.fiscalPeriod.findFirst({
      where: { id, companyId },
    });
    if (!value) throw new ReceiptError("NOT_FOUND");
    if (value.status === "CLOSED") throw new ReceiptError("PERIOD_CLOSED");
    return value;
  }
  private validDate(period: { startDate: Date; endDate: Date }, value: string) {
    const d = date(value);
    if (d < period.startDate || d > period.endDate)
      throw new ReceiptError("DATE_OUTSIDE_PERIOD");
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
      throw new ReceiptError("INVALID_ACCOUNT");
    return value;
  }
  private async prepare(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    input: ReceiptInput,
  ) {
    if ((input.customerId == null) === (input.counterAccountId == null))
      throw new ReceiptError("COUNTERPARTY_REQUIRED");
    const allocations = input.allocations ?? [];
    if (input.customerId != null && allocations.length === 0)
      throw new ReceiptError("ALLOCATION_REQUIRED");
    const amount = new Prisma.Decimal(input.amount),
      rate = new Prisma.Decimal(input.exchangeRate);
    if (amount.lte(0) || rate.lte(0)) throw new ReceiptError("INVALID_AMOUNT");
    let counterLedgerAccountId: bigint;
    if (input.customerId != null) {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, companyId, isActive: true },
      });
      if (!customer) throw new ReceiptError("INVALID_CUSTOMER");
      await this.validAccount(tx, companyId, customer.receivableAccountId);
      counterLedgerAccountId = customer.receivableAccountId;
    } else {
      await this.validAccount(tx, companyId, input.counterAccountId!);
      counterLedgerAccountId = input.counterAccountId!;
    }
    let instrument: TreasuryInstrumentQuote;
    try {
      instrument = await this.treasury.resolveInstrument(tx, companyId, {
        cashBankAccountId: input.cashBankAccountId,
        paymentMethodId: input.paymentMethodId,
        referenceNumber: input.referenceNumber,
      });
    } catch (error) {
      if (error instanceof TreasuryError) {
        if (error.reason === "INVALID_CASH_BANK_ACCOUNT") {
          throw new ReceiptError("INVALID_CASH_BANK_ACCOUNT");
        }
        if (error.reason === "INVALID_PAYMENT_METHOD") {
          throw new ReceiptError("INVALID_PAYMENT_METHOD");
        }
        if (error.reason === "REFERENCE_REQUIRED") {
          throw new ReceiptError("REFERENCE_REQUIRED");
        }
      }
      throw error;
    }
    const currency = await tx.companyCurrency.findFirst({
      where: { companyId, currencyId: input.currencyId, isActive: true, currency: { isActive: true, OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: companyId }] } },
    });
    if (!currency) throw new ReceiptError("INVALID_CURRENCY");
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    if (input.currencyId === company.baseCurrencyId && !rate.equals(1))
      throw new ReceiptError("INVALID_CURRENCY");
    if (
      new Set(allocations.map((a) => a.receivableItemId.toString())).size !==
      allocations.length
    )
      throw new ReceiptError("INVALID_ALLOCATION");
    const allocationSum = allocations.reduce(
      (sum, a) => sum.add(a.allocatedAmount),
      new Prisma.Decimal(0),
    );
    if (allocations.some((a) => new Prisma.Decimal(a.allocatedAmount).lte(0)))
      throw new ReceiptError("INVALID_ALLOCATION");
    if (allocations.length && !allocationSum.equals(amount))
      throw new ReceiptError("ALLOCATION_MISMATCH");
    await this.receivables.validateDraftTargets(tx, {
      companyId,
      customerId: input.customerId ?? null,
      currencyId: input.currencyId,
      allocations,
      errors: {
        invalid: () => new ReceiptError("INVALID_ALLOCATION"),
        overAllocation: () => new ReceiptError("OVER_ALLOCATION"),
        conflict: () => new ReceiptError("VERSION_CONFLICT"),
      },
    });
    return {
      customerId: input.customerId ?? null,
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
              receivableItemId: a.receivableItemId,
              allocatedAmount: new Prisma.Decimal(a.allocatedAmount),
            })),
          } }
        : {}),
      cashBankLedgerAccountId: instrument.cashBankLedgerAccountId,
      counterLedgerAccountId,
    };
  }
  private inputFrom(v: ReceiptRecord): ReceiptInput {
    return {
      fiscalPeriodId: v.accountingDocument.fiscalPeriodId,
      documentDate: v.accountingDocument.documentDate
        .toISOString()
        .slice(0, 10),
      description: v.accountingDocument.description,
      customerId: v.customerId,
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
      allocations: v.allocations.map((a) => ({
        receivableItemId: a.receivableItemId,
        allocatedAmount: a.allocatedAmount.toFixed(4),
      })),
    };
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
    if (!year) throw new ReceiptError("NOT_FOUND");
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
    return appendAudit(tx, {
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType: "RECEIPT",
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
      receipt: ReceiptRecord,
    ) => Promise<{ document: AccountingDocument; ids: string[] }>,
  ) {
    return this.commands.execute(
      {
        context,
        operation,
        key,
        fingerprint,
        errors: {
          mismatch: () => new ReceiptError("IDEMPOTENCY_MISMATCH"),
          inProgress: () => new ReceiptError("IDEMPOTENCY_IN_PROGRESS"),
        },
      },
      async (tx) => {
        const receipt = await tx.receipt.findFirst({
          where: { id, companyId: context.companyId },
          include: this.include(),
        });
        if (!receipt) throw new ReceiptError("NOT_FOUND");
        const result = await execute(tx, receipt);
        await this.audit(tx, context, operation, id);
        return {
          document: documentJson(result.document),
          generatedJournalEntryIds: result.ids,
          requestId: randomUUID(),
        };
      },
    );
  }

  private postingError(reason: PostingFailureReason) {
    if (reason === "INVALID_LINE" || reason === "UNBALANCED")
      return new ReceiptError("INVALID_AMOUNT");
    if (reason === "INVALID_COST_CENTER")
      return new ReceiptError("INVALID_ACCOUNT");
    return new ReceiptError(reason);
  }
}
