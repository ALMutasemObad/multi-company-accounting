import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { FiscalService } from "../fiscal/fiscal-service.js";
import { reserveMasterDataCode } from "../platform/master-data-code-service.js";
import { archiveDocument } from "../printing/print-archive.js";
import type { ActorContext } from "../users/user-service.js";
import { calculatePurchaseInvoice, PurchaseCalculationError } from "./purchase-invoice-calculator.js";

export type PurchaseInvoiceErrorReason =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "PERIOD_CLOSED"
  | "DATE_OUTSIDE_PERIOD"
  | "INVALID_SUPPLIER"
  | "INVALID_ACCOUNT"
  | "INVALID_COST_CENTER"
  | "INVALID_TAX_RATE"
  | "INVALID_CURRENCY"
  | "INVALID_LINE"
  | "INVALID_DISCOUNT"
  | "INVALID_TOTAL"
  | "SOURCE_INVOICE_REQUIRED"
  | "INVALID_SOURCE_INVOICE"
  | "DEBIT_EXCEEDS_INVOICE"
  | "HAS_SETTLEMENTS"
  | "ALREADY_REVERSED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class PurchaseInvoiceError extends Error {
  constructor(public readonly reason: PurchaseInvoiceErrorReason) {
    super(reason);
  }
}
export type PurchaseInvoiceLineInput = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  debitAccountId: bigint;
  costCenterId?: bigint | null;
  taxRateId?: bigint | null;
};

export type PurchaseInvoiceInput = {
  documentType: "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";
  fiscalPeriodId: bigint;
  documentDate: string;
  dueDate: string;
  description: string;
  supplierId: bigint;
  supplierInvoiceNumber?: string | null;
  sourceInvoiceId?: bigint | null;
  currencyId: bigint;
  exchangeRate: string;
  supplierAddress?: string | null;
  notes?: string | null;
  lines: PurchaseInvoiceLineInput[];
};

export type PurchaseInvoiceUpdate = { version: number } & Partial<PurchaseInvoiceInput>;

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const day = (value: Date) => value.toISOString().slice(0, 10);
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) => decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
const digest = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());

const documentJson = (value: any) => ({
  id: value.id.toString(),
  documentType: value.documentType,
  documentNumber: value.documentNumber,
  documentDate: day(value.documentDate),
  description: value.description,
  status: value.status,
  fiscalPeriodId: value.fiscalPeriodId.toString(),
  version: value.version,
  createdBy: value.createdBy.toString(),
  createdAt: value.createdAt.toISOString(),
  postedBy: value.postedBy?.toString() ?? null,
  postedAt: value.postedAt?.toISOString() ?? null,
  reversedByDocumentId: value.reversedByDocumentId?.toString() ?? null,
});

export class PurchaseInvoiceService {
  private readonly fiscal: FiscalService;

  constructor(private readonly prisma: PrismaClient) {
    this.fiscal = new FiscalService(prisma);
  }

  private include() {
    return {
      accountingDocument: true,
      supplier: { select: { id: true, code: true, nameAr: true } },
      currency: { select: { id: true, code: true, nameAr: true } },
      sourceInvoice: { include: { accountingDocument: true } },
      debitNotes: { include: { accountingDocument: true } },
      lines: {
        orderBy: { lineNumber: "asc" as const },
        include: {
          debitAccount: { select: { id: true, code: true, nameAr: true } },
          costCenter: { select: { id: true, code: true, nameAr: true } },
          taxRate: { select: { id: true, code: true, nameAr: true, rate: true } },
        },
      },
      apJournalLine: {
        include: {
          paymentAllocations: {
            include: { payment: { include: { accountingDocument: true } } },
          },
        },
      },
    } as const;
  }

  async list(context: ActorContext, input: {
    page: number;
    pageSize: number;
    documentType?: "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";
    status?: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";
    supplierId?: bigint;
    dateFrom?: string;
    dateTo?: string;
    dueFrom?: string;
    dueTo?: string;
    search?: string;
    outstandingOnly?: boolean;
  }) {
    const where: Prisma.PurchaseInvoiceWhereInput = {
      companyId: context.companyId,
      ...(input.supplierId ? { supplierId: input.supplierId } : {}),
      ...(input.dueFrom || input.dueTo ? { dueDate: { ...(input.dueFrom ? { gte: asDate(input.dueFrom) } : {}), ...(input.dueTo ? { lte: asDate(input.dueTo) } : {}) } } : {}),
      accountingDocument: {
        ...(input.documentType ? { documentType: input.documentType } : { documentType: { in: ["PURCHASE_INVOICE", "PURCHASE_DEBIT_NOTE"] } }),
        ...(input.status ? { status: input.status } : {}),
        ...(input.dateFrom || input.dateTo ? { documentDate: { ...(input.dateFrom ? { gte: asDate(input.dateFrom) } : {}), ...(input.dateTo ? { lte: asDate(input.dateTo) } : {}) } } : {}),
        ...(input.search ? { OR: [{ documentNumber: { contains: input.search } }, { description: { contains: input.search } }] } : {}),
      },
      ...(input.search ? { OR: [{ supplierNameSnapshot: { contains: input.search } }, { accountingDocument: { OR: [{ documentNumber: { contains: input.search } }, { description: { contains: input.search } }] } }] } : {}),
    };
    const all = await this.prisma.purchaseInvoice.findMany({
      where,
      include: this.include(),
      orderBy: [{ accountingDocument: { documentDate: "desc" } }, { id: "desc" }],
    });
    const rows = input.outstandingOnly ? all.filter((invoice) => invoice.accountingDocument.documentType === "PURCHASE_INVOICE" && invoice.accountingDocument.status === "POSTED" && this.outstanding(invoice).gt(0)) : all;
    const offset = (input.page - 1) * input.pageSize;
    return { data: rows.slice(offset, offset + input.pageSize), total: rows.length };
  }

