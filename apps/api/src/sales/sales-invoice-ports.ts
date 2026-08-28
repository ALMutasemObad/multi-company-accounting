import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";

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

export type SalesInvoiceImportGroup = {
  key: string;
  rows: Array<{ rowNumber: number; values: Record<string, string> }>;
};

export type SalesInvoiceImportReference = { id: bigint };

export interface SalesInvoiceImportPort {
  resolveImportedDraft(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    group: SalesInvoiceImportGroup,
  ): Promise<SalesInvoiceInput>;
  createImportedDraft(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: SalesInvoiceInput,
  ): Promise<SalesInvoiceImportReference>;
}

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
