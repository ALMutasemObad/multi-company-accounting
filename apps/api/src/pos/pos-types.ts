import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import type { SalesInvoiceLineInput } from "../sales/sales-invoice-ports.js";

export type PosCheckoutInput = {
  fiscalPeriodId: bigint;
  documentDate: string;
  description: string;
  customerId: bigint;
  warehouseId: bigint;
  currencyId: bigint;
  exchangeRate: string;
  cashBankAccountId: bigint;
  paymentMethodId: bigint;
  referenceNumber?: string | null;
  customerAddress?: string | null;
  notes?: string | null;
  lines: SalesInvoiceLineInput[];
};

export type PosSaleView = {
  id: bigint;
  completedAt: Date;
  completedBy: { id: bigint; displayName: string };
  invoice: {
    id: bigint;
    documentNumber: string;
    documentDate: Date;
    status: string;
    customerName: string;
    total: Prisma.Decimal;
    baseTotal: Prisma.Decimal;
  };
  receipt: {
    id: bigint;
    documentNumber: string;
    status: string;
  };
};

export interface PosSaleQueryPort {
  list(
    context: ActorContext,
    input: { page: number; pageSize: number },
  ): Promise<{ data: PosSaleView[]; total: number }>;
}
