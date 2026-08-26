import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  PostingEngine,
  type PostingEntryPlan,
  type PostingFailureReason,
} from "../core-accounting/posting-engine.js";
import {
  RealizedFxAccountService,
  type RealizedFxAccountPort,
  type RealizedFxAccounts,
} from "../core-accounting/realized-fx-account-service.js";
import { FiscalService } from "../fiscal/fiscal-service.js";
import { PayableItemService } from "../payables/payable-item-service.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import {
  TreasuryError,
  TreasuryService,
  type TreasuryInstrumentPort,
  type TreasuryInstrumentQuote,
} from "../treasury/treasury-service.js";
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
  | "ALLOCATION_REQUIRED"
  | "ALLOCATION_MISMATCH"
  | "INVALID_ALLOCATION"
  | "OVER_ALLOCATION"
  | "REALIZED_FX_ACCOUNT_NOT_CONFIGURED"
  | "ALREADY_REVERSED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";
export class PaymentError extends Error {
  constructor(public readonly reason: PaymentErrorReason) {
    super(reason);
  }
}
export type AllocationInput = {
  payableItemId: bigint;
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
  private readonly posting = new PostingEngine();
  private readonly payables = new PayableItemService();
  private readonly transactions: TransactionExecutor;
  private readonly treasury: TreasuryInstrumentPort;
  private readonly fxAccounts: RealizedFxAccountPort;
  private readonly commands: IdempotentCommandExecutor;
  constructor(
    private readonly prisma: PrismaClient,
    treasury?: TreasuryInstrumentPort,
    fxAccounts?: RealizedFxAccountPort,
  ) {
    this.fiscal = new FiscalService(prisma);
    this.transactions = new TransactionExecutor(prisma);
    this.treasury = treasury ?? new TreasuryService(prisma);
    this.fxAccounts = fxAccounts ?? new RealizedFxAccountService();
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
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
    return this.transactions.execute(
      { operation: "CREATE_PAYMENT", companyId: context.companyId },
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
    );
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
              payableItemId: a.payableItemId,
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
        const prepared = await this.prepare(
          tx,
          context.companyId,
          this.inputFrom(payment),
        );
        const zero = new Prisma.Decimal(0);
        const result = await this.posting.postPlan(tx, {
          companyId: context.companyId,
          documentId: payment.accountingDocumentId,
          expectedVersion: version,
          actorUserId: context.userId,
          error: (reason) => this.postingError(reason),
          beforeLedger: async (postingTx) => {
            const settlementBases = this.allocateSettlementBase(
              payment.allocations,
              payment.baseAmount,
              payment.exchangeRate,
            );
            const carryingAllocations = await this.payables.applyPayment(postingTx, {
              companyId: context.companyId,
              supplierId: payment.supplierId,
              currencyId: payment.currencyId,
              allocations: payment.allocations,
              errors: {
                invalid: () => new PaymentError("INVALID_ALLOCATION"),
                overAllocation: () => new PaymentError("OVER_ALLOCATION"),
                conflict: () => new PaymentError("VERSION_CONFLICT"),
              },
            });
            const carryingByItem = new Map(carryingAllocations.map((allocation) => [
              allocation.payableItemId.toString(),
              allocation.carryingBaseAmount,
            ]));
            let carryingBaseTotal = zero;
            let realizedFxBaseTotal = zero;
            for (const allocation of payment.allocations) {
              const settlementBaseAmount = settlementBases.get(allocation.id.toString());
              const carryingBaseAmount = carryingByItem.get(allocation.payableItemId.toString());
              if (!settlementBaseAmount || !carryingBaseAmount) {
                throw new PaymentError("INVALID_ALLOCATION");
              }
              const realizedFxBaseAmount = carryingBaseAmount.sub(settlementBaseAmount);
              const changed = await postingTx.paymentAllocation.updateMany({
                where: {
                  id: allocation.id,
                  companyId: context.companyId,
                  paymentId: payment.id,
                  carryingBaseAmount: null,
                  settlementBaseAmount: null,
                  realizedFxBaseAmount: null,
                },
                data: { carryingBaseAmount, settlementBaseAmount, realizedFxBaseAmount },
              });
              if (changed.count !== 1) throw new PaymentError("VERSION_CONFLICT");
              carryingBaseTotal = carryingBaseTotal.add(carryingBaseAmount);
              realizedFxBaseTotal = realizedFxBaseTotal.add(realizedFxBaseAmount);
            }
            const accounts = realizedFxBaseTotal.equals(0)
              ? null
              : await this.fxAccounts.resolve(
                  postingTx,
                  context.companyId,
                  () => new PaymentError("REALIZED_FX_ACCOUNT_NOT_CONFIGURED"),
                );
            if (!realizedFxBaseTotal.equals(0)) {
              await this.audit(postingTx, context, "PAYMENT_REALIZED_FX_RECORDED", payment.id, {
                realizedFxBaseAmount: realizedFxBaseTotal.toFixed(4),
              });
            }
            return [this.postingEntry(
              payment,
              prepared,
              payment.allocations.length ? carryingBaseTotal : payment.baseAmount,
              realizedFxBaseTotal,
              accounts,
            )];
          },
          entries: [this.postingEntry(payment, prepared, payment.baseAmount, zero, null)],
        });
        await archiveDocument(tx, context, payment.accountingDocumentId);
        return {
          document: result.document,
          ids: result.entries.map((entry) => entry.id.toString()),
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
        const result = await this.posting.reverse(tx, {
          companyId: context.companyId,
          documentId: payment.accountingDocumentId,
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
              "PAYMENT",
            ),
          beforeLedger: async (postingTx) => {
            await this.payables.reversePayment(postingTx, {
              companyId: context.companyId,
              supplierId: payment.supplierId,
              currencyId: payment.currencyId,
              allocations: payment.allocations,
              errors: {
                invalid: () => new PaymentError("INVALID_ALLOCATION"),
                overAllocation: () => new PaymentError("OVER_ALLOCATION"),
                conflict: () => new PaymentError("VERSION_CONFLICT"),
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
  static json(v: any) {
    const realizedFxBaseAmount = v.allocations.reduce(
      (sum: Prisma.Decimal, allocation: any) =>
        sum.add(allocation.realizedFxBaseAmount ?? 0),
      new Prisma.Decimal(0),
    );
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
      realizedFxBaseAmount: realizedFxBaseAmount.toFixed(4),
      referenceNumber: v.referenceNumber,
      counterpartyNameSnapshot: v.counterpartyNameSnapshot,
      counterpartyTaxMasked: v.counterpartyTaxLast4
        ? `****${v.counterpartyTaxLast4}`
        : null,
      counterpartyAddressSnapshot: v.counterpartyAddressSnapshot,
      notes: v.notes,
      allocations: v.allocations.map((a: any) => ({
        id: a.id.toString(),
        payableItemId: a.payableItemId.toString(),
        allocatedAmount: a.allocatedAmount.toFixed(4),
        carryingBaseAmount: a.carryingBaseAmount?.toFixed(4) ?? null,
        settlementBaseAmount: a.settlementBaseAmount?.toFixed(4) ?? null,
        realizedFxBaseAmount: a.realizedFxBaseAmount?.toFixed(4) ?? null,
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
  private postingEntry(
    payment: any,
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
        description: payment.accountingDocument.description,
        currencyId: payment.currencyId,
        exchangeRate: payment.exchangeRate,
        debitAmount: zero,
        creditAmount: payment.amount,
        baseDebitAmount: zero,
        baseCreditAmount: payment.baseAmount,
      },
      {
        lineNumber: 2,
        accountId: prepared.counterLedgerAccountId,
        supplierId: payment.supplierId,
        description: payment.accountingDocument.description,
        currencyId: payment.currencyId,
        exchangeRate: carryingBaseAmount
          .div(payment.amount)
          .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP),
        debitAmount: payment.amount,
        creditAmount: zero,
        baseDebitAmount: carryingBaseAmount,
        baseCreditAmount: zero,
      },
    ];
    if (!realizedFxBaseAmount.equals(0)) {
      if (!accounts) throw new PaymentError("REALIZED_FX_ACCOUNT_NOT_CONFIGURED");
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
      entryDate: payment.accountingDocument.documentDate,
      description: payment.accountingDocument.description,
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
      if (baseAmount.lte(0)) throw new PaymentError("INVALID_ALLOCATION");
      result.set(allocation.id.toString(), baseAmount);
      assigned = assigned.add(baseAmount);
    });
    if (allocations.length > 0 && !assigned.equals(totalBaseAmount)) {
      throw new PaymentError("INVALID_ALLOCATION");
    }
    return result;
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
    const allocations = input.allocations ?? [];
    if (input.supplierId != null && allocations.length === 0)
      throw new PaymentError("ALLOCATION_REQUIRED");
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
          throw new PaymentError("INVALID_CASH_BANK_ACCOUNT");
        }
        if (error.reason === "INVALID_PAYMENT_METHOD") {
          throw new PaymentError("INVALID_PAYMENT_METHOD");
        }
        if (error.reason === "REFERENCE_REQUIRED") {
          throw new PaymentError("REFERENCE_REQUIRED");
        }
      }
      throw error;
    }
    const currency = await tx.companyCurrency.findFirst({
      where: { companyId, currencyId: input.currencyId, isActive: true, currency: { isActive: true, OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: companyId }] } },
    });
    if (!currency) throw new PaymentError("INVALID_CURRENCY");
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    if (input.currencyId === company.baseCurrencyId && !rate.equals(1))
      throw new PaymentError("INVALID_CURRENCY");
    if (
      new Set(allocations.map((a) => a.payableItemId.toString())).size !==
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
    await this.payables.validateDraftTargets(tx, {
      companyId,
      supplierId: input.supplierId ?? null,
      currencyId: input.currencyId,
      allocations,
      errors: {
        invalid: () => new PaymentError("INVALID_ALLOCATION"),
        overAllocation: () => new PaymentError("OVER_ALLOCATION"),
        conflict: () => new PaymentError("VERSION_CONFLICT"),
      },
    });
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
              payableItemId: a.payableItemId,
              allocatedAmount: new Prisma.Decimal(a.allocatedAmount),
            })),
          } }
        : {}),
      cashBankLedgerAccountId: instrument.cashBankLedgerAccountId,
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
        payableItemId: a.payableItemId,
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
    return this.commands.execute(
      {
        context,
        operation,
        key,
        fingerprint,
        errors: {
          mismatch: () => new PaymentError("IDEMPOTENCY_MISMATCH"),
          inProgress: () => new PaymentError("IDEMPOTENCY_IN_PROGRESS"),
        },
      },
      async (tx) => {
        const payment = await tx.payment.findFirst({
          where: { id, companyId: context.companyId },
          include: this.include(),
        });
        if (!payment) throw new PaymentError("NOT_FOUND");
        const result = await execute(tx, payment);
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
      return new PaymentError("INVALID_AMOUNT");
    if (reason === "INVALID_COST_CENTER")
      return new PaymentError("INVALID_ACCOUNT");
    return new PaymentError(reason);
  }
}
