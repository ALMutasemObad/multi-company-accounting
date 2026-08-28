import type { Prisma } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";

export type ProfessionalBillingInvoiceLineInput = {
  description: string;
  quantity: string;
  unitPrice: string;
  revenueAccountId: bigint;
  costCenterId?: bigint | null;
  taxRateId?: bigint | null;
};

export type ProfessionalBillingInvoiceInput = {
  fiscalPeriodId: bigint;
  documentDate: string;
  dueDate: string;
  description: string;
  customerId: bigint;
  currencyId: bigint;
  exchangeRate: string;
  lines: ProfessionalBillingInvoiceLineInput[];
};

export type ProfessionalBillingInvoiceReference = {
  invoiceId: bigint;
  documentId: bigint;
  documentNumber: string;
  documentStatus: "POSTED" | "REVERSED";
  currency: { id: bigint; code: string; nameAr: string };
  total: string;
  baseTotal: string;
};

export interface ProfessionalBillingSalesPort {
  lockProfessionalBillingPeriod(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    fiscalPeriodId: bigint,
    documentDate: string,
  ): Promise<void>;
  createAndPostProfessionalBillingInvoice(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    input: ProfessionalBillingInvoiceInput,
  ): Promise<ProfessionalBillingInvoiceReference>;
  listProfessionalBillingInvoiceReferences(
    companyId: bigint,
    invoiceIds: bigint[],
  ): Promise<ProfessionalBillingInvoiceReference[]>;
}
