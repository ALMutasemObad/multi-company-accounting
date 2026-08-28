import { createHash, randomUUID } from "node:crypto";
import { Prisma, type DataImportBatch, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import { CustomerError, type CustomerImportPort, type CustomerInput } from "../sales/customer-ports.js";
import {
  SalesInvoiceError,
  type SalesInvoiceImportPort,
  type SalesInvoiceInput,
} from "../sales/sales-invoice-ports.js";
import {
  PurchaseInvoiceError,
  type PurchaseInvoiceImportPort,
  type PurchaseInvoiceInput,
} from "../purchases/purchase-invoice-ports.js";
import {
  SupplierError,
  type SupplierImportPort,
  type SupplierInput,
} from "../suppliers/supplier-ports.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import type { ActorContext } from "../platform/actor-context.js";
import { tableToCsv, tableToXlsx } from "../platform/tabular-file-exporter.js";
import type { OutboxAppender } from "../outbox/outbox.js";
import { groupInvoiceRows, importExamples, importHeaders, parseImportFile } from "./data-import-parser.js";
import type { DataImportFormatValue, DataImportInvoiceGroup, DataImportRow, DataImportRowError, DataImportTypeValue } from "./data-import-types.js";

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const amount = /^\d{1,15}(?:\.\d{1,4})?$/;
const exchangeRate = /^\d{1,11}(?:\.\d{1,8})?$/;
const partyLengths: Record<string, number> = {
  receivable_account_code: 40, payable_account_code: 40, name_ar: 200, name_en: 200,
  phone: 40, email: 320, tax_number: 64, address_type: 20, address_line1: 200,
  address_line2: 200, city: 100, region: 100, postal_code: 20, country_code: 2,
  is_primary: 5,
};
const invoiceLengths: Record<string, number> = {
  invoice_key: 100, document_date: 10, due_date: 10, description: 500,
  customer_code: 40, supplier_code: 40, supplier_invoice_number: 100, currency_code: 3,
  exchange_rate: 20, customer_address: 500, supplier_address: 500, notes: 1000,
  line_description: 500, quantity: 24, unit_price: 24, discount_amount: 24,
  account_code: 40, tax_code: 40, cost_center_code: 40,
  warehouse_code: 40, inventory_item_code: 40,
};
const validDate = (value: string) => {
  if (!date.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

type ImportCommands = CustomerInput[] | SupplierInput[] | SalesInvoiceInput[] | PurchaseInvoiceInput[];

export class DataImportError extends Error {
  constructor(public readonly reason: string, public readonly errors: DataImportRowError[] = []) { super(reason); }
}

function error(row: DataImportRow, column: string, code: string): DataImportRowError { return { row: row.rowNumber, column, code }; }

function structuralRows(rows: DataImportRow[], type: DataImportTypeValue) {
  const errors: DataImportRowError[] = [];
  const invoice = type.endsWith("INVOICES");
  for (const row of rows) {
    const required = invoice
      ? ["invoice_key", "document_date", "due_date", "description", type === "SALES_INVOICES" ? "customer_code" : "supplier_code", "currency_code", "exchange_rate", "line_description", "quantity", "unit_price", "account_code"]
      : [type === "CUSTOMERS" ? "receivable_account_code" : "payable_account_code", "name_ar"];
    for (const column of required) if (!row.values[column]) errors.push(error(row, column, "REQUIRED"));
    for (const [column, limit] of Object.entries(invoice ? invoiceLengths : partyLengths)) {
      if (row.values[column] && [...row.values[column]].length > limit) errors.push(error(row, column, "MAX_LENGTH_EXCEEDED"));
    }
    if (row.values.email && !email.test(row.values.email)) errors.push(error(row, "email", "INVALID_EMAIL"));
    if (row.values.is_primary && !["true", "false"].includes(row.values.is_primary.toLowerCase())) errors.push(error(row, "is_primary", "INVALID_BOOLEAN"));
    if (row.values.country_code && !/^[A-Z]{2}$/.test(row.values.country_code)) errors.push(error(row, "country_code", "INVALID_COUNTRY_CODE"));
    if (!invoice) {
      const allowed = type === "CUSTOMERS" ? ["LEGAL", "BILLING", "OTHER"] : ["LEGAL", "PAYMENT", "OTHER"];
      if (row.values.address_type && !allowed.includes(row.values.address_type)) errors.push(error(row, "address_type", "INVALID_ADDRESS_TYPE"));
      if (!row.values.address_line1 && ["address_type", "address_line2", "city", "region", "postal_code", "country_code", "is_primary"].some((column) => row.values[column])) errors.push(error(row, "address_line1", "ADDRESS_LINE_REQUIRED"));
    }
    if (invoice) {
      for (const column of ["document_date", "due_date"]) if (row.values[column] && !validDate(row.values[column])) errors.push(error(row, column, "INVALID_DATE"));
      if (row.values.currency_code && !/^[A-Z]{3}$/.test(row.values.currency_code)) errors.push(error(row, "currency_code", "INVALID_CURRENCY_CODE"));
      if (row.values.exchange_rate && !exchangeRate.test(row.values.exchange_rate)) errors.push(error(row, "exchange_rate", "INVALID_DECIMAL"));
      for (const column of ["quantity", "unit_price", "discount_amount"]) if (row.values[column] && !amount.test(row.values[column])) errors.push(error(row, column, "INVALID_DECIMAL"));
      if (row.values.document_date && row.values.due_date && row.values.due_date < row.values.document_date) errors.push(error(row, "due_date", "DUE_DATE_BEFORE_DOCUMENT_DATE"));
    }
  }
  return errors;
}

function consistentGroup(group: DataImportInvoiceGroup, type: DataImportTypeValue) {
  const fields = ["document_date", "due_date", "description", type === "SALES_INVOICES" ? "customer_code" : "supplier_code", "warehouse_code", "currency_code", "exchange_rate", type === "SALES_INVOICES" ? "customer_address" : "supplier_address", "notes", ...(type === "PURCHASE_INVOICES" ? ["supplier_invoice_number"] : [])];
  const first = group.rows[0]!;
  return group.rows.slice(1).flatMap((row) => fields.filter((field) => row.values[field] !== first.values[field]).map((field) => error(row, field, "INCONSISTENT_INVOICE_VALUE")));
}

function domainColumn(reason: string, type: DataImportTypeValue) {
  if (reason.includes("CUSTOMER")) return "customer_code";
  if (reason.includes("SUPPLIER")) return "supplier_code";
  if (reason.includes("CURRENCY")) return "currency_code";
  if (reason.includes("COST_CENTER")) return "cost_center_code";
  if (reason.includes("WAREHOUSE")) return "warehouse_code";
  if (reason.includes("INVENTORY_ITEM")) return "inventory_item_code";
  if (reason.includes("TAX")) return "tax_code";
  if (reason.includes("ACCOUNT")) return type === "CUSTOMERS" ? "receivable_account_code" : type === "SUPPLIERS" ? "payable_account_code" : "account_code";
  if (reason.includes("PERIOD") || reason.includes("DATE")) return "document_date";
  return "$row";
}

export class DataImportService {
  private readonly commands: IdempotentCommandExecutor;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly customers: CustomerImportPort,
    private readonly suppliers: SupplierImportPort,
    private readonly salesInvoices: SalesInvoiceImportPort,
    private readonly purchaseInvoices: PurchaseInvoiceImportPort,
    private readonly outbox: OutboxAppender,
  ) { this.commands = new IdempotentCommandExecutor(prisma); }

  template(type: DataImportTypeValue, format: DataImportFormatValue) {
    const rows = [importHeaders[type], importExamples[type]].map((values, rowIndex) => values.map((value) => ({ value, style: rowIndex === 0 ? 2 : 0 })));
    return format === "CSV" ? tableToCsv(rows) : tableToXlsx(rows, "import_template");
  }

  async list(context: ActorContext, input: { page: number; pageSize: number }) {
    const where = { companyId: context.companyId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.dataImportBatch.findMany({ where, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      this.prisma.dataImportBatch.count({ where }),
    ]);
    return { data: data.map(DataImportService.json), total };
  }

  async preview(context: ActorContext, type: DataImportTypeValue, format: DataImportFormatValue, contentBase64: string) {
    const { buffer, rows } = await parseImportFile(contentBase64, format, type);
    const hash = createHash("sha256").update(buffer).digest();
    const result = await this.prisma.$transaction(async (tx) => {
      const validation = await this.validate(tx, context.companyId, type, rows);
      const errorRows = new Set(validation.errors.map((item) => item.row));
      const batch = await tx.dataImportBatch.create({ data: { companyId: context.companyId, createdById: context.userId, importType: type, sourceFormat: format, fileHash: hash, rowCount: rows.length, validRowCount: rows.length - errorRows.size, errorRowCount: errorRows.size, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS) } });
      await appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action: "DATA_IMPORT_PREVIEWED", entityType: "DATA_IMPORT_BATCH", entityId: batch.publicId, details: { importType: type, sourceFormat: format, rowCount: rows.length, errorRowCount: errorRows.size } } });
      return { batch, errors: validation.errors };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { batch: DataImportService.json(result.batch), errors: result.errors.slice(0, 200) };
  }

  async commit(context: ActorContext, batchId: string, type: DataImportTypeValue, format: DataImportFormatValue, contentBase64: string, key: string) {
    const parsed = await parseImportFile(contentBase64, format, type);
    const fileHash = createHash("sha256").update(parsed.buffer).digest();
    const fingerprint = `${batchId}:${type}:${format}:${fileHash.toString("hex")}`;
    return this.commands.execute({ context, operation: "COMMIT_DATA_IMPORT", key, fingerprint, errors: { mismatch: () => new DataImportError("IDEMPOTENCY_MISMATCH"), inProgress: () => new DataImportError("IDEMPOTENCY_IN_PROGRESS") }, transaction: { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } }, async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM data_import_batches WHERE public_id=${batchId} AND company_id=${context.companyId} AND created_by_id=${context.userId} FOR UPDATE`;
      if (!locked[0]) throw new DataImportError("NOT_FOUND");
      const batch = await tx.dataImportBatch.findFirst({ where: { publicId: batchId, companyId: context.companyId, createdById: context.userId } });
      if (!batch) throw new DataImportError("NOT_FOUND");
      if (batch.status !== "PREVIEWED") throw new DataImportError("INVALID_STATE");
      if (batch.expiresAt <= new Date()) throw new DataImportError("PREVIEW_EXPIRED");
      if (batch.importType !== type || batch.sourceFormat !== format || !Buffer.from(batch.fileHash).equals(fileHash)) throw new DataImportError("FILE_MISMATCH");
      const validation = await this.validate(tx, context.companyId, type, parsed.rows);
      if (validation.errors.length) throw new DataImportError("IMPORT_HAS_ERRORS", validation.errors.slice(0, 200));
      const createdIds: string[] = [];
      if (type === "CUSTOMERS") for (const command of validation.commands as CustomerInput[]) createdIds.push((await this.customers.createImportedCustomer(tx, context, command)).id.toString());
      if (type === "SUPPLIERS") for (const command of validation.commands as SupplierInput[]) createdIds.push((await this.suppliers.createImportedSupplier(tx, context, command)).id.toString());
      if (type === "SALES_INVOICES") for (const command of (validation.commands as SalesInvoiceInput[]).sort(DataImportService.invoiceOrder)) createdIds.push((await this.salesInvoices.createImportedDraft(tx, context, command)).id.toString());
      if (type === "PURCHASE_INVOICES") for (const command of (validation.commands as PurchaseInvoiceInput[]).sort(DataImportService.invoiceOrder)) createdIds.push((await this.purchaseInvoices.createImportedDraft(tx, context, command)).id.toString());
      const committedAt = new Date();
      await tx.dataImportBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", committedAt } });
      await appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action: "DATA_IMPORT_COMMITTED", entityType: "DATA_IMPORT_BATCH", entityId: batch.publicId, details: { importType: type, createdCount: createdIds.length } } });
      await this.outbox.append(tx, { eventType: "DataImportCommitted", schemaVersion: 1, aggregateType: "DataImportBatch", aggregateId: batch.publicId, companyId: context.companyId, payload: { batchId: batch.publicId, importType: type, createdCount: createdIds.length, occurredBy: context.userId.toString() } });
      return { batchId: batch.publicId, status: "COMMITTED" as const, createdCount: createdIds.length, createdIds, requestId: randomUUID() };
    });
  }

  private async validate(tx: Prisma.TransactionClient, companyId: bigint, type: DataImportTypeValue, rows: DataImportRow[]): Promise<{ commands: ImportCommands; errors: DataImportRowError[] }> {
    const errors = structuralRows(rows, type);
    const commands: Array<CustomerInput | SupplierInput | SalesInvoiceInput | PurchaseInvoiceInput> = [];
    if (!type.endsWith("INVOICES")) {
      for (const row of rows) {
        if (errors.some((item) => item.row === row.rowNumber)) continue;
        try { commands.push(type === "CUSTOMERS" ? await this.customers.resolveImportedCustomer(tx, companyId, row.values) : await this.suppliers.resolveImportedSupplier(tx, companyId, row.values)); }
        catch (caught) { const reason = caught instanceof CustomerError || caught instanceof SupplierError ? caught.reason : "INVALID_ROW"; errors.push(error(row, domainColumn(reason, type), reason)); }
      }
    } else {
      const grouped = groupInvoiceRows(rows); errors.push(...grouped.errors);
      for (const group of grouped.groups) {
        const consistency = consistentGroup(group, type); errors.push(...consistency);
        if (group.rows.some((row) => errors.some((item) => item.row === row.rowNumber))) continue;
        try { commands.push(type === "SALES_INVOICES" ? await this.salesInvoices.resolveImportedDraft(tx, companyId, group) : await this.purchaseInvoices.resolveImportedDraft(tx, companyId, group)); }
        catch (caught) { const reason = caught instanceof SalesInvoiceError || caught instanceof PurchaseInvoiceError ? caught.reason : "INVALID_ROW"; errors.push(error(group.rows[0]!, domainColumn(reason, type), reason)); }
      }
    }
    return { commands: commands as ImportCommands, errors };
  }

  static json(value: DataImportBatch) {
    const status = value.status === "PREVIEWED" && value.expiresAt <= new Date() ? "EXPIRED" : value.status;
    return { id: value.publicId, importType: value.importType, sourceFormat: value.sourceFormat, rowCount: value.rowCount, validRowCount: value.validRowCount, errorRowCount: value.errorRowCount, status, expiresAt: value.expiresAt.toISOString(), committedAt: value.committedAt?.toISOString() ?? null, createdAt: value.createdAt.toISOString() };
  }

  private static invoiceOrder(left: { fiscalPeriodId: bigint; documentDate: string; description: string }, right: { fiscalPeriodId: bigint; documentDate: string; description: string }) {
    return left.fiscalPeriodId < right.fiscalPeriodId ? -1 : left.fiscalPeriodId > right.fiscalPeriodId ? 1 : left.documentDate.localeCompare(right.documentDate) || left.description.localeCompare(right.description);
  }
}
