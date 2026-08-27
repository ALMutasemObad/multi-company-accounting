import type { Prisma } from "@prisma/client";
import type { TaxSummaryQueryPort, TaxSummarySourceInvoice, TaxSummaryUsage } from "../tax-summary-types.js";
import { taxSummaryIsoDate } from "../tax-summary-calculator.js";

const invoiceSelection = {
  id: true,
  exchangeRate: true,
  accountingDocument: {
    select: {
      id: true,
      documentDate: true,
      status: true,
      documentType: true,
      reversedByDocument: { select: { id: true, documentDate: true } },
    },
  },
  lines: {
    select: { taxRateId: true, taxRateSnapshot: true, netAmount: true, taxAmount: true },
    orderBy: { lineNumber: "asc" as const },
  },
} as const;

type SalesRecord = Prisma.SalesInvoiceGetPayload<{ select: typeof invoiceSelection }>;
type PurchaseRecord = Prisma.PurchaseInvoiceGetPayload<{ select: typeof invoiceSelection }>;

function invoiceJson(value: SalesRecord | PurchaseRecord, usage: TaxSummaryUsage): TaxSummarySourceInvoice {
  return {
    usage,
    invoiceId: value.id.toString(),
    documentId: value.accountingDocument.id.toString(),
    documentDate: taxSummaryIsoDate(value.accountingDocument.documentDate),
    documentStatus: value.accountingDocument.status,
    documentType: value.accountingDocument.documentType as TaxSummarySourceInvoice["documentType"],
    reversalDocument: value.accountingDocument.reversedByDocument
      ? { id: value.accountingDocument.reversedByDocument.id.toString(), documentDate: taxSummaryIsoDate(value.accountingDocument.reversedByDocument.documentDate) }
      : null,
    exchangeRate: value.exchangeRate.toFixed(8),
    lines: value.lines.map((line) => ({
      taxRateId: line.taxRateId?.toString() ?? null,
      taxRateSnapshot: line.taxRateSnapshot.toFixed(4),
      netAmount: line.netAmount.toFixed(4),
      taxAmount: line.taxAmount.toFixed(4),
    })),
  };
}

export class PrismaTaxSummaryQueryAdapter implements TaxSummaryQueryPort {
  async load(tx: Prisma.TransactionClient, companyId: bigint, dateFrom: Date, dateTo: Date) {
    const eventRange = { gte: dateFrom, lte: dateTo };
    const documentRange = {
      OR: [
        { documentDate: eventRange },
        { reversedByDocument: { documentDate: eventRange } },
      ],
    };
    const [company, taxRates, sales, purchases] = await Promise.all([
      tx.company.findUnique({
        where: { id: companyId },
        select: { name: true, baseCurrency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
      }),
      tx.taxRate.findMany({
        where: { companyId },
        select: { id: true, code: true, nameAr: true },
        orderBy: { code: "asc" },
      }),
      tx.salesInvoice.findMany({
        where: { companyId, accountingDocument: documentRange },
        select: invoiceSelection,
        orderBy: { id: "asc" },
      }),
      tx.purchaseInvoice.findMany({
        where: { companyId, accountingDocument: documentRange },
        select: invoiceSelection,
        orderBy: { id: "asc" },
      }),
    ]);
    if (!company) return null;
    return {
      company: { name: company.name },
      baseCurrency: { ...company.baseCurrency, id: company.baseCurrency.id.toString() },
      taxRates: taxRates.map((rate) => ({ id: rate.id.toString(), code: rate.code, nameAr: rate.nameAr })),
      invoices: [...sales.map((invoice) => invoiceJson(invoice, "OUTPUT")), ...purchases.map((invoice) => invoiceJson(invoice, "INPUT"))],
    };
  }
}