  async get(context: ActorContext, id: bigint) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({ where: { id, companyId: context.companyId }, include: this.include() });
    if (!invoice) throw new PurchaseInvoiceError("NOT_FOUND");
    return invoice;
  }

  async create(context: ActorContext, input: PurchaseInvoiceInput) {
    const period = await this.openPeriod(context.companyId, input.fiscalPeriodId);
    this.validDate(period, input.documentDate);
    const documentNumber = await this.fiscal.reserveDocumentNumber(context, period.fiscalYearId, input.documentType);
    return this.prisma.$transaction(async (tx) => {
      const currentPeriod = await tx.fiscalPeriod.findFirst({ where: { id: input.fiscalPeriodId, companyId: context.companyId } });
      if (!currentPeriod || currentPeriod.status === "CLOSED") throw new PurchaseInvoiceError("PERIOD_CLOSED");
      this.validDate(currentPeriod, input.documentDate);
      const prepared = await this.prepare(tx, context.companyId, input);
      const document = await tx.accountingDocument.create({
        data: {
          companyId: context.companyId,
          fiscalPeriodId: input.fiscalPeriodId,
          documentType: input.documentType,
          documentNumber,
          documentDate: asDate(input.documentDate),
          description: input.description,
          createdBy: context.userId,
        },
      });
      const invoice = await tx.purchaseInvoice.create({
        data: {
          companyId: context.companyId,
          accountingDocumentId: document.id,
          supplierId: input.supplierId,
          supplierInvoiceNumber: input.supplierInvoiceNumber?.trim() || null,
          sourceInvoiceId: input.documentType === "PURCHASE_DEBIT_NOTE" ? input.sourceInvoiceId ?? null : null,
          currencyId: input.currencyId,
          exchangeRate: decimal(input.exchangeRate),
          dueDate: asDate(input.dueDate),
          subtotal: prepared.calculation.subtotal,
          discountTotal: prepared.calculation.discountTotal,
          taxableTotal: prepared.calculation.taxableTotal,
          taxTotal: prepared.calculation.taxTotal,
          total: prepared.calculation.total,
          baseTotal: prepared.calculation.baseTotal,
          supplierNameSnapshot: prepared.supplier.nameAr,
          supplierTaxLast4: prepared.supplier.taxNumberLast4,
          supplierAddressSnapshot: prepared.supplierAddress,
          notes: input.notes ?? null,
          lines: { create: prepared.calculation.lines },
        },
        include: this.include(),
      });
      await this.audit(tx, context, "PURCHASE_INVOICE_CREATED", invoice.id, { documentType: input.documentType });
      return invoice;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async update(context: ActorContext, id: bigint, input: PurchaseInvoiceUpdate) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.purchaseInvoice.findFirst({ where: { id, companyId: context.companyId }, include: { accountingDocument: true, lines: { orderBy: { lineNumber: "asc" } } } });
      if (!current) throw new PurchaseInvoiceError("NOT_FOUND");
      if (current.accountingDocument.status !== "DRAFT") throw new PurchaseInvoiceError("INVALID_STATE");
      if (current.accountingDocument.version !== input.version) throw new PurchaseInvoiceError("VERSION_CONFLICT");
      if (input.documentType && input.documentType !== current.accountingDocument.documentType) throw new PurchaseInvoiceError("INVALID_STATE");
      const merged: PurchaseInvoiceInput = {
        documentType: current.accountingDocument.documentType as "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE",
        fiscalPeriodId: input.fiscalPeriodId ?? current.accountingDocument.fiscalPeriodId,
        documentDate: input.documentDate ?? day(current.accountingDocument.documentDate),
        dueDate: input.dueDate ?? day(current.dueDate),
        description: input.description ?? current.accountingDocument.description,
        supplierId: input.supplierId ?? current.supplierId,
        supplierInvoiceNumber: input.supplierInvoiceNumber === undefined ? current.supplierInvoiceNumber : input.supplierInvoiceNumber,
        sourceInvoiceId: input.sourceInvoiceId === undefined ? current.sourceInvoiceId : input.sourceInvoiceId,
        currencyId: input.currencyId ?? current.currencyId,
        exchangeRate: input.exchangeRate ?? current.exchangeRate.toFixed(8),
        supplierAddress: input.supplierAddress === undefined ? current.supplierAddressSnapshot : input.supplierAddress,
        notes: input.notes === undefined ? current.notes : input.notes,
        lines: input.lines ?? current.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity.toFixed(4),
          unitPrice: line.unitPrice.toFixed(4),
          discountAmount: line.discountAmount.toFixed(4),
          debitAccountId: line.debitAccountId,
          costCenterId: line.costCenterId,
          taxRateId: line.taxRateId,
        })),
      };
      const period = await tx.fiscalPeriod.findFirst({ where: { id: merged.fiscalPeriodId, companyId: context.companyId } });
      if (!period || period.status === "CLOSED") throw new PurchaseInvoiceError("PERIOD_CLOSED");
      this.validDate(period, merged.documentDate);
      const prepared = await this.prepare(tx, context.companyId, merged, id);
      const changed = await tx.accountingDocument.updateMany({
        where: { id: current.accountingDocumentId, companyId: context.companyId, status: "DRAFT", version: input.version },
        data: { fiscalPeriodId: merged.fiscalPeriodId, documentDate: asDate(merged.documentDate), description: merged.description, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new PurchaseInvoiceError("VERSION_CONFLICT");
      await tx.purchaseInvoiceLine.deleteMany({ where: { purchaseInvoiceId: id, companyId: context.companyId } });
      await tx.purchaseInvoice.update({
        where: { id },
        data: {
          supplierId: merged.supplierId,
          supplierInvoiceNumber: merged.supplierInvoiceNumber?.trim() || null,
          sourceInvoiceId: merged.documentType === "PURCHASE_DEBIT_NOTE" ? merged.sourceInvoiceId ?? null : null,
          currencyId: merged.currencyId,
          exchangeRate: decimal(merged.exchangeRate),
          dueDate: asDate(merged.dueDate),
          subtotal: prepared.calculation.subtotal,
          discountTotal: prepared.calculation.discountTotal,
          taxableTotal: prepared.calculation.taxableTotal,
          taxTotal: prepared.calculation.taxTotal,
          total: prepared.calculation.total,
          baseTotal: prepared.calculation.baseTotal,
          supplierNameSnapshot: prepared.supplier.nameAr,
          supplierTaxLast4: prepared.supplier.taxNumberLast4,
          supplierAddressSnapshot: prepared.supplierAddress,
          notes: merged.notes ?? null,
          lines: { create: prepared.calculation.lines },
        },
      });
      await this.audit(tx, context, "PURCHASE_INVOICE_UPDATED", id);
      return tx.purchaseInvoice.findUniqueOrThrow({ where: { id }, include: this.include() });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  post(context: ActorContext, id: bigint, version: number, key: string) {
    return this.command(context, id, "POST_PURCHASE_INVOICE", key, JSON.stringify({ id: id.toString(), version }), async (tx, invoice) => {
      if (invoice.accountingDocument.status !== "DRAFT") throw new PurchaseInvoiceError("INVALID_STATE");
      if (invoice.accountingDocument.version !== version) throw new PurchaseInvoiceError("VERSION_CONFLICT");
      const period = await tx.fiscalPeriod.findFirst({ where: { id: invoice.accountingDocument.fiscalPeriodId, companyId: context.companyId } });
      if (!period || period.status === "CLOSED") throw new PurchaseInvoiceError("PERIOD_CLOSED");
      const input = this.inputFrom(invoice);
      const prepared = await this.prepare(tx, context.companyId, input, invoice.id);
      if (input.documentType === "PURCHASE_DEBIT_NOTE") await this.validateDebitLimit(tx, context.companyId, input.sourceInvoiceId!, prepared.calculation.total, invoice.id);

      const isDebitNote = input.documentType === "PURCHASE_DEBIT_NOTE";
      const zero = decimal(0);
      const detailLines: any[] = [];
      let lineNumber = 2;
      for (const line of prepared.calculation.lines) {
        const baseNet = money(line.netAmount.mul(invoice.exchangeRate));
        detailLines.push({
          lineNumber: lineNumber++,
          accountId: line.debitAccountId,
          costCenterId: line.costCenterId,
          description: line.description,
          currencyId: invoice.currencyId,
          exchangeRate: invoice.exchangeRate,
          debitAmount: isDebitNote ? zero : line.netAmount,
          creditAmount: isDebitNote ? line.netAmount : zero,
          baseDebitAmount: isDebitNote ? zero : baseNet,
          baseCreditAmount: isDebitNote ? baseNet : zero,
        });
        if (line.taxAmount.gt(0)) {
          const taxAccountId = prepared.taxAccounts.get(line.taxRateId!.toString());
          if (!taxAccountId) throw new PurchaseInvoiceError("INVALID_TAX_RATE");
          const baseTax = money(line.taxAmount.mul(invoice.exchangeRate));
          detailLines.push({
            lineNumber: lineNumber++,
            accountId: taxAccountId,
            description: `ضريبة: ${line.description}`,
            currencyId: invoice.currencyId,
            exchangeRate: invoice.exchangeRate,
            debitAmount: isDebitNote ? zero : line.taxAmount,
            creditAmount: isDebitNote ? line.taxAmount : zero,
            baseDebitAmount: isDebitNote ? zero : baseTax,
            baseCreditAmount: isDebitNote ? baseTax : zero,
          });
        }
      }
      const baseTotal = detailLines.reduce((sum, line) => sum.add(isDebitNote ? line.baseCreditAmount as Prisma.Decimal : line.baseDebitAmount as Prisma.Decimal), zero);
      const entry = await tx.journalEntry.create({
        data: {
          companyId: context.companyId,
          accountingDocumentId: invoice.accountingDocumentId,
          entryNumber: 1,
          entryDate: invoice.accountingDocument.documentDate,
          description: invoice.accountingDocument.description,
          lines: { create: [{
            lineNumber: 1,
            accountId: prepared.supplier.payableAccountId,
            supplierId: invoice.supplierId,
            description: invoice.accountingDocument.description,
            currencyId: invoice.currencyId,
            exchangeRate: invoice.exchangeRate,
            debitAmount: isDebitNote ? invoice.total : zero,
            creditAmount: isDebitNote ? zero : invoice.total,
            baseDebitAmount: isDebitNote ? baseTotal : zero,
            baseCreditAmount: isDebitNote ? zero : baseTotal,
          }, ...detailLines] },
        },
        include: { lines: true },
      });
      const apLine = entry.lines.find((line) => line.lineNumber === 1)!;
      await tx.purchaseInvoice.update({ where: { id }, data: { apJournalLineId: apLine.id, baseTotal } });
      const changed = await tx.accountingDocument.updateMany({
        where: { id: invoice.accountingDocumentId, companyId: context.companyId, status: "DRAFT", version },
        data: { status: "POSTED", postedBy: context.userId, postedAt: new Date(), version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new PurchaseInvoiceError("VERSION_CONFLICT");
      await archiveDocument(tx, context, invoice.accountingDocumentId);
      return { document: await tx.accountingDocument.findUniqueOrThrow({ where: { id: invoice.accountingDocumentId } }), ids: [entry.id.toString()] };
    });
  }

  async cancel(context: ActorContext, id: bigint, version: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findFirst({ where: { id, companyId: context.companyId }, include: { accountingDocument: true } });
      if (!invoice) throw new PurchaseInvoiceError("NOT_FOUND");
      if (invoice.accountingDocument.status !== "DRAFT") throw new PurchaseInvoiceError("INVALID_STATE");
      const changed = await tx.accountingDocument.updateMany({ where: { id: invoice.accountingDocumentId, companyId: context.companyId, status: "DRAFT", version }, data: { status: "CANCELLED", version: { increment: 1 } } });
      if (changed.count !== 1) throw new PurchaseInvoiceError("VERSION_CONFLICT");
      await this.audit(tx, context, "PURCHASE_INVOICE_CANCELLED", id, { reason });
      return { document: await tx.accountingDocument.findUniqueOrThrow({ where: { id: invoice.accountingDocumentId } }), ids: [] as string[], requestId: randomUUID() };
    });
  }

  reverse(context: ActorContext, id: bigint, input: { version: number; reversalDate: string; reason: string }, key: string) {
    return this.command(context, id, "REVERSE_PURCHASE_INVOICE", key, JSON.stringify({ id: id.toString(), ...input }), async (tx, invoice) => {
      const original = invoice.accountingDocument;
      if (original.status === "REVERSED" || original.reversedByDocumentId) throw new PurchaseInvoiceError("ALREADY_REVERSED");
      if (original.status !== "POSTED") throw new PurchaseInvoiceError("INVALID_STATE");
      if (original.version !== input.version) throw new PurchaseInvoiceError("VERSION_CONFLICT");
      if (original.documentType === "PURCHASE_INVOICE" && invoice.apJournalLineId) {
        const settlements = await tx.paymentAllocation.count({ where: { companyId: context.companyId, targetJournalLineId: invoice.apJournalLineId, payment: { accountingDocument: { status: "POSTED" } } } });
        const debitNotes = await tx.purchaseInvoice.count({ where: { companyId: context.companyId, sourceInvoiceId: invoice.id, accountingDocument: { documentType: "PURCHASE_DEBIT_NOTE", status: "POSTED" } } });
        if (settlements || debitNotes) throw new PurchaseInvoiceError("HAS_SETTLEMENTS");
      }
      const reversalDate = asDate(input.reversalDate);
      const period = await tx.fiscalPeriod.findFirst({ where: { companyId: context.companyId, startDate: { lte: reversalDate }, endDate: { gte: reversalDate }, status: { not: "CLOSED" } } });
      if (!period) throw new PurchaseInvoiceError("PERIOD_CLOSED");
      const originalEntry = await tx.journalEntry.findFirstOrThrow({ where: { accountingDocumentId: original.id, companyId: context.companyId }, include: { lines: true } });
      const documentNumber = await this.reserveInTransaction(tx, context.companyId, period.fiscalYearId, original.documentType);
      const reversal = await tx.accountingDocument.create({
        data: {
          companyId: context.companyId,
          fiscalPeriodId: period.id,
          documentType: original.documentType,
          documentNumber,
          documentDate: reversalDate,
          description: `عكس ${original.documentNumber}: ${input.reason}`,
          status: "POSTED",
          createdBy: context.userId,
          postedBy: context.userId,
          postedAt: new Date(),
          journalEntries: { create: [{
            entryNumber: 1,
            entryDate: reversalDate,
            description: `عكس: ${originalEntry.description}`,
            reversalOfJournalEntryId: originalEntry.id,
            lines: { create: originalEntry.lines.map((line) => ({
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
            })) },
          }] },
        },
        include: { journalEntries: true },
      });
      const changed = await tx.accountingDocument.updateMany({ where: { id: original.id, companyId: context.companyId, status: "POSTED", version: input.version, reversedByDocumentId: null }, data: { status: "REVERSED", reversedByDocumentId: reversal.id, version: { increment: 1 } } });
      if (changed.count !== 1) throw new PurchaseInvoiceError("VERSION_CONFLICT");
      return { document: await tx.accountingDocument.findUniqueOrThrow({ where: { id: original.id } }), ids: reversal.journalEntries.map((entry) => entry.id.toString()) };
    });
  }

  async listTaxRates(context: ActorContext, activeOnly = false) {
    return this.prisma.taxRate.findMany({ where: { companyId: context.companyId, ...(activeOnly ? { isActive: true } : {}) }, include: { inputTaxAccount: { select: { id: true, code: true, nameAr: true } } }, orderBy: [{ rate: "asc" }, { code: "asc" }] });
  }

  async createTaxRate(context: ActorContext, input: { nameAr: string; rate: string; inputTaxAccountId?: bigint | null }) {
    return this.prisma.$transaction(async (tx) => {
      await this.validateTaxAccount(tx, context.companyId, input.rate, input.inputTaxAccountId ?? null);
      const code = await reserveMasterDataCode(tx, context.companyId, "TAX_RATE");
      const value = await tx.taxRate.create({ data: { companyId: context.companyId, code, nameAr: input.nameAr, rate: decimal(input.rate), inputTaxAccountId: input.inputTaxAccountId ?? null }, include: { inputTaxAccount: { select: { id: true, code: true, nameAr: true } } } });
      await this.audit(tx, context, "TAX_RATE_CREATED", value.id, { code, rate: input.rate }, "TAX_RATE");
      return value;
    });
  }

  async updateTaxRate(context: ActorContext, id: bigint, input: { nameAr?: string; rate?: string; inputTaxAccountId?: bigint | null; isActive?: boolean }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.taxRate.findFirst({ where: { id, companyId: context.companyId } });
      if (!current) throw new PurchaseInvoiceError("NOT_FOUND");
      const rate = input.rate ?? current.rate.toFixed(4);
      const accountId = input.inputTaxAccountId === undefined ? current.inputTaxAccountId : input.inputTaxAccountId;
      await this.validateTaxAccount(tx, context.companyId, rate, accountId);
      const value = await tx.taxRate.update({ where: { id }, data: { ...input, ...(input.rate ? { rate: decimal(input.rate) } : {}) }, include: { inputTaxAccount: { select: { id: true, code: true, nameAr: true } } } });
      await this.audit(tx, context, "TAX_RATE_UPDATED", id, undefined, "TAX_RATE");
      return value;
    });
  }

  async payablesAging(context: ActorContext, input: { asOf: string; supplierId?: bigint }) {
    const asOf = asDate(input.asOf);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: context.companyId },
      include: { baseCurrency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
    });
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { companyId: context.companyId, ...(input.supplierId ? { supplierId: input.supplierId } : {}), accountingDocument: { documentType: "PURCHASE_INVOICE", status: "POSTED", documentDate: { lte: asOf } } },
      include: this.include(),
      orderBy: [{ supplier: { code: "asc" } }, { dueDate: "asc" }],
    });
    const rows = invoices.map((invoice) => {
      const outstanding = money(this.outstanding(invoice, asOf).mul(invoice.exchangeRate));
      const ageDays = Math.max(0, Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / 86_400_000));
      const bucket = invoice.dueDate >= asOf ? "current" : ageDays <= 30 ? "days1To30" : ageDays <= 60 ? "days31To60" : ageDays <= 90 ? "days61To90" : "daysOver90";
      return { invoice, outstanding, ageDays, bucket };
    }).filter((row) => !row.outstanding.equals(0));
    const grouped = new Map<string, any>();
    for (const row of rows) {
      const key = row.invoice.supplierId.toString();
      const current = grouped.get(key) ?? { supplierId: key, supplierCode: row.invoice.supplier.code, supplierName: row.invoice.supplier.nameAr, current: decimal(0), days1To30: decimal(0), days31To60: decimal(0), days61To90: decimal(0), daysOver90: decimal(0), total: decimal(0), invoices: [] };
      current[row.bucket] = current[row.bucket].add(row.outstanding);
      current.total = current.total.add(row.outstanding);
      current.invoices.push({ id: row.invoice.id.toString(), documentNumber: row.invoice.accountingDocument.documentNumber, documentDate: day(row.invoice.accountingDocument.documentDate), dueDate: day(row.invoice.dueDate), total: row.invoice.baseTotal.toFixed(4), outstanding: row.outstanding.toFixed(4), ageDays: row.ageDays });
      grouped.set(key, current);
    }
    const data = Array.from(grouped.values()).map((row) => ({ ...row, current: row.current.toFixed(4), days1To30: row.days1To30.toFixed(4), days31To60: row.days31To60.toFixed(4), days61To90: row.days61To90.toFixed(4), daysOver90: row.daysOver90.toFixed(4), total: row.total.toFixed(4) }));
    const totals = data.reduce((value, row) => ({ current: value.current.add(row.current), days1To30: value.days1To30.add(row.days1To30), days31To60: value.days31To60.add(row.days31To60), days61To90: value.days61To90.add(row.days61To90), daysOver90: value.daysOver90.add(row.daysOver90), total: value.total.add(row.total) }), { current: decimal(0), days1To30: decimal(0), days31To60: decimal(0), days61To90: decimal(0), daysOver90: decimal(0), total: decimal(0) });
    return {
      asOf: input.asOf,
      baseCurrency: { ...company.baseCurrency, id: company.baseCurrency.id.toString() },
      data,
      totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, (value as Prisma.Decimal).toFixed(4)])),
    };
  }

  static json(value: any) {
    const paid = value.apJournalLine ? value.apJournalLine.paymentAllocations.filter((allocation: any) => allocation.payment.accountingDocument.status === "POSTED").reduce((sum: Prisma.Decimal, allocation: any) => sum.add(allocation.allocatedAmount), decimal(0)) : decimal(0);
    const debited = value.debitNotes?.filter((note: any) => note.accountingDocument.status === "POSTED").reduce((sum: Prisma.Decimal, note: any) => sum.add(note.total), decimal(0)) ?? decimal(0);
    const outstanding = value.accountingDocument.documentType === "PURCHASE_INVOICE" ? value.total.sub(paid).sub(debited) : decimal(0);
    return {
      id: value.id.toString(),
      document: documentJson(value.accountingDocument),
      supplierId: value.supplierId.toString(),
      supplierInvoiceNumber: value.supplierInvoiceNumber,
      supplier: value.supplier ? { ...value.supplier, id: value.supplier.id.toString() } : undefined,
      sourceInvoiceId: value.sourceInvoiceId?.toString() ?? null,
      sourceInvoiceNumber: value.sourceInvoice?.accountingDocument.documentNumber ?? null,
      apJournalLineId: value.apJournalLineId?.toString() ?? null,
      currencyId: value.currencyId.toString(),
      currency: value.currency ? { ...value.currency, id: value.currency.id.toString() } : undefined,
      exchangeRate: value.exchangeRate.toFixed(8),
      dueDate: day(value.dueDate),
      subtotal: value.subtotal.toFixed(4),
      discountTotal: value.discountTotal.toFixed(4),
      taxableTotal: value.taxableTotal.toFixed(4),
      taxTotal: value.taxTotal.toFixed(4),
      total: value.total.toFixed(4),
      baseTotal: value.baseTotal.toFixed(4),
      paidAmount: paid.toFixed(4),
      debitedAmount: debited.toFixed(4),
      outstandingAmount: outstanding.toFixed(4),
      settlementStatus: outstanding.lte(0) ? "PAID" : paid.gt(0) || debited.gt(0) ? "PARTIAL" : "OPEN",
      supplierNameSnapshot: value.supplierNameSnapshot,
      supplierTaxMasked: value.supplierTaxLast4 ? `****${value.supplierTaxLast4}` : null,
      supplierAddressSnapshot: value.supplierAddressSnapshot,
      notes: value.notes,
      lines: value.lines.map((line: any) => ({ id: line.id.toString(), lineNumber: line.lineNumber, description: line.description, debitAccountId: line.debitAccountId.toString(), debitAccount: line.debitAccount ? { ...line.debitAccount, id: line.debitAccount.id.toString() } : undefined, costCenterId: line.costCenterId?.toString() ?? null, costCenter: line.costCenter ? { ...line.costCenter, id: line.costCenter.id.toString() } : null, taxRateId: line.taxRateId?.toString() ?? null, taxRate: line.taxRate ? { ...line.taxRate, id: line.taxRate.id.toString(), rate: line.taxRate.rate.toFixed(4) } : null, quantity: line.quantity.toFixed(4), unitPrice: line.unitPrice.toFixed(4), discountAmount: line.discountAmount.toFixed(4), netAmount: line.netAmount.toFixed(4), taxRateSnapshot: line.taxRateSnapshot.toFixed(4), taxAmount: line.taxAmount.toFixed(4), totalAmount: line.totalAmount.toFixed(4) })),
    };
  }

  static commandJson(value: any) {
    return { document: typeof value.document.id === "string" ? value.document : documentJson(value.document), generatedJournalEntryIds: value.generatedJournalEntryIds ?? value.ids ?? [], requestId: value.requestId };
  }

  static taxRateJson(value: any) {
    return { id: value.id.toString(), code: value.code, nameAr: value.nameAr, rate: value.rate.toFixed(4), inputTaxAccountId: value.inputTaxAccountId?.toString() ?? null, inputTaxAccount: value.inputTaxAccount ? { ...value.inputTaxAccount, id: value.inputTaxAccount.id.toString() } : null, isActive: value.isActive };
  }

  private outstanding(invoice: any, asOf?: Date) {
    const paid = invoice.apJournalLine?.paymentAllocations.filter((allocation: any) => allocation.payment.accountingDocument.status === "POSTED" && (!asOf || allocation.payment.accountingDocument.documentDate <= asOf)).reduce((sum: Prisma.Decimal, allocation: any) => sum.add(allocation.allocatedAmount), decimal(0)) ?? decimal(0);
    const debited = invoice.debitNotes?.filter((note: any) => note.accountingDocument.status === "POSTED" && (!asOf || note.accountingDocument.documentDate <= asOf)).reduce((sum: Prisma.Decimal, note: any) => sum.add(note.total), decimal(0)) ?? decimal(0);
    return invoice.total.sub(paid).sub(debited);
  }

  private async prepare(tx: Prisma.TransactionClient, companyId: bigint, input: PurchaseInvoiceInput, currentId?: bigint) {
    if (input.documentType === "PURCHASE_DEBIT_NOTE" && !input.sourceInvoiceId) throw new PurchaseInvoiceError("SOURCE_INVOICE_REQUIRED");
    if (input.documentType === "PURCHASE_INVOICE" && input.sourceInvoiceId) throw new PurchaseInvoiceError("INVALID_SOURCE_INVOICE");
    if (asDate(input.dueDate) < asDate(input.documentDate)) throw new PurchaseInvoiceError("INVALID_TOTAL");
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, companyId, isActive: true }, include: { addresses: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] } } });
    if (!supplier) throw new PurchaseInvoiceError("INVALID_SUPPLIER");
    await this.validAccount(tx, companyId, supplier.payableAccountId);
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const currency = await tx.companyCurrency.findFirst({ where: { companyId, currencyId: input.currencyId, isActive: true, currency: { isActive: true, OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: companyId }] } } });
    if (!currency || (input.currencyId === company.baseCurrencyId && !decimal(input.exchangeRate).equals(1))) throw new PurchaseInvoiceError("INVALID_CURRENCY");
    const accountIds = [...new Set(input.lines.map((line) => line.debitAccountId.toString()))].map(BigInt);
    const accounts = await tx.account.findMany({ where: { companyId, id: { in: accountIds }, isActive: true, allowsPosting: true }, include: { accountType: true, _count: { select: { children: true } } } });
    if (accounts.length !== accountIds.length || accounts.some((account) => account._count.children || !["ASSET", "EXPENSE"].includes(account.accountType.class))) throw new PurchaseInvoiceError("INVALID_ACCOUNT");
    const costCenterIds = [...new Set(input.lines.flatMap((line) => line.costCenterId ? [line.costCenterId.toString()] : []))].map(BigInt);
    if (costCenterIds.length && await tx.costCenter.count({ where: { companyId, id: { in: costCenterIds }, isActive: true } }) !== costCenterIds.length) throw new PurchaseInvoiceError("INVALID_COST_CENTER");
    const taxIds = [...new Set(input.lines.flatMap((line) => line.taxRateId ? [line.taxRateId.toString()] : []))].map(BigInt);
    const taxRates = await tx.taxRate.findMany({ where: { companyId, id: { in: taxIds }, isActive: true } });
    if (taxRates.length !== taxIds.length) throw new PurchaseInvoiceError("INVALID_TAX_RATE");
    const taxMap = new Map(taxRates.map((rate) => [rate.id.toString(), rate]));
    for (const tax of taxRates) await this.validateTaxAccount(tx, companyId, tax.rate.toFixed(4), tax.inputTaxAccountId);
    let calculation;
    try {
      calculation = calculatePurchaseInvoice(input.lines.map((line) => ({ ...line, taxRate: line.taxRateId ? taxMap.get(line.taxRateId.toString())!.rate.toFixed(4) : "0.0000" })), input.exchangeRate);
    } catch (error) {
      if (error instanceof PurchaseCalculationError) throw new PurchaseInvoiceError(error.reason);
      throw error;
    }
    if (input.documentType === "PURCHASE_DEBIT_NOTE") {
      const source = await tx.purchaseInvoice.findFirst({ where: { id: input.sourceInvoiceId!, companyId, supplierId: input.supplierId, accountingDocument: { documentType: "PURCHASE_INVOICE", status: "POSTED" } } });
      if (!source || source.currencyId !== input.currencyId) throw new PurchaseInvoiceError("INVALID_SOURCE_INVOICE");
      await this.validateDebitLimit(tx, companyId, source.id, calculation.total, currentId);
    }
    const preferredAddress = supplier.addresses.find((address) => address.addressType === "BILLING") ?? supplier.addresses[0];
    const supplierAddress = input.supplierAddress ?? (preferredAddress ? [preferredAddress.line1, preferredAddress.line2, preferredAddress.city, preferredAddress.region, preferredAddress.postalCode].filter(Boolean).join("، ") : null);
    return { supplier, supplierAddress, calculation, taxAccounts: new Map(taxRates.filter((rate) => rate.inputTaxAccountId).map((rate) => [rate.id.toString(), rate.inputTaxAccountId!])) };
  }

  private inputFrom(value: any): PurchaseInvoiceInput {
    return { documentType: value.accountingDocument.documentType, fiscalPeriodId: value.accountingDocument.fiscalPeriodId, documentDate: day(value.accountingDocument.documentDate), dueDate: day(value.dueDate), description: value.accountingDocument.description, supplierId: value.supplierId, supplierInvoiceNumber: value.supplierInvoiceNumber, sourceInvoiceId: value.sourceInvoiceId, currencyId: value.currencyId, exchangeRate: value.exchangeRate.toFixed(8), supplierAddress: value.supplierAddressSnapshot, notes: value.notes, lines: value.lines.map((line: any) => ({ description: line.description, quantity: line.quantity.toFixed(4), unitPrice: line.unitPrice.toFixed(4), discountAmount: line.discountAmount.toFixed(4), debitAccountId: line.debitAccountId, costCenterId: line.costCenterId, taxRateId: line.taxRateId })) };
  }

  private async validateDebitLimit(tx: Prisma.TransactionClient, companyId: bigint, sourceInvoiceId: bigint, amount: Prisma.Decimal, currentId?: bigint) {
    const source = await tx.purchaseInvoice.findFirst({ where: { id: sourceInvoiceId, companyId }, include: { accountingDocument: true } });
    if (!source || source.accountingDocument.documentType !== "PURCHASE_INVOICE" || source.accountingDocument.status !== "POSTED") throw new PurchaseInvoiceError("INVALID_SOURCE_INVOICE");
    const used = await tx.purchaseInvoice.aggregate({ where: { companyId, sourceInvoiceId, ...(currentId ? { id: { not: currentId } } : {}), accountingDocument: { documentType: "PURCHASE_DEBIT_NOTE", status: { in: ["DRAFT", "POSTED"] } } }, _sum: { total: true } });
    if (decimal(used._sum.total ?? 0).add(amount).gt(source.total)) throw new PurchaseInvoiceError("DEBIT_EXCEEDS_INVOICE");
  }

  private async validateTaxAccount(tx: Prisma.TransactionClient, companyId: bigint, rate: string, accountId: bigint | null) {
    const value = decimal(rate);
    if (value.lt(0) || value.gt(100)) throw new PurchaseInvoiceError("INVALID_TAX_RATE");
    if (value.gt(0)) {
      if (!accountId) throw new PurchaseInvoiceError("INVALID_TAX_RATE");
      const account = await this.validAccount(tx, companyId, accountId);
      if (account.accountType.class !== "ASSET") throw new PurchaseInvoiceError("INVALID_TAX_RATE");
    }
  }

  private async validAccount(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    const account = await tx.account.findFirst({ where: { id, companyId }, include: { accountType: true, _count: { select: { children: true } } } });
    if (!account || !account.isActive || !account.allowsPosting || account._count.children) throw new PurchaseInvoiceError("INVALID_ACCOUNT");
    return account;
  }

  private async openPeriod(companyId: bigint, id: bigint) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id, companyId } });
    if (!period) throw new PurchaseInvoiceError("NOT_FOUND");
    if (period.status === "CLOSED") throw new PurchaseInvoiceError("PERIOD_CLOSED");
    return period;
  }

  private validDate(period: { startDate: Date; endDate: Date }, value: string) {
    const date = asDate(value);
    if (date < period.startDate || date > period.endDate) throw new PurchaseInvoiceError("DATE_OUTSIDE_PERIOD");
  }

  private async reserveInTransaction(tx: Prisma.TransactionClient, companyId: bigint, fiscalYearId: bigint, documentType: string) {
    const year = await tx.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } });
    if (!year) throw new PurchaseInvoiceError("NOT_FOUND");
    const code = documentType === "PURCHASE_DEBIT_NOTE" ? "PDN" : "PI";
    const prefix = `${code}-${year.startDate.getUTCFullYear()}-`;
    const sequence = await tx.documentSequence.upsert({ where: { fiscalYearId_documentType: { fiscalYearId, documentType } }, update: {}, create: { companyId, fiscalYearId, documentType, prefix } });
    await tx.$executeRaw`UPDATE document_sequences SET next_number=LAST_INSERT_ID(next_number + 1), updated_at=CURRENT_TIMESTAMP(3) WHERE id=${sequence.id}`;
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT LAST_INSERT_ID() AS value`;
    return `${prefix}${(rows[0]!.value - 1n).toString().padStart(sequence.padding, "0")}`;
  }

  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, id: bigint, details?: Prisma.InputJsonValue, entityType = "PURCHASE_INVOICE") {
    return tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action, entityType, entityId: id.toString(), ...(details ? { details } : {}) } });
  }

  private async command(context: ActorContext, id: bigint, operation: string, key: string, fingerprint: string, execute: (tx: Prisma.TransactionClient, invoice: any) => Promise<{ document: any; ids: string[] }>) {
    const keyHash = digest(key), requestFingerprint = digest(fingerprint);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.idempotencyRecord.findUnique({ where: { companyId_userId_operation_keyHash: { companyId: context.companyId, userId: context.userId, operation, keyHash } } });
        if (existing) {
          if (!Buffer.from(existing.requestFingerprint).equals(Buffer.from(requestFingerprint))) throw new PurchaseInvoiceError("IDEMPOTENCY_MISMATCH");
          if (existing.status === "COMPLETED") return existing.responseBody as any;
          throw new PurchaseInvoiceError("IDEMPOTENCY_IN_PROGRESS");
        }
        const invoice = await tx.purchaseInvoice.findFirst({ where: { id, companyId: context.companyId }, include: { accountingDocument: true, lines: { orderBy: { lineNumber: "asc" } } } });
        if (!invoice) throw new PurchaseInvoiceError("NOT_FOUND");
        const record = await tx.idempotencyRecord.create({ data: { companyId: context.companyId, userId: context.userId, operation, keyHash, requestFingerprint, status: "IN_PROGRESS", expiresAt: new Date(Date.now() + 86_400_000) } });
        const result = await execute(tx, invoice);
        await this.audit(tx, context, operation, id);
        const response = { document: documentJson(result.document), generatedJournalEntryIds: result.ids, requestId: randomUUID() };
        await tx.idempotencyRecord.update({ where: { id: record.id }, data: { status: "COMPLETED", responseStatus: 200, responseBody: response, completedAt: new Date() } });
        return response;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code)) throw error;
      for (let attempt = 1; attempt <= 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
        const existing = await this.prisma.idempotencyRecord.findUnique({ where: { companyId_userId_operation_keyHash: { companyId: context.companyId, userId: context.userId, operation, keyHash } } });
        if (!existing) continue;
        if (!Buffer.from(existing.requestFingerprint).equals(Buffer.from(requestFingerprint))) throw new PurchaseInvoiceError("IDEMPOTENCY_MISMATCH");
        if (existing.status === "COMPLETED") return existing.responseBody as any;
      }
      throw new PurchaseInvoiceError("IDEMPOTENCY_IN_PROGRESS");
    }
  }
}
