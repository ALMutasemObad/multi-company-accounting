import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { FiscalService } from "../fiscal/fiscal-service.js";
import type { ActorContext } from "../users/user-service.js";
import { calculateInvoice, InvoiceCalculationError } from "./invoice-calculator.js";

export type SalesInvoiceErrorReason =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "PERIOD_CLOSED"
  | "DATE_OUTSIDE_PERIOD"
  | "INVALID_CUSTOMER"
  | "INVALID_ACCOUNT"
  | "INVALID_COST_CENTER"
  | "INVALID_TAX_RATE"
  | "INVALID_CURRENCY"
  | "INVALID_LINE"
  | "INVALID_DISCOUNT"
  | "INVALID_TOTAL"
  | "SOURCE_INVOICE_REQUIRED"
  | "INVALID_SOURCE_INVOICE"
  | "CREDIT_EXCEEDS_INVOICE"
  | "HAS_SETTLEMENTS"
  | "ALREADY_REVERSED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class SalesInvoiceError extends Error {
  constructor(public readonly reason: SalesInvoiceErrorReason) {
    super(reason);
  }
}

export type SalesInvoiceLineInput = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  revenueAccountId: bigint;
  costCenterId?: bigint | null;
  taxRateId?: bigint | null;
};

export type SalesInvoiceInput = {
  documentType: "SALES_INVOICE" | "SALES_CREDIT_NOTE";
  fiscalPeriodId: bigint;
  documentDate: string;
  dueDate: string;
  description: string;
  customerId: bigint;
  sourceInvoiceId?: bigint | null;
  currencyId: bigint;
  exchangeRate: string;
  customerAddress?: string | null;
  notes?: string | null;
  lines: SalesInvoiceLineInput[];
};

export type SalesInvoiceUpdate = { version: number } & Partial<SalesInvoiceInput>;

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

export class SalesInvoiceService {
  private readonly fiscal: FiscalService;

  constructor(private readonly prisma: PrismaClient) {
    this.fiscal = new FiscalService(prisma);
  }

  private include() {
    return {
      accountingDocument: true,
      customer: { select: { id: true, code: true, nameAr: true } },
      currency: { select: { id: true, code: true, nameAr: true } },
      sourceInvoice: { include: { accountingDocument: true } },
      creditNotes: { include: { accountingDocument: true } },
      lines: {
        orderBy: { lineNumber: "asc" as const },
        include: {
          revenueAccount: { select: { id: true, code: true, nameAr: true } },
          costCenter: { select: { id: true, code: true, nameAr: true } },
          taxRate: { select: { id: true, code: true, nameAr: true, rate: true } },
        },
      },
      arJournalLine: {
        include: {
          receiptAllocations: {
            include: { receipt: { include: { accountingDocument: true } } },
          },
        },
      },
    } as const;
  }

