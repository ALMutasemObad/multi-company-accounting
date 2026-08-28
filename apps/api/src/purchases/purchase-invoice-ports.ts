import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";

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
  inventoryItemId?: bigint | null;
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
  warehouseId?: bigint | null;
  supplierInvoiceNumber?: string | null;
  sourceInvoiceId?: bigint | null;
  currencyId: bigint;
  exchangeRate: string;
  supplierAddress?: string | null;
  notes?: string | null;
  lines: PurchaseInvoiceLineInput[];
};

export type PurchaseInvoiceImportGroup = {
  key: string;
  rows: Array<{ rowNumber: number; values: Record<string, string> }>;
};

export type PurchaseInvoiceImportReference = { id: bigint };

export interface PurchaseInvoiceImportPort {
  resolveImportedDraft(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    group: PurchaseInvoiceImportGroup,
  ): Promise<PurchaseInvoiceInput>;
  createImportedDraft(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: PurchaseInvoiceInput,
  ): Promise<PurchaseInvoiceImportReference>;
}
