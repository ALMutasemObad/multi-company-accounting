import { randomUUID } from "node:crypto";
import { Prisma, type AccountingDocument, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import {
  lockAccountingDocument,
  lockFiscalPeriod,
  PostingEngine,
  type PostingFailureReason,
  type PostingLinePlan,
} from "../core-accounting/posting-engine.js";
import { FiscalService } from "../fiscal/fiscal-service.js";
import {
  InventoryCatalogService,
  InventoryInvoiceSelectionError,
  inventoryQuantityFitsUnit,
  type InventoryInvoiceCatalogPort,
} from "../inventory/inventory-catalog-service.js";
import {
  InventoryMovementError,
  InventoryMovementService,
  type InventoryInvoiceStockPort,
} from "../inventory/inventory-movement-service.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { archiveDocument } from "../printing/print-archive.js";
import { ReceivableItemService } from "../receivables/receivable-item-service.js";
import { calculateTaxDocument, TaxCalculationError } from "../tax/tax-calculator.js";
import { TaxError, TaxService, type TaxQuotePort } from "../tax/tax-service.js";
import type { ActorContext } from "../platform/actor-context.js";
import type { DataImportInvoiceGroup } from "../imports/data-import-types.js";
import type {
  ProfessionalBillingInvoiceInput,
  ProfessionalBillingInvoiceReference,
  ProfessionalBillingSalesPort,
} from "./professional-billing-sales-port.js";

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
  | "WAREHOUSE_REQUIRED"
  | "INVALID_WAREHOUSE"
  | "INVALID_INVENTORY_ITEM"
  | "INVALID_QUANTITY_PRECISION"
  | "INSUFFICIENT_STOCK"
  | "INVENTORY_VALUATION_REQUIRED"
  | "INVENTORY_VALUE_MISMATCH"
  | "INVENTORY_ACCOUNTING_NOT_CONFIGURED"
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
  inventoryItemId?: bigint | null;
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
  warehouseId?: bigint | null;
  sourceInvoiceId?: bigint | null;
  currencyId: bigint;
  exchangeRate: string;
  customerAddress?: string | null;
  notes?: string | null;
  lines: SalesInvoiceLineInput[];
};

export type SalesInvoiceUpdate = { version: number } & Partial<SalesInvoiceInput>;

export type PosSalesCheckoutResult = {
  invoiceId: bigint;
  documentId: bigint;
  documentNumber: string;
  documentStatus: string;
  customerId: bigint;
  customerName: string;
  currencyId: bigint;
  total: Prisma.Decimal;
  baseTotal: Prisma.Decimal;
  receivableItemId: bigint;
  journalEntryIds: string[];
};

export interface PosSalesCheckoutPort {
  checkoutInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: SalesInvoiceInput,
  ): Promise<PosSalesCheckoutResult>;
}

type SalesInvoiceStockSnapshot = {
  id: bigint;
  warehouseId: bigint | null;
  sourceInvoiceId: bigint | null;
  accountingDocument: {
    documentType: string;
    documentNumber: string;
    documentDate: Date;
  };
  lines: Array<{
    inventoryItemId: bigint | null;
    quantity: Prisma.Decimal;
  }>;
};

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const day = (value: Date) => value.toISOString().slice(0, 10);
const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) => decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