  async list(context: ActorContext, input: {
    page: number;
    pageSize: number;
    documentType?: "SALES_INVOICE" | "SALES_CREDIT_NOTE";
    status?: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";
    customerId?: bigint;
    dateFrom?: string;
    dateTo?: string;
    dueFrom?: string;
    dueTo?: string;
    search?: string;
    outstandingOnly?: boolean;
  }) {
    const where: Prisma.SalesInvoiceWhereInput = {
      companyId: context.companyId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.dueFrom || input.dueTo ? { dueDate: { ...(input.dueFrom ? { gte: asDate(input.dueFrom) } : {}), ...(input.dueTo ? { lte: asDate(input.dueTo) } : {}) } } : {}),
      accountingDocument: {
        ...(input.documentType ? { documentType: input.documentType } : { documentType: { in: ["SALES_INVOICE", "SALES_CREDIT_NOTE"] } }),
        ...(input.status ? { status: input.status } : {}),
        ...(input.dateFrom || input.dateTo ? { documentDate: { ...(input.dateFrom ? { gte: asDate(input.dateFrom) } : {}), ...(input.dateTo ? { lte: asDate(input.dateTo) } : {}) } } : {}),
        ...(input.search ? { OR: [{ documentNumber: { contains: input.search } }, { description: { contains: input.search } }] } : {}),
      },
      ...(input.search ? { OR: [{ customerNameSnapshot: { contains: input.search } }, { accountingDocument: { OR: [{ documentNumber: { contains: input.search } }, { description: { contains: input.search } }] } }] } : {}),
    };
    const all = await this.prisma.salesInvoice.findMany({
      where,
      include: this.include(),
      orderBy: [{ accountingDocument: { documentDate: "desc" } }, { id: "desc" }],
    });
    const rows = input.outstandingOnly ? all.filter((invoice) => invoice.accountingDocument.documentType === "SALES_INVOICE" && invoice.accountingDocument.status === "POSTED" && this.outstanding(invoice).gt(0)) : all;
    const offset = (input.page - 1) * input.pageSize;
    return { data: rows.slice(offset, offset + input.pageSize), total: rows.length };
  }

  async get(context: ActorContext, id: bigint) {
    const invoice = await this.prisma.salesInvoice.findFirst({ where: { id, companyId: context.companyId }, include: this.include() });
    if (!invoice) throw new SalesInvoiceError("NOT_FOUND");
    return invoice;
  }

  async create(context: ActorContext, input: SalesInvoiceInput) {
    const period = await this.openPeriod(context.companyId, input.fiscalPeriodId);
    this.validDate(period, input.documentDate);
    const documentNumber = await this.fiscal.reserveDocumentNumber(context, period.fiscalYearId, input.documentType);
    return this.prisma.$transaction(async (tx) => {
      const currentPeriod = await tx.fiscalPeriod.findFirst({ where: { id: input.fiscalPeriodId, companyId: context.companyId } });
      if (!currentPeriod || currentPeriod.status === "CLOSED") throw new SalesInvoiceError("PERIOD_CLOSED");
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
      const invoice = await tx.salesInvoice.create({
        data: {
          companyId: context.companyId,
          accountingDocumentId: document.id,
          customerId: input.customerId,
          sourceInvoiceId: input.documentType === "SALES_CREDIT_NOTE" ? input.sourceInvoiceId ?? null : null,
          currencyId: input.currencyId,
          exchangeRate: decimal(input.exchangeRate),
          dueDate: asDate(input.dueDate),
          subtotal: prepared.calculation.subtotal,
          discountTotal: prepared.calculation.discountTotal,
          taxableTotal: prepared.calculation.taxableTotal,
          taxTotal: prepared.calculation.taxTotal,
          total: prepared.calculation.total,
          baseTotal: prepared.calculation.baseTotal,
          customerNameSnapshot: prepared.customer.nameAr,
          customerTaxLast4: prepared.customer.taxNumberLast4,
          customerAddressSnapshot: prepared.customerAddress,
          notes: input.notes ?? null,
          lines: { create: prepared.calculation.lines },
        },
        include: this.include(),
      });
      await this.audit(tx, context, "SALES_INVOICE_CREATED", invoice.id, { documentType: input.documentType });
      return invoice;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async update(context: ActorContext, id: bigint, input: SalesInvoiceUpdate) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.salesInvoice.findFirst({ where: { id, companyId: context.companyId }, include: { accountingDocument: true, lines: { orderBy: { lineNumber: "asc" } } } });
      if (!current) throw new SalesInvoiceError("NOT_FOUND");
      if (current.accountingDocument.status !== "DRAFT") throw new SalesInvoiceError("INVALID_STATE");
      if (current.accountingDocument.version !== input.version) throw new SalesInvoiceError("VERSION_CONFLICT");
      if (input.documentType && input.documentType !== current.accountingDocument.documentType) throw new SalesInvoiceError("INVALID_STATE");
      const merged: SalesInvoiceInput = {
        documentType: current.accountingDocument.documentType as "SALES_INVOICE" | "SALES_CREDIT_NOTE",
        fiscalPeriodId: input.fiscalPeriodId ?? current.accountingDocument.fiscalPeriodId,
        documentDate: input.documentDate ?? day(current.accountingDocument.documentDate),
        dueDate: input.dueDate ?? day(current.dueDate),
        description: input.description ?? current.accountingDocument.description,
        customerId: input.customerId ?? current.customerId,
        sourceInvoiceId: input.sourceInvoiceId === undefined ? current.sourceInvoiceId : input.sourceInvoiceId,
        currencyId: input.currencyId ?? current.currencyId,
        exchangeRate: input.exchangeRate ?? current.exchangeRate.toFixed(8),
        customerAddress: input.customerAddress === undefined ? current.customerAddressSnapshot : input.customerAddress,
        notes: input.notes === undefined ? current.notes : input.notes,
        lines: input.lines ?? current.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity.toFixed(4),
          unitPrice: line.unitPrice.toFixed(4),
          discountAmount: line.discountAmount.toFixed(4),
          revenueAccountId: line.revenueAccountId,
          costCenterId: line.costCenterId,
          taxRateId: line.taxRateId,
        })),
      };
      const period = await tx.fiscalPeriod.findFirst({ where: { id: merged.fiscalPeriodId, companyId: context.companyId } });
      if (!period || period.status === "CLOSED") throw new SalesInvoiceError("PERIOD_CLOSED");
      this.validDate(period, merged.documentDate);
      const prepared = await this.prepare(tx, context.companyId, merged, id);
      const changed = await tx.accountingDocument.updateMany({
        where: { id: current.accountingDocumentId, companyId: context.companyId, status: "DRAFT", version: input.version },
        data: { fiscalPeriodId: merged.fiscalPeriodId, documentDate: asDate(merged.documentDate), description: merged.description, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new SalesInvoiceError("VERSION_CONFLICT");
      await tx.salesInvoiceLine.deleteMany({ where: { salesInvoiceId: id, companyId: context.companyId } });
      await tx.salesInvoice.update({
        where: { id },
        data: {
          customerId: merged.customerId,
          sourceInvoiceId: merged.documentType === "SALES_CREDIT_NOTE" ? merged.sourceInvoiceId ?? null : null,
          currencyId: merged.currencyId,
          exchangeRate: decimal(merged.exchangeRate),
          dueDate: asDate(merged.dueDate),
          subtotal: prepared.calculation.subtotal,
          discountTotal: prepared.calculation.discountTotal,
          taxableTotal: prepared.calculation.taxableTotal,
          taxTotal: prepared.calculation.taxTotal,
          total: prepared.calculation.total,
          baseTotal: prepared.calculation.baseTotal,
          customerNameSnapshot: prepared.customer.nameAr,
          customerTaxLast4: prepared.customer.taxNumberLast4,
          customerAddressSnapshot: prepared.customerAddress,
          notes: merged.notes ?? null,
          lines: { create: prepared.calculation.lines },
        },
      });
      await this.audit(tx, context, "SALES_INVOICE_UPDATED", id);
      return tx.salesInvoice.findUniqueOrThrow({ where: { id }, include: this.include() });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  post(context: ActorContext, id: bigint, version: number, key: string) {
    return this.command(context, id, "POST_SALES_INVOICE", key, JSON.stringify({ id: id.toString(), version }), async (tx, invoice) => {
      if (invoice.accountingDocument.status !== "DRAFT") throw new SalesInvoiceError("INVALID_STATE");
      if (invoice.accountingDocument.version !== version) throw new SalesInvoiceError("VERSION_CONFLICT");
      const period = await tx.fiscalPeriod.findFirst({ where: { id: invoice.accountingDocument.fiscalPeriodId, companyId: context.companyId } });
      if (!period || period.status === "CLOSED") throw new SalesInvoiceError("PERIOD_CLOSED");
      const input = this.inputFrom(invoice);
      const prepared = await this.prepare(tx, context.companyId, input, invoice.id);
      if (input.documentType === "SALES_CREDIT_NOTE") await this.validateCreditLimit(tx, context.companyId, input.sourceInvoiceId!, prepared.calculation.total, invoice.id);

      const isCreditNote = input.documentType === "SALES_CREDIT_NOTE";
      const zero = decimal(0);
      const detailLines: any[] = [];
      let lineNumber = 2;
      for (const line of prepared.calculation.lines) {
        const baseNet = money(line.netAmount.mul(invoice.exchangeRate));
        detailLines.push({
          lineNumber: lineNumber++,
          accountId: line.revenueAccountId,
          costCenterId: line.costCenterId,
          description: line.description,
          currencyId: invoice.currencyId,
          exchangeRate: invoice.exchangeRate,
          debitAmount: isCreditNote ? line.netAmount : zero,
          creditAmount: isCreditNote ? zero : line.netAmount,
          baseDebitAmount: isCreditNote ? baseNet : zero,
          baseCreditAmount: isCreditNote ? zero : baseNet,
        });
        if (line.taxAmount.gt(0)) {
          const taxAccountId = prepared.taxAccounts.get(line.taxRateId!.toString());
          if (!taxAccountId) throw new SalesInvoiceError("INVALID_TAX_RATE");
          const baseTax = money(line.taxAmount.mul(invoice.exchangeRate));
          detailLines.push({
            lineNumber: lineNumber++,
            accountId: taxAccountId,
            description: `ضريبة: ${line.description}`,
            currencyId: invoice.currencyId,
            exchangeRate: invoice.exchangeRate,
            debitAmount: isCreditNote ? line.taxAmount : zero,
            creditAmount: isCreditNote ? zero : line.taxAmount,
            baseDebitAmount: isCreditNote ? baseTax : zero,
            baseCreditAmount: isCreditNote ? zero : baseTax,
          });
        }
      }
      const baseTotal = detailLines.reduce((sum, line) => sum.add(isCreditNote ? line.baseDebitAmount as Prisma.Decimal : line.baseCreditAmount as Prisma.Decimal), zero);
      const entry = await tx.journalEntry.create({
        data: {
          companyId: context.companyId,
          accountingDocumentId: invoice.accountingDocumentId,
          entryNumber: 1,
          entryDate: invoice.accountingDocument.documentDate,
          description: invoice.accountingDocument.description,
          lines: { create: [{
            lineNumber: 1,
            accountId: prepared.customer.receivableAccountId,
            customerId: invoice.customerId,
            description: invoice.accountingDocument.description,
            currencyId: invoice.currencyId,
            exchangeRate: invoice.exchangeRate,
            debitAmount: isCreditNote ? zero : invoice.total,
            creditAmount: isCreditNote ? invoice.total : zero,
            baseDebitAmount: isCreditNote ? zero : baseTotal,
            baseCreditAmount: isCreditNote ? baseTotal : zero,
          }, ...detailLines] },
        },
        include: { lines: true },
      });
      const arLine = entry.lines.find((line) => line.lineNumber === 1)!;
      await tx.salesInvoice.update({ where: { id }, data: { arJournalLineId: arLine.id, baseTotal } });
      const changed = await tx.accountingDocument.updateMany({
        where: { id: invoice.accountingDocumentId, companyId: context.companyId, status: "DRAFT", version },
        data: { status: "POSTED", postedBy: context.userId, postedAt: new Date(), version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new SalesInvoiceError("VERSION_CONFLICT");
      return { document: await tx.accountingDocument.findUniqueOrThrow({ where: { id: invoice.accountingDocumentId } }), ids: [entry.id.toString()] };
    });
  }

  async cancel(context: ActorContext, id: bigint, version: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.findFirst({ where: { id, companyId: context.companyId }, include: { accountingDocument: true } });
      if (!invoice) throw new SalesInvoiceError("NOT_FOUND");
      if (invoice.accountingDocument.status !== "DRAFT") throw new SalesInvoiceError("INVALID_STATE");
      const changed = await tx.accountingDocument.updateMany({ where: { id: invoice.accountingDocumentId, companyId: context.companyId, status: "DRAFT", version }, data: { status: "CANCELLED", version: { increment: 1 } } });
      if (changed.count !== 1) throw new SalesInvoiceError("VERSION_CONFLICT");
      await this.audit(tx, context, "SALES_INVOICE_CANCELLED", id, { reason });
      return { document: await tx.accountingDocument.findUniqueOrThrow({ where: { id: invoice.accountingDocumentId } }), ids: [] as string[], requestId: randomUUID() };
    });
  }

  reverse(context: ActorContext, id: bigint, input: { version: number; reversalDate: string; reason: string }, key: string) {
    return this.command(context, id, "REVERSE_SALES_INVOICE", key, JSON.stringify({ id: id.toString(), ...input }), async (tx, invoice) => {
      const original = invoice.accountingDocument;
      if (original.status === "REVERSED" || original.reversedByDocumentId) throw new SalesInvoiceError("ALREADY_REVERSED");
      if (original.status !== "POSTED") throw new SalesInvoiceError("INVALID_STATE");
      if (original.version !== input.version) throw new SalesInvoiceError("VERSION_CONFLICT");
      if (original.documentType === "SALES_INVOICE" && invoice.arJournalLineId) {
        const settlements = await tx.receiptAllocation.count({ where: { companyId: context.companyId, targetJournalLineId: invoice.arJournalLineId, receipt: { accountingDocument: { status: "POSTED" } } } });
        if (settlements) throw new SalesInvoiceError("HAS_SETTLEMENTS");
      }
      const reversalDate = asDate(input.reversalDate);
      const period = await tx.fiscalPeriod.findFirst({ where: { companyId: context.companyId, startDate: { lte: reversalDate }, endDate: { gte: reversalDate }, status: { not: "CLOSED" } } });
      if (!period) throw new SalesInvoiceError("PERIOD_CLOSED");
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
              customerId: line.customerId,
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
      if (changed.count !== 1) throw new SalesInvoiceError("VERSION_CONFLICT");
      return { document: await tx.accountingDocument.findUniqueOrThrow({ where: { id: original.id } }), ids: reversal.journalEntries.map((entry) => entry.id.toString()) };
    });
  }

  async listTaxRates(context: ActorContext, activeOnly = false) {
    return this.prisma.taxRate.findMany({ where: { companyId: context.companyId, ...(activeOnly ? { isActive: true } : {}) }, include: { outputTaxAccount: { select: { id: true, code: true, nameAr: true } } }, orderBy: [{ rate: "asc" }, { code: "asc" }] });
  }

  async createTaxRate(context: ActorContext, input: { code: string; nameAr: string; rate: string; outputTaxAccountId?: bigint | null }) {
    return this.prisma.$transaction(async (tx) => {
      await this.validateTaxAccount(tx, context.companyId, input.rate, input.outputTaxAccountId ?? null);
      const value = await tx.taxRate.create({ data: { companyId: context.companyId, code: input.code, nameAr: input.nameAr, rate: decimal(input.rate), outputTaxAccountId: input.outputTaxAccountId ?? null }, include: { outputTaxAccount: { select: { id: true, code: true, nameAr: true } } } });
      await this.audit(tx, context, "TAX_RATE_CREATED", value.id, { code: input.code, rate: input.rate }, "TAX_RATE");
      return value;
    });
  }

  async updateTaxRate(context: ActorContext, id: bigint, input: { code?: string; nameAr?: string; rate?: string; outputTaxAccountId?: bigint | null; isActive?: boolean }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.taxRate.findFirst({ where: { id, companyId: context.companyId } });
      if (!current) throw new SalesInvoiceError("NOT_FOUND");
      const rate = input.rate ?? current.rate.toFixed(4);
      const accountId = input.outputTaxAccountId === undefined ? current.outputTaxAccountId : input.outputTaxAccountId;
      await this.validateTaxAccount(tx, context.companyId, rate, accountId);
      const value = await tx.taxRate.update({ where: { id }, data: { ...input, ...(input.rate ? { rate: decimal(input.rate) } : {}) }, include: { outputTaxAccount: { select: { id: true, code: true, nameAr: true } } } });
      await this.audit(tx, context, "TAX_RATE_UPDATED", id, undefined, "TAX_RATE");
      return value;
    });
  }

  async receivablesAging(context: ActorContext, input: { asOf: string; customerId?: bigint }) {
    const asOf = asDate(input.asOf);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: context.companyId },
      include: { baseCurrency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
    });
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { companyId: context.companyId, ...(input.customerId ? { customerId: input.customerId } : {}), accountingDocument: { documentType: "SALES_INVOICE", status: "POSTED", documentDate: { lte: asOf } } },
      include: this.include(),
      orderBy: [{ customer: { code: "asc" } }, { dueDate: "asc" }],
    });
    const rows = invoices.map((invoice) => {
      const outstanding = money(this.outstanding(invoice, asOf).mul(invoice.exchangeRate));
      const ageDays = Math.max(0, Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / 86_400_000));
      const bucket = invoice.dueDate >= asOf ? "current" : ageDays <= 30 ? "days1To30" : ageDays <= 60 ? "days31To60" : ageDays <= 90 ? "days61To90" : "daysOver90";
      return { invoice, outstanding, ageDays, bucket };
    }).filter((row) => !row.outstanding.equals(0));
    const grouped = new Map<string, any>();
    for (const row of rows) {
      const key = row.invoice.customerId.toString();
      const current = grouped.get(key) ?? { customerId: key, customerCode: row.invoice.customer.code, customerName: row.invoice.customer.nameAr, current: decimal(0), days1To30: decimal(0), days31To60: decimal(0), days61To90: decimal(0), daysOver90: decimal(0), total: decimal(0), invoices: [] };
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
    const paid = value.arJournalLine ? value.arJournalLine.receiptAllocations.filter((allocation: any) => allocation.receipt.accountingDocument.status === "POSTED").reduce((sum: Prisma.Decimal, allocation: any) => sum.add(allocation.allocatedAmount), decimal(0)) : decimal(0);
    const credited = value.creditNotes?.filter((note: any) => note.accountingDocument.status === "POSTED").reduce((sum: Prisma.Decimal, note: any) => sum.add(note.total), decimal(0)) ?? decimal(0);
    const outstanding = value.accountingDocument.documentType === "SALES_INVOICE" ? value.total.sub(paid).sub(credited) : decimal(0);
    return {
      id: value.id.toString(),
      document: documentJson(value.accountingDocument),
      customerId: value.customerId.toString(),
      customer: value.customer ? { ...value.customer, id: value.customer.id.toString() } : undefined,
      sourceInvoiceId: value.sourceInvoiceId?.toString() ?? null,
      sourceInvoiceNumber: value.sourceInvoice?.accountingDocument.documentNumber ?? null,
      arJournalLineId: value.arJournalLineId?.toString() ?? null,
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
      creditedAmount: credited.toFixed(4),
      outstandingAmount: outstanding.toFixed(4),
      settlementStatus: outstanding.lte(0) ? "PAID" : paid.gt(0) || credited.gt(0) ? "PARTIAL" : "OPEN",
      customerNameSnapshot: value.customerNameSnapshot,
      customerTaxMasked: value.customerTaxLast4 ? `****${value.customerTaxLast4}` : null,
      customerAddressSnapshot: value.customerAddressSnapshot,
      notes: value.notes,
      lines: value.lines.map((line: any) => ({ id: line.id.toString(), lineNumber: line.lineNumber, description: line.description, revenueAccountId: line.revenueAccountId.toString(), revenueAccount: line.revenueAccount ? { ...line.revenueAccount, id: line.revenueAccount.id.toString() } : undefined, costCenterId: line.costCenterId?.toString() ?? null, costCenter: line.costCenter ? { ...line.costCenter, id: line.costCenter.id.toString() } : null, taxRateId: line.taxRateId?.toString() ?? null, taxRate: line.taxRate ? { ...line.taxRate, id: line.taxRate.id.toString(), rate: line.taxRate.rate.toFixed(4) } : null, quantity: line.quantity.toFixed(4), unitPrice: line.unitPrice.toFixed(4), discountAmount: line.discountAmount.toFixed(4), netAmount: line.netAmount.toFixed(4), taxRateSnapshot: line.taxRateSnapshot.toFixed(4), taxAmount: line.taxAmount.toFixed(4), totalAmount: line.totalAmount.toFixed(4) })),
    };
  }

  static commandJson(value: any) {
    return { document: typeof value.document.id === "string" ? value.document : documentJson(value.document), generatedJournalEntryIds: value.generatedJournalEntryIds ?? value.ids ?? [], requestId: value.requestId };
  }

  static taxRateJson(value: any) {
    return { id: value.id.toString(), code: value.code, nameAr: value.nameAr, rate: value.rate.toFixed(4), outputTaxAccountId: value.outputTaxAccountId?.toString() ?? null, outputTaxAccount: value.outputTaxAccount ? { ...value.outputTaxAccount, id: value.outputTaxAccount.id.toString() } : null, isActive: value.isActive };
  }

  private outstanding(invoice: any, asOf?: Date) {
    const paid = invoice.arJournalLine?.receiptAllocations.filter((allocation: any) => allocation.receipt.accountingDocument.status === "POSTED" && (!asOf || allocation.receipt.accountingDocument.documentDate <= asOf)).reduce((sum: Prisma.Decimal, allocation: any) => sum.add(allocation.allocatedAmount), decimal(0)) ?? decimal(0);
    const credited = invoice.creditNotes?.filter((note: any) => note.accountingDocument.status === "POSTED" && (!asOf || note.accountingDocument.documentDate <= asOf)).reduce((sum: Prisma.Decimal, note: any) => sum.add(note.total), decimal(0)) ?? decimal(0);
    return invoice.total.sub(paid).sub(credited);
  }

  private async prepare(tx: Prisma.TransactionClient, companyId: bigint, input: SalesInvoiceInput, currentId?: bigint) {
    if (input.documentType === "SALES_CREDIT_NOTE" && !input.sourceInvoiceId) throw new SalesInvoiceError("SOURCE_INVOICE_REQUIRED");
    if (input.documentType === "SALES_INVOICE" && input.sourceInvoiceId) throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
    if (asDate(input.dueDate) < asDate(input.documentDate)) throw new SalesInvoiceError("INVALID_TOTAL");
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, companyId, isActive: true }, include: { addresses: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] } } });
    if (!customer) throw new SalesInvoiceError("INVALID_CUSTOMER");
    await this.validAccount(tx, companyId, customer.receivableAccountId);
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const currency = await tx.companyCurrency.findFirst({ where: { companyId, currencyId: input.currencyId, isActive: true, currency: { isActive: true } } });
    if (!currency || (input.currencyId === company.baseCurrencyId && !decimal(input.exchangeRate).equals(1))) throw new SalesInvoiceError("INVALID_CURRENCY");
    const accountIds = [...new Set(input.lines.map((line) => line.revenueAccountId.toString()))].map(BigInt);
    const accounts = await tx.account.findMany({ where: { companyId, id: { in: accountIds }, isActive: true, allowsPosting: true }, include: { accountType: true, _count: { select: { children: true } } } });
    if (accounts.length !== accountIds.length || accounts.some((account) => account._count.children || account.accountType.class !== "REVENUE")) throw new SalesInvoiceError("INVALID_ACCOUNT");
    const costCenterIds = [...new Set(input.lines.flatMap((line) => line.costCenterId ? [line.costCenterId.toString()] : []))].map(BigInt);
    if (costCenterIds.length && await tx.costCenter.count({ where: { companyId, id: { in: costCenterIds }, isActive: true } }) !== costCenterIds.length) throw new SalesInvoiceError("INVALID_COST_CENTER");
    const taxIds = [...new Set(input.lines.flatMap((line) => line.taxRateId ? [line.taxRateId.toString()] : []))].map(BigInt);
    const taxRates = await tx.taxRate.findMany({ where: { companyId, id: { in: taxIds }, isActive: true } });
    if (taxRates.length !== taxIds.length) throw new SalesInvoiceError("INVALID_TAX_RATE");
    const taxMap = new Map(taxRates.map((rate) => [rate.id.toString(), rate]));
    for (const tax of taxRates) await this.validateTaxAccount(tx, companyId, tax.rate.toFixed(4), tax.outputTaxAccountId);
    let calculation;
    try {
      calculation = calculateInvoice(input.lines.map((line) => ({ ...line, taxRate: line.taxRateId ? taxMap.get(line.taxRateId.toString())!.rate.toFixed(4) : "0.0000" })), input.exchangeRate);
    } catch (error) {
      if (error instanceof InvoiceCalculationError) throw new SalesInvoiceError(error.reason);
      throw error;
    }
    if (input.documentType === "SALES_CREDIT_NOTE") {
      const source = await tx.salesInvoice.findFirst({ where: { id: input.sourceInvoiceId!, companyId, customerId: input.customerId, accountingDocument: { documentType: "SALES_INVOICE", status: "POSTED" } } });
      if (!source || source.currencyId !== input.currencyId) throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
      await this.validateCreditLimit(tx, companyId, source.id, calculation.total, currentId);
    }
    const preferredAddress = customer.addresses.find((address) => address.addressType === "BILLING") ?? customer.addresses[0];
    const customerAddress = input.customerAddress ?? (preferredAddress ? [preferredAddress.line1, preferredAddress.line2, preferredAddress.city, preferredAddress.region, preferredAddress.postalCode].filter(Boolean).join("، ") : null);
    return { customer, customerAddress, calculation, taxAccounts: new Map(taxRates.filter((rate) => rate.outputTaxAccountId).map((rate) => [rate.id.toString(), rate.outputTaxAccountId!])) };
  }

  private inputFrom(value: any): SalesInvoiceInput {
    return { documentType: value.accountingDocument.documentType, fiscalPeriodId: value.accountingDocument.fiscalPeriodId, documentDate: day(value.accountingDocument.documentDate), dueDate: day(value.dueDate), description: value.accountingDocument.description, customerId: value.customerId, sourceInvoiceId: value.sourceInvoiceId, currencyId: value.currencyId, exchangeRate: value.exchangeRate.toFixed(8), customerAddress: value.customerAddressSnapshot, notes: value.notes, lines: value.lines.map((line: any) => ({ description: line.description, quantity: line.quantity.toFixed(4), unitPrice: line.unitPrice.toFixed(4), discountAmount: line.discountAmount.toFixed(4), revenueAccountId: line.revenueAccountId, costCenterId: line.costCenterId, taxRateId: line.taxRateId })) };
  }

  private async validateCreditLimit(tx: Prisma.TransactionClient, companyId: bigint, sourceInvoiceId: bigint, amount: Prisma.Decimal, currentId?: bigint) {
    const source = await tx.salesInvoice.findFirst({ where: { id: sourceInvoiceId, companyId }, include: { accountingDocument: true } });
    if (!source || source.accountingDocument.documentType !== "SALES_INVOICE" || source.accountingDocument.status !== "POSTED") throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
    const used = await tx.salesInvoice.aggregate({ where: { companyId, sourceInvoiceId, ...(currentId ? { id: { not: currentId } } : {}), accountingDocument: { documentType: "SALES_CREDIT_NOTE", status: { in: ["DRAFT", "POSTED"] } } }, _sum: { total: true } });
    if (decimal(used._sum.total ?? 0).add(amount).gt(source.total)) throw new SalesInvoiceError("CREDIT_EXCEEDS_INVOICE");
  }

  private async validateTaxAccount(tx: Prisma.TransactionClient, companyId: bigint, rate: string, accountId: bigint | null) {
    const value = decimal(rate);
    if (value.lt(0) || value.gt(100)) throw new SalesInvoiceError("INVALID_TAX_RATE");
    if (value.gt(0)) {
      if (!accountId) throw new SalesInvoiceError("INVALID_TAX_RATE");
      const account = await this.validAccount(tx, companyId, accountId);
      if (account.accountType.class !== "LIABILITY") throw new SalesInvoiceError("INVALID_TAX_RATE");
    }
  }

  private async validAccount(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    const account = await tx.account.findFirst({ where: { id, companyId }, include: { accountType: true, _count: { select: { children: true } } } });
    if (!account || !account.isActive || !account.allowsPosting || account._count.children) throw new SalesInvoiceError("INVALID_ACCOUNT");
    return account;
  }

  private async openPeriod(companyId: bigint, id: bigint) {
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id, companyId } });
    if (!period) throw new SalesInvoiceError("NOT_FOUND");
    if (period.status === "CLOSED") throw new SalesInvoiceError("PERIOD_CLOSED");
    return period;
  }

  private validDate(period: { startDate: Date; endDate: Date }, value: string) {
    const date = asDate(value);
    if (date < period.startDate || date > period.endDate) throw new SalesInvoiceError("DATE_OUTSIDE_PERIOD");
  }

  private async reserveInTransaction(tx: Prisma.TransactionClient, companyId: bigint, fiscalYearId: bigint, documentType: string) {
    const year = await tx.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } });
    if (!year) throw new SalesInvoiceError("NOT_FOUND");
    const code = documentType === "SALES_CREDIT_NOTE" ? "SCN" : "SI";
    const prefix = `${code}-${year.startDate.getUTCFullYear()}-`;
    const sequence = await tx.documentSequence.upsert({ where: { fiscalYearId_documentType: { fiscalYearId, documentType } }, update: {}, create: { companyId, fiscalYearId, documentType, prefix } });
    await tx.$executeRaw`UPDATE document_sequences SET next_number=LAST_INSERT_ID(next_number + 1), updated_at=CURRENT_TIMESTAMP(3) WHERE id=${sequence.id}`;
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT LAST_INSERT_ID() AS value`;
    return `${prefix}${(rows[0]!.value - 1n).toString().padStart(sequence.padding, "0")}`;
  }

  private audit(tx: Prisma.TransactionClient, context: ActorContext, action: string, id: bigint, details?: Prisma.InputJsonValue, entityType = "SALES_INVOICE") {
    return tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action, entityType, entityId: id.toString(), ...(details ? { details } : {}) } });
  }

  private async command(context: ActorContext, id: bigint, operation: string, key: string, fingerprint: string, execute: (tx: Prisma.TransactionClient, invoice: any) => Promise<{ document: any; ids: string[] }>) {
    const keyHash = digest(key), requestFingerprint = digest(fingerprint);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.idempotencyRecord.findUnique({ where: { companyId_userId_operation_keyHash: { companyId: context.companyId, userId: context.userId, operation, keyHash } } });
        if (existing) {
          if (!Buffer.from(existing.requestFingerprint).equals(Buffer.from(requestFingerprint))) throw new SalesInvoiceError("IDEMPOTENCY_MISMATCH");
          if (existing.status === "COMPLETED") return existing.responseBody as any;
          throw new SalesInvoiceError("IDEMPOTENCY_IN_PROGRESS");
        }
        const invoice = await tx.salesInvoice.findFirst({ where: { id, companyId: context.companyId }, include: { accountingDocument: true, lines: { orderBy: { lineNumber: "asc" } } } });
        if (!invoice) throw new SalesInvoiceError("NOT_FOUND");
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
        if (!Buffer.from(existing.requestFingerprint).equals(Buffer.from(requestFingerprint))) throw new SalesInvoiceError("IDEMPOTENCY_MISMATCH");
        if (existing.status === "COMPLETED") return existing.responseBody as any;
      }
      throw new SalesInvoiceError("IDEMPOTENCY_IN_PROGRESS");
    }
  }
}
