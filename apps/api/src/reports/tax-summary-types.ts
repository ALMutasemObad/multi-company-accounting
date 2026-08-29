import type { Prisma } from "@prisma/client";

export type TaxSummaryUsage = "OUTPUT" | "INPUT";
export type TaxSummaryStatus = "POSTED" | "REVERSED" | "DRAFT" | "CANCELLED";
export type TaxSummaryDocumentType = "SALES_INVOICE" | "SALES_CREDIT_NOTE" | "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";

export type TaxSummaryQuery = {
  dateFrom: string;
  dateTo: string;
  status?: TaxSummaryStatus | undefined;
};

export type TaxSummarySourceInvoice = {
  usage: TaxSummaryUsage;
  invoiceId: string;
  documentId: string;
  documentDate: string;
  documentStatus: TaxSummaryStatus;
  documentType: TaxSummaryDocumentType;
  reversalDocument: { id: string; documentDate: string } | null;
  exchangeRate: string;
  lines: Array<{
    taxRateId: string | null;
    taxRateSnapshot: string;
    netAmount: string;
    taxAmount: string;
  }>;
};

export type TaxSummarySourceData = {
  company: { name: string };
  baseCurrency: { id: string; code: string; nameAr: string; decimals: number };
  taxRates: Array<{ id: string; code: string; nameAr: string }>;
  invoices: TaxSummarySourceInvoice[];
};

export type TaxSummarySourceHeader = Omit<TaxSummarySourceData, "invoices">;

export interface TaxSummaryQueryPort {
  loadHeader(
    tx: Prisma.TransactionClient,
    companyId: bigint,
  ): Promise<TaxSummarySourceHeader | null>;
  scanInvoices(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    dateFrom: Date,
    dateTo: Date,
    consume: (batch: TaxSummarySourceInvoice[]) => void | Promise<void>,
  ): Promise<void>;
}