const documentJson = (value: AccountingDocument) => ({
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

const salesInvoiceInclude = {
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
  receivableItem: {
    include: {
      receiptAllocations: {
        include: { receipt: { include: { accountingDocument: true } } },
      },
    },
  },
} as const;

type SalesInvoiceRecord = Prisma.SalesInvoiceGetPayload<{ include: typeof salesInvoiceInclude }>;
const salesInvoiceCommandInclude = {
  accountingDocument: true,
  lines: { orderBy: { lineNumber: "asc" as const } },
} as const;
type SalesInvoiceCommandRecord = Prisma.SalesInvoiceGetPayload<{ include: typeof salesInvoiceCommandInclude }>;
type SerializedAccountingDocument = ReturnType<typeof documentJson>;
type SalesCommandJsonInput = {
  document: AccountingDocument | SerializedAccountingDocument;
  generatedJournalEntryIds?: string[];
  ids?: string[];
  requestId: string;
};
type SalesAgingGroup = {
  customerId: string;
  customerCode: string;
  customerName: string;
  current: Prisma.Decimal;
  days1To30: Prisma.Decimal;
  days31To60: Prisma.Decimal;
  days61To90: Prisma.Decimal;
  daysOver90: Prisma.Decimal;
  total: Prisma.Decimal;
  invoices: Array<{ id: string; documentNumber: string; documentDate: string; dueDate: string; total: string; outstanding: string; ageDays: number }>;
};
type AgingBucket = "current" | "days1To30" | "days31To60" | "days61To90" | "daysOver90";

export class SalesInvoiceService implements ProfessionalBillingSalesPort {
  private readonly fiscal: FiscalService;
  private readonly posting = new PostingEngine();
  private readonly receivables = new ReceivableItemService();
  private readonly taxes: TaxQuotePort;
  private readonly inventory: InventoryInvoiceCatalogPort;
  private readonly stock: InventoryInvoiceStockPort;
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    taxes?: TaxQuotePort,
    inventory?: InventoryInvoiceCatalogPort,
    stock?: InventoryInvoiceStockPort,
  ) {
    this.fiscal = new FiscalService(prisma);
    this.taxes = taxes ?? new TaxService(prisma);
    this.inventory = inventory ?? new InventoryCatalogService(prisma);
    this.stock = stock ?? new InventoryMovementService(prisma);
    this.commands = new IdempotentCommandExecutor(prisma);
  }

  private include() {
    return salesInvoiceInclude;
  }

  async list(context: ActorContext, input: {
    page: number;
    pageSize: number;
    documentType?: "SALES_INVOICE" | "SALES_CREDIT_NOTE" | undefined;
    status?: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED" | undefined;
    customerId?: bigint | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    dueFrom?: string | undefined;
    dueTo?: string | undefined;
    search?: string | undefined;
    outstandingOnly?: boolean | undefined;
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
          warehouseId: prepared.inventory.warehouse?.id ?? null,
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
          warehouseCodeSnapshot: prepared.inventory.warehouse?.code ?? null,
          warehouseNameSnapshot: prepared.inventory.warehouse?.nameAr ?? null,
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
        warehouseId: input.warehouseId === undefined ? current.warehouseId : input.warehouseId,
        sourceInvoiceId: input.sourceInvoiceId === undefined ? current.sourceInvoiceId : input.sourceInvoiceId,
        currencyId: input.currencyId ?? current.currencyId,
        exchangeRate: input.exchangeRate ?? current.exchangeRate.toFixed(8),
        customerAddress: input.customerAddress === undefined ? current.customerAddressSnapshot : input.customerAddress,
        notes: input.notes === undefined ? current.notes : input.notes,
        lines: input.lines ?? current.lines.map((line) => ({
          description: line.description,
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity.toFixed(6),
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
          warehouseId: prepared.inventory.warehouse?.id ?? null,
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
          warehouseCodeSnapshot: prepared.inventory.warehouse?.code ?? null,
          warehouseNameSnapshot: prepared.inventory.warehouse?.nameAr ?? null,
          notes: merged.notes ?? null,
          lines: { create: prepared.calculation.lines },
        },
      });
      await this.audit(tx, context, "SALES_INVOICE_UPDATED", id);
      return tx.salesInvoice.findUniqueOrThrow({ where: { id }, include: this.include() });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  post(context: ActorContext, id: bigint, version: number, key: string) {
    return this.command(
      context,
      id,
      "POST_SALES_INVOICE",
      key,
      JSON.stringify({ id: id.toString(), version }),
      (tx, invoice) => this.postInTransaction(tx, context, id, version, invoice),
    );
  }

  private async postInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    id: bigint,
    version: number,
    invoice: SalesInvoiceCommandRecord,
  ) {
      const input = this.inputFrom(invoice);
      const prepared = await this.prepare(tx, context.companyId, input, invoice.id);

      const isCreditNote = input.documentType === "SALES_CREDIT_NOTE";
      const zero = decimal(0);
      const detailLines: PostingLinePlan[] = [];
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
      const postingLines: PostingLinePlan[] = [{
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
      }, ...detailLines];
      const result = await this.posting.postPlan(tx, {
        companyId: context.companyId,
        documentId: invoice.accountingDocumentId,
        expectedVersion: version,
        actorUserId: context.userId,
        error: (reason) => this.postingError(reason),
        beforeLedger: async (postingTx) => {
          if (input.documentType === "SALES_CREDIT_NOTE") {
            const source = await postingTx.salesInvoice.findFirst({
              where: { id: input.sourceInvoiceId!, companyId: context.companyId },
              select: { accountingDocumentId: true },
            });
            if (!source) throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
            await lockAccountingDocument(
              postingTx,
              context.companyId,
              source.accountingDocumentId,
            );
            await this.validateCreditItemQuantities(
              postingTx,
              context.companyId,
              input.sourceInvoiceId!,
              input.lines,
              invoice.id,
            );
            await this.receivables.applyCredit(postingTx, {
              companyId: context.companyId,
              sourceInvoiceId: input.sourceInvoiceId!,
              amount: prepared.calculation.total,
              baseAmount: baseTotal,
              invalid: () => new SalesInvoiceError("INVALID_SOURCE_INVOICE"),
              overAllocation: () => new SalesInvoiceError("CREDIT_EXCEEDS_INVOICE"),
              conflict: () => new SalesInvoiceError("VERSION_CONFLICT"),
            });
          }
          const stock = await this.applyStockMovement(
            postingTx,
            context,
            invoice,
            "POST",
            day(invoice.accountingDocument.documentDate),
          );
          if (stock && stock.totalCostBase.gt(0)) {
            const nextLineNumber = Math.max(...postingLines.map((line) => line.lineNumber)) + 1;
            postingLines.push({
              lineNumber: nextLineNumber,
              accountId: isCreditNote
                ? stock.inventoryAccountId
                : stock.costOfGoodsSoldAccountId,
              description: `تكلفة المخزون: ${invoice.accountingDocument.documentNumber}`,
              currencyId: stock.baseCurrencyId,
              exchangeRate: 1,
              debitAmount: stock.totalCostBase,
              creditAmount: zero,
              baseDebitAmount: stock.totalCostBase,
              baseCreditAmount: zero,
            }, {
              lineNumber: nextLineNumber + 1,
              accountId: isCreditNote
                ? stock.costOfGoodsSoldAccountId
                : stock.inventoryAccountId,
              description: `تكلفة المخزون: ${invoice.accountingDocument.documentNumber}`,
              currencyId: stock.baseCurrencyId,
              exchangeRate: 1,
              debitAmount: zero,
              creditAmount: stock.totalCostBase,
              baseDebitAmount: zero,
              baseCreditAmount: stock.totalCostBase,
            });
          }
        },
        afterEntries: async (postingTx, entries) => {
          const arLine = entries[0]?.lines.find((line) => line.lineNumber === 1);
          if (!arLine) throw new SalesInvoiceError("INVALID_LINE");
          await postingTx.salesInvoice.update({
            where: { id },
            data: { arJournalLineId: arLine.id, baseTotal },
          });
          if (!isCreditNote) {
            await this.receivables.createForInvoice(postingTx, {
              companyId: context.companyId,
              salesInvoiceId: invoice.id,
              customerId: invoice.customerId,
              currencyId: invoice.currencyId,
              dueDate: invoice.dueDate,
              originalAmount: invoice.total,
              originalBaseAmount: baseTotal,
            });
          }
        },
        entries: [{
          entryNumber: 1,
          entryDate: invoice.accountingDocument.documentDate,
          description: invoice.accountingDocument.description,
          lines: postingLines,
        }],
      });
      await archiveDocument(tx, context, invoice.accountingDocumentId);
      return { document: result.document, ids: result.entries.map((entry) => entry.id.toString()) };
  }

  async checkoutInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: SalesInvoiceInput,
  ): Promise<PosSalesCheckoutResult> {
    if (input.documentType !== "SALES_INVOICE") {
      throw new SalesInvoiceError("INVALID_STATE");
    }
    const invoice = await this.createDraftInTransaction(tx, context, input, "POS");
    const posted = await this.postInTransaction(tx, context, invoice.id, 0, invoice);
    await this.audit(tx, context, "POST_SALES_INVOICE", invoice.id, { source: "POS" });
    const receivableItem = await tx.receivableItem.findUnique({
      where: { salesInvoiceId: invoice.id },
      select: { id: true },
    });
    if (!receivableItem) throw new SalesInvoiceError("INVALID_STATE");
    return {
      invoiceId: invoice.id,
      documentId: posted.document.id,
      documentNumber: posted.document.documentNumber,
      documentStatus: posted.document.status,
      customerId: invoice.customerId,
      customerName: invoice.customerNameSnapshot,
      currencyId: invoice.currencyId,
      total: invoice.total,
      baseTotal: invoice.baseTotal,
      receivableItemId: receivableItem.id,
      journalEntryIds: posted.ids,
    };
  }

  async resolveImportedDraft(tx: Prisma.TransactionClient, companyId: bigint, group: DataImportInvoiceGroup): Promise<SalesInvoiceInput> {
    const first = group.rows[0]!.values;
    const documentDate = asDate(first.document_date!);
    const period = await tx.fiscalPeriod.findFirst({ where: { companyId, status: "OPEN", startDate: { lte: documentDate }, endDate: { gte: documentDate } }, orderBy: { startDate: "desc" } });
    if (!period) throw new SalesInvoiceError("PERIOD_CLOSED");
    const customer = await tx.customer.findFirst({ where: { companyId, code: first.customer_code!, isActive: true } });
    if (!customer) throw new SalesInvoiceError("INVALID_CUSTOMER");
    const inventoryItemCodes = [...new Set(group.rows.flatMap((row) => row.values.inventory_item_code ? [row.values.inventory_item_code] : []))];
    let importedInventory;
    try {
      importedInventory = await this.inventory.resolveImportedInvoiceSelection(tx, {
        companyId,
        warehouseCode: first.warehouse_code,
        inventoryItemCodes,
      });
    } catch (error) {
      if (error instanceof InventoryInvoiceSelectionError) {
        throw new SalesInvoiceError(error.reason);
      }
      throw error;
    }
    const companyCurrency = await tx.companyCurrency.findFirst({ where: { companyId, isActive: true, currency: { code: first.currency_code!, isActive: true } } });
    if (!companyCurrency) throw new SalesInvoiceError("INVALID_CURRENCY");
    let taxRateIds: Map<string, bigint>;
    try {
      taxRateIds = await this.taxes.resolveCodeIds(tx, companyId, "OUTPUT", group.rows.map((row) => row.values.tax_code ?? ""));
    } catch (error) {
      if (error instanceof TaxError) throw new SalesInvoiceError("INVALID_TAX_RATE");
      throw error;
    }
    const lines: SalesInvoiceLineInput[] = [];
    for (const row of group.rows) {
      const account = await tx.account.findFirst({ where: { companyId, code: row.values.account_code! } });
      if (!account) throw new SalesInvoiceError("INVALID_ACCOUNT");
      const costCenter = row.values.cost_center_code ? await tx.costCenter.findFirst({ where: { companyId, code: row.values.cost_center_code, isActive: true } }) : null;
      if (row.values.cost_center_code && !costCenter) throw new SalesInvoiceError("INVALID_COST_CENTER");
      lines.push({ inventoryItemId: row.values.inventory_item_code ? importedInventory.itemsByCode.get(row.values.inventory_item_code)!.id : null, description: row.values.line_description!, quantity: row.values.quantity!, unitPrice: row.values.unit_price!, discountAmount: row.values.discount_amount || "0", revenueAccountId: account.id, costCenterId: costCenter?.id ?? null, taxRateId: row.values.tax_code ? taxRateIds.get(row.values.tax_code)! : null });
    }
    const input: SalesInvoiceInput = { documentType: "SALES_INVOICE", fiscalPeriodId: period.id, documentDate: first.document_date!, dueDate: first.due_date!, description: first.description!, customerId: customer.id, warehouseId: importedInventory.warehouse?.id ?? null, currencyId: companyCurrency.currencyId, exchangeRate: first.exchange_rate!, customerAddress: first.customer_address || null, notes: first.notes || null, lines };
    this.validDate(period, input.documentDate);
    await this.prepare(tx, companyId, input);
    return input;
  }

  private async createDraftInTransaction(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: SalesInvoiceInput,
    source: "DATA_IMPORT" | "POS" | "PROFESSIONAL_BILLING",
  ) {
    const period = await tx.fiscalPeriod.findFirst({ where: { id: input.fiscalPeriodId, companyId: context.companyId } });
    if (!period || period.status === "CLOSED") throw new SalesInvoiceError("PERIOD_CLOSED");
    this.validDate(period, input.documentDate);
    const prepared = await this.prepare(tx, context.companyId, input);
    const documentNumber = await this.reserveInTransaction(tx, context.companyId, period.fiscalYearId, "SALES_INVOICE");
    const document = await tx.accountingDocument.create({ data: { companyId: context.companyId, fiscalPeriodId: input.fiscalPeriodId, documentType: "SALES_INVOICE", documentNumber, documentDate: asDate(input.documentDate), description: input.description, createdBy: context.userId } });
    const invoice = await tx.salesInvoice.create({
      data: { companyId: context.companyId, accountingDocumentId: document.id, customerId: input.customerId, warehouseId: prepared.inventory.warehouse?.id ?? null, currencyId: input.currencyId, exchangeRate: decimal(input.exchangeRate), dueDate: asDate(input.dueDate), subtotal: prepared.calculation.subtotal, discountTotal: prepared.calculation.discountTotal, taxableTotal: prepared.calculation.taxableTotal, taxTotal: prepared.calculation.taxTotal, total: prepared.calculation.total, baseTotal: prepared.calculation.baseTotal, customerNameSnapshot: prepared.customer.nameAr, customerTaxLast4: prepared.customer.taxNumberLast4, customerAddressSnapshot: prepared.customerAddress, warehouseCodeSnapshot: prepared.inventory.warehouse?.code ?? null, warehouseNameSnapshot: prepared.inventory.warehouse?.nameAr ?? null, notes: input.notes ?? null, lines: { create: prepared.calculation.lines } },
      include: this.include(),
    });
    await this.audit(tx, context, "SALES_INVOICE_CREATED", invoice.id, { documentType: "SALES_INVOICE", source });
    return invoice;
  }

  async createImportedDraft(tx: Prisma.TransactionClient, context: ActorContext, input: SalesInvoiceInput) {
    return this.createDraftInTransaction(tx, context, input, "DATA_IMPORT");
  }

  async lockProfessionalBillingPeriod(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    fiscalPeriodId: bigint,
    documentDate: string,
  ) {
    if (!await lockFiscalPeriod(tx, context.companyId, fiscalPeriodId)) {
      throw new SalesInvoiceError("PERIOD_CLOSED");
    }
    const period = await tx.fiscalPeriod.findFirst({
      where: { id: fiscalPeriodId, companyId: context.companyId },
    });
    if (!period || period.status === "CLOSED") throw new SalesInvoiceError("PERIOD_CLOSED");
    this.validDate(period, documentDate);
  }

  async createAndPostProfessionalBillingInvoice(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ProfessionalBillingInvoiceInput,
  ): Promise<ProfessionalBillingInvoiceReference> {
    const invoice = await this.createDraftInTransaction(tx, context, {
      ...input,
      documentType: "SALES_INVOICE",
      warehouseId: null,
      sourceInvoiceId: null,
      customerAddress: null,
      notes: null,
      lines: input.lines.map((line) => ({
        ...line,
        inventoryItemId: null,
        discountAmount: "0.0000",
      })),
    }, "PROFESSIONAL_BILLING");
    const posted = await this.postInTransaction(tx, context, invoice.id, 0, invoice);
    await this.audit(tx, context, "POST_SALES_INVOICE", invoice.id, { source: "PROFESSIONAL_BILLING" });
    const currency = await tx.currency.findUniqueOrThrow({
      where: { id: invoice.currencyId },
      select: { id: true, code: true, nameAr: true },
    });
    return {
      invoiceId: invoice.id,
      documentId: posted.document.id,
      documentNumber: posted.document.documentNumber,
      documentStatus: "POSTED",
      currency,
      total: invoice.total.toFixed(4),
      baseTotal: invoice.baseTotal.toFixed(4),
    };
  }

  async listProfessionalBillingInvoiceReferences(
    companyId: bigint,
    invoiceIds: bigint[],
  ): Promise<ProfessionalBillingInvoiceReference[]> {
    if (invoiceIds.length === 0) return [];
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { companyId, id: { in: invoiceIds } },
      include: { accountingDocument: true, currency: { select: { id: true, code: true, nameAr: true } } },
      orderBy: [{ id: "asc" }],
    });
    return invoices.map((invoice) => ({
      invoiceId: invoice.id,
      documentId: invoice.accountingDocumentId,
      documentNumber: invoice.accountingDocument.documentNumber,
      documentStatus: invoice.accountingDocument.status as "POSTED" | "REVERSED",
      currency: invoice.currency,
      total: invoice.total.toFixed(4),
      baseTotal: invoice.baseTotal.toFixed(4),
    }));
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
      const result = await this.posting.reverse(tx, {
        companyId: context.companyId,
        documentId: invoice.accountingDocumentId,
        expectedVersion: input.version,
        actorUserId: context.userId,
        reversalDate: asDate(input.reversalDate),
        description: (original) => `عكس ${original.documentNumber}: ${input.reason}`,
        reserveDocumentNumber: (sequenceTx, period, documentType) =>
          this.reserveInTransaction(
            sequenceTx,
            context.companyId,
            period.fiscalYearId,
            documentType,
          ),
        beforeLedger: async (postingTx, original) => {
          if (original.documentType === "SALES_INVOICE") {
            await this.receivables.reverseInvoice(postingTx, {
              companyId: context.companyId,
              salesInvoiceId: invoice.id,
              invalid: () => new SalesInvoiceError("INVALID_SOURCE_INVOICE"),
              hasSettlements: () => new SalesInvoiceError("HAS_SETTLEMENTS"),
              conflict: () => new SalesInvoiceError("VERSION_CONFLICT"),
            });
          } else if (original.documentType === "SALES_CREDIT_NOTE") {
            if (!invoice.sourceInvoiceId)
              throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
            await this.receivables.reverseCredit(postingTx, {
              companyId: context.companyId,
              sourceInvoiceId: invoice.sourceInvoiceId,
              amount: invoice.total,
              baseAmount: invoice.baseTotal,
              invalid: () => new SalesInvoiceError("INVALID_SOURCE_INVOICE"),
              conflict: () => new SalesInvoiceError("VERSION_CONFLICT"),
            });
          }
          await this.applyStockMovement(
            postingTx,
            context,
            invoice,
            "REVERSE",
            input.reversalDate,
          );
        },
        error: (reason) => this.postingError(reason),
      });
      return { document: result.document, ids: result.entries.map((entry) => entry.id.toString()) };
    });
  }

  async receivablesAging(context: ActorContext, input: { asOf: string; customerId?: bigint | undefined }) {
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
      const bucket: AgingBucket = invoice.dueDate >= asOf ? "current" : ageDays <= 30 ? "days1To30" : ageDays <= 60 ? "days31To60" : ageDays <= 90 ? "days61To90" : "daysOver90";
      return { invoice, outstanding, ageDays, bucket };
    }).filter((row) => !row.outstanding.equals(0));
    const grouped = new Map<string, SalesAgingGroup>();
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

  static json(value: SalesInvoiceRecord) {
    const paid = value.receivableItem ? value.receivableItem.receiptAllocations.filter((allocation) => allocation.receipt.accountingDocument.status === "POSTED").reduce((sum: Prisma.Decimal, allocation) => sum.add(allocation.allocatedAmount), decimal(0)) : decimal(0);
    const credited = value.creditNotes.filter((note) => note.accountingDocument.status === "POSTED").reduce((sum: Prisma.Decimal, note) => sum.add(note.total), decimal(0));
    const outstanding = value.accountingDocument.documentType === "SALES_INVOICE" ? value.receivableItem?.outstandingAmount ?? value.total.sub(paid).sub(credited) : decimal(0);
    const outstandingBase = value.accountingDocument.documentType !== "SALES_INVOICE"
      ? decimal(0)
      : !value.receivableItem
        ? value.baseTotal
        : value.receivableItem.originalBaseAmount.gt(0)
          ? value.receivableItem.outstandingBaseAmount
          : outstanding.equals(0) || value.total.lte(0)
            ? decimal(0)
            : money(value.baseTotal.mul(outstanding).div(value.total));
    return {
      id: value.id.toString(),
      document: documentJson(value.accountingDocument),
      customerId: value.customerId.toString(),
      customer: value.customer ? { ...value.customer, id: value.customer.id.toString() } : undefined,
      warehouseId: value.warehouseId?.toString() ?? null,
      warehouseCodeSnapshot: value.warehouseCodeSnapshot,
      warehouseNameSnapshot: value.warehouseNameSnapshot,
      sourceInvoiceId: value.sourceInvoiceId?.toString() ?? null,
      sourceInvoiceNumber: value.sourceInvoice?.accountingDocument.documentNumber ?? null,
      receivableItemId: value.receivableItem?.id.toString() ?? null,
      settlementVersion: value.receivableItem?.version ?? null,
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
      outstandingBaseAmount: outstandingBase.toFixed(4),
      settlementStatus: outstanding.lte(0) ? "PAID" : paid.gt(0) || credited.gt(0) ? "PARTIAL" : "OPEN",
      customerNameSnapshot: value.customerNameSnapshot,
      customerTaxMasked: value.customerTaxLast4 ? `****${value.customerTaxLast4}` : null,
      customerAddressSnapshot: value.customerAddressSnapshot,
      notes: value.notes,
      lines: value.lines.map((line) => ({
        id: line.id.toString(),
        lineNumber: line.lineNumber,
        inventoryItemId: line.inventoryItemId?.toString() ?? null,
        inventoryItemCodeSnapshot: line.inventoryItemCodeSnapshot,
        inventoryItemNameSnapshot: line.inventoryItemNameSnapshot,
        unitOfMeasureCodeSnapshot: line.unitOfMeasureCodeSnapshot,
        description: line.description,
        revenueAccountId: line.revenueAccountId.toString(),
        revenueAccount: line.revenueAccount ? { ...line.revenueAccount, id: line.revenueAccount.id.toString() } : undefined,
        costCenterId: line.costCenterId?.toString() ?? null,
        costCenter: line.costCenter ? { ...line.costCenter, id: line.costCenter.id.toString() } : null,
        taxRateId: line.taxRateId?.toString() ?? null,
        taxRate: line.taxRate ? { ...line.taxRate, id: line.taxRate.id.toString(), rate: line.taxRate.rate.toFixed(4) } : null,
        quantity: line.quantity.toFixed(6),
        unitPrice: line.unitPrice.toFixed(4),
        discountAmount: line.discountAmount.toFixed(4),
        netAmount: line.netAmount.toFixed(4),
        taxRateSnapshot: line.taxRateSnapshot.toFixed(4),
        taxAmount: line.taxAmount.toFixed(4),
        totalAmount: line.totalAmount.toFixed(4),
      })),
    };
  }

  static commandJson(value: SalesCommandJsonInput) {
    return { document: "companyId" in value.document ? documentJson(value.document) : value.document, generatedJournalEntryIds: value.generatedJournalEntryIds ?? value.ids ?? [], requestId: value.requestId };
  }

  private outstanding(invoice: SalesInvoiceRecord, asOf?: Date) {
    if (!asOf && invoice.receivableItem) return invoice.receivableItem.outstandingAmount;
    const paid = invoice.receivableItem?.receiptAllocations.filter((allocation) => allocation.receipt.accountingDocument.status === "POSTED" && (!asOf || allocation.receipt.accountingDocument.documentDate <= asOf)).reduce((sum: Prisma.Decimal, allocation) => sum.add(allocation.allocatedAmount), decimal(0)) ?? decimal(0);
    const credited = invoice.creditNotes.filter((note) => note.accountingDocument.status === "POSTED" && (!asOf || note.accountingDocument.documentDate <= asOf)).reduce((sum: Prisma.Decimal, note) => sum.add(note.total), decimal(0));
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
    const currency = await tx.companyCurrency.findFirst({ where: { companyId, currencyId: input.currencyId, isActive: true, currency: { isActive: true, OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: companyId }] } } });
    if (!currency || (input.currencyId === company.baseCurrencyId && !decimal(input.exchangeRate).equals(1))) throw new SalesInvoiceError("INVALID_CURRENCY");
    const accountIds = [...new Set(input.lines.map((line) => line.revenueAccountId.toString()))].map(BigInt);
    const accounts = await tx.account.findMany({ where: { companyId, id: { in: accountIds }, isActive: true, allowsPosting: true }, include: { accountType: true, _count: { select: { children: true } } } });
    if (accounts.length !== accountIds.length || accounts.some((account) => account._count.children || account.accountType.class !== "REVENUE")) throw new SalesInvoiceError("INVALID_ACCOUNT");
    const costCenterIds = [...new Set(input.lines.flatMap((line) => line.costCenterId ? [line.costCenterId.toString()] : []))].map(BigInt);
    if (costCenterIds.length && await tx.costCenter.count({ where: { companyId, id: { in: costCenterIds }, isActive: true } }) !== costCenterIds.length) throw new SalesInvoiceError("INVALID_COST_CENTER");
    let inventory;
    try {
      inventory = await this.inventory.resolveInvoiceSelection(tx, {
        companyId,
        warehouseId: input.warehouseId,
        inventoryItemIds: input.lines.flatMap((line) =>
          line.inventoryItemId ? [line.inventoryItemId] : [],
        ),
      });
    } catch (error) {
      if (error instanceof InventoryInvoiceSelectionError) {
        throw new SalesInvoiceError(error.reason);
      }
      throw error;
    }
    for (const line of input.lines) {
      if (!line.inventoryItemId) continue;
      const item = inventory.items.get(line.inventoryItemId.toString());
      if (!item) throw new SalesInvoiceError("INVALID_INVENTORY_ITEM");
      if (!inventoryQuantityFitsUnit(line.quantity, item.unitOfMeasure.decimalPlaces)) {
        throw new SalesInvoiceError("INVALID_QUANTITY_PRECISION");
      }
    }
    const taxIds = [...new Set(input.lines.flatMap((line) => line.taxRateId ? [line.taxRateId.toString()] : []))].map(BigInt);
    let taxQuotes;
    try {
      taxQuotes = await this.taxes.resolveQuotes(tx, companyId, "OUTPUT", taxIds);
    } catch (error) {
      if (error instanceof TaxError) throw new SalesInvoiceError("INVALID_TAX_RATE");
      throw error;
    }
    let calculation;
    try {
      const taxCalculation = calculateTaxDocument(input.lines.map((line) => ({
        description: line.description,
        accountId: line.revenueAccountId,
        costCenterId: line.costCenterId ?? null,
        taxRateId: line.taxRateId ?? null,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxRate: line.taxRateId
          ? taxQuotes.get(line.taxRateId.toString())!.rate.toFixed(4)
          : "0.0000",
      })), input.exchangeRate);
      calculation = {
        ...taxCalculation,
        lines: taxCalculation.lines.map(({ accountId, ...line }, index) => {
          const inventoryItemId = input.lines[index]!.inventoryItemId ?? null;
          const item = inventoryItemId
            ? inventory.items.get(inventoryItemId.toString())
            : undefined;
          return {
            ...line,
            revenueAccountId: accountId,
            inventoryItemId,
            inventoryItemCodeSnapshot: item?.code ?? null,
            inventoryItemNameSnapshot: item?.nameAr ?? null,
            unitOfMeasureCodeSnapshot: item?.unitOfMeasure.code ?? null,
          };
        }),
      };
    } catch (error) {
      if (error instanceof TaxCalculationError) throw new SalesInvoiceError(error.reason);
      throw error;
    }
    if (input.documentType === "SALES_CREDIT_NOTE") {
      const source = await tx.salesInvoice.findFirst({ where: { id: input.sourceInvoiceId!, companyId, customerId: input.customerId, accountingDocument: { documentType: "SALES_INVOICE", status: "POSTED" } } });
      if (
        !source ||
        source.currencyId !== input.currencyId ||
        !source.exchangeRate.equals(decimal(input.exchangeRate))
      ) throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
      await this.validateCreditLimit(tx, companyId, source.id, calculation.total, currentId);
      await this.validateCreditItemQuantities(tx, companyId, source.id, input.lines, currentId);
    }
    const preferredAddress = customer.addresses.find((address) => address.addressType === "BILLING") ?? customer.addresses[0];
    const customerAddress = input.customerAddress ?? (preferredAddress ? [preferredAddress.line1, preferredAddress.line2, preferredAddress.city, preferredAddress.region, preferredAddress.postalCode].filter(Boolean).join("، ") : null);
    return {
      customer,
      customerAddress,
      calculation,
      inventory,
      taxAccounts: new Map([...taxQuotes].flatMap(([id, quote]) =>
        quote.accountId ? [[id, quote.accountId] as const] : [])),
    };
  }

  private inputFrom(value: SalesInvoiceCommandRecord): SalesInvoiceInput {
    return { documentType: value.accountingDocument.documentType as SalesInvoiceInput["documentType"], fiscalPeriodId: value.accountingDocument.fiscalPeriodId, documentDate: day(value.accountingDocument.documentDate), dueDate: day(value.dueDate), description: value.accountingDocument.description, customerId: value.customerId, warehouseId: value.warehouseId, sourceInvoiceId: value.sourceInvoiceId, currencyId: value.currencyId, exchangeRate: value.exchangeRate.toFixed(8), customerAddress: value.customerAddressSnapshot, notes: value.notes, lines: value.lines.map((line) => ({ inventoryItemId: line.inventoryItemId, description: line.description, quantity: line.quantity.toFixed(6), unitPrice: line.unitPrice.toFixed(4), discountAmount: line.discountAmount.toFixed(4), revenueAccountId: line.revenueAccountId, costCenterId: line.costCenterId, taxRateId: line.taxRateId })) };
  }

  private async validateCreditLimit(tx: Prisma.TransactionClient, companyId: bigint, sourceInvoiceId: bigint, amount: Prisma.Decimal, currentId?: bigint) {
    const source = await tx.salesInvoice.findFirst({ where: { id: sourceInvoiceId, companyId }, include: { accountingDocument: true, receivableItem: true } });
    if (!source || source.accountingDocument.documentType !== "SALES_INVOICE" || source.accountingDocument.status !== "POSTED") throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
    if (!source.receivableItem) throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
    const reserved = await tx.salesInvoice.aggregate({ where: { companyId, sourceInvoiceId, ...(currentId ? { id: { not: currentId } } : {}), accountingDocument: { documentType: "SALES_CREDIT_NOTE", status: "DRAFT" } }, _sum: { total: true } });
    if (decimal(reserved._sum.total ?? 0).add(amount).gt(source.receivableItem.outstandingAmount)) throw new SalesInvoiceError("CREDIT_EXCEEDS_INVOICE");
  }

  private async validateCreditItemQuantities(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    sourceInvoiceId: bigint,
    lines: SalesInvoiceLineInput[],
    currentId?: bigint,
  ) {
    const requested = this.inventoryQuantities(lines);
    if (requested.size === 0) return;
    const source = await tx.salesInvoice.findFirst({
      where: {
        id: sourceInvoiceId,
        companyId,
        accountingDocument: { documentType: "SALES_INVOICE", status: "POSTED" },
      },
      select: { lines: { select: { inventoryItemId: true, quantity: true } } },
    });
    if (!source) throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
    const available = this.inventoryQuantities(source.lines);
    const credits = await tx.salesInvoice.findMany({
      where: {
        companyId,
        sourceInvoiceId,
        ...(currentId ? { id: { not: currentId } } : {}),
        accountingDocument: {
          documentType: "SALES_CREDIT_NOTE",
          status: { in: ["DRAFT", "POSTED"] },
        },
      },
      select: { lines: { select: { inventoryItemId: true, quantity: true } } },
    });
    const alreadyCredited = this.inventoryQuantities(credits.flatMap((credit) => credit.lines));
    for (const [itemId, quantity] of requested) {
      const sourceQuantity = available.get(itemId);
      if (!sourceQuantity || quantity.add(alreadyCredited.get(itemId) ?? 0).gt(sourceQuantity)) {
        throw new SalesInvoiceError("INVALID_SOURCE_INVOICE");
      }
    }
  }

  private inventoryQuantities(
    lines: Array<{ inventoryItemId?: bigint | null; quantity: Prisma.Decimal.Value }>,
  ) {
    const result = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      if (!line.inventoryItemId) continue;
      const key = line.inventoryItemId.toString();
      result.set(key, (result.get(key) ?? decimal(0)).add(line.quantity));
    }
    return result;
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
    return appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action, entityType, entityId: id.toString(), ...(details ? { details } : {}) } });
  }

  private async applyStockMovement(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    invoice: SalesInvoiceStockSnapshot,
    sourceEvent: "POST" | "REVERSE",
    stockDate: string,
  ) {
    const inventoryLines = invoice.lines.flatMap((line) => line.inventoryItemId
      ? [{ inventoryItemId: line.inventoryItemId, quantity: line.quantity.toFixed(6) }]
      : []);
    if (inventoryLines.length === 0) return null;
    if (!invoice.warehouseId) throw new SalesInvoiceError("WAREHOUSE_REQUIRED");
    try {
      return await this.stock.applyInvoiceStockMovement(tx, {
        companyId: context.companyId,
        actorUserId: context.userId,
        invoiceId: invoice.id,
        sourceInvoiceId: invoice.sourceInvoiceId,
        documentType: invoice.accountingDocument.documentType as "SALES_INVOICE" | "SALES_CREDIT_NOTE",
        sourceEvent,
        documentNumber: invoice.accountingDocument.documentNumber,
        movementDate: stockDate,
        warehouseId: invoice.warehouseId,
        lines: inventoryLines,
      });
    } catch (error) {
      if (!(error instanceof InventoryMovementError)) throw error;
      if (error.reason === "INSUFFICIENT_STOCK") {
        throw new SalesInvoiceError("INSUFFICIENT_STOCK");
      }
      if (error.reason === "INVENTORY_VALUATION_REQUIRED") {
        throw new SalesInvoiceError("INVENTORY_VALUATION_REQUIRED");
      }
      if (["INSUFFICIENT_INVENTORY_VALUE", "INVENTORY_VALUE_MISMATCH"].includes(error.reason)) {
        throw new SalesInvoiceError("INVENTORY_VALUE_MISMATCH");
      }
      if (error.reason === "INVENTORY_ACCOUNTING_NOT_CONFIGURED") {
        throw new SalesInvoiceError("INVENTORY_ACCOUNTING_NOT_CONFIGURED");
      }
      if (["INVALID_WAREHOUSE", "WAREHOUSE_INACTIVE"].includes(error.reason)) {
        throw new SalesInvoiceError("INVALID_WAREHOUSE");
      }
      if (["INVALID_INVENTORY_ITEM", "ITEM_INACTIVE"].includes(error.reason)) {
        throw new SalesInvoiceError("INVALID_INVENTORY_ITEM");
      }
      if (error.reason === "INVALID_QUANTITY_PRECISION") {
        throw new SalesInvoiceError("INVALID_QUANTITY_PRECISION");
      }
      throw new SalesInvoiceError("INVALID_LINE");
    }
  }

  private async command(context: ActorContext, id: bigint, operation: string, key: string, fingerprint: string, execute: (tx: Prisma.TransactionClient, invoice: SalesInvoiceCommandRecord) => Promise<{ document: AccountingDocument; ids: string[] }>) {
    return this.commands.execute({
      context,
      operation,
      key,
      fingerprint,
      errors: {
        mismatch: () => new SalesInvoiceError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new SalesInvoiceError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, async (tx) => {
        const invoice = await tx.salesInvoice.findFirst({ where: { id, companyId: context.companyId }, include: salesInvoiceCommandInclude });
        if (!invoice) throw new SalesInvoiceError("NOT_FOUND");
        const result = await execute(tx, invoice);
        await this.audit(tx, context, operation, id);
        return { document: documentJson(result.document), generatedJournalEntryIds: result.ids, requestId: randomUUID() };
    });
  }

  private postingError(reason: PostingFailureReason) {
    if (reason === "UNBALANCED") return new SalesInvoiceError("INVALID_TOTAL");
    return new SalesInvoiceError(reason);
  }
}
