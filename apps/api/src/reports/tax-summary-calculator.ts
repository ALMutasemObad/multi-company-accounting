import { Prisma } from "@prisma/client";
import type {
  TaxSummaryDocumentType,
  TaxSummaryQuery,
  TaxSummarySourceData,
  TaxSummarySourceInvoice,
  TaxSummaryStatus,
  TaxSummaryUsage,
} from "./tax-summary-types.js";

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
const iso = (value: Date) => value.toISOString().slice(0, 10);

type TaxEvent = {
  documentId: string;
  documentDate: string;
  status: TaxSummaryStatus;
  multiplier: 1 | -1;
};

type Aggregate = {
  usage: TaxSummaryUsage;
  documentType: TaxSummaryDocumentType;
  status: TaxSummaryStatus;
  taxRateId: string | null;
  taxCode: string | null;
  taxNameAr: string | null;
  rate: string;
  documentIds: Set<string>;
  taxableBase: Prisma.Decimal;
  taxBase: Prisma.Decimal;
};

const originalMultiplier = (documentType: TaxSummaryDocumentType): 1 | -1 =>
  documentType === "SALES_CREDIT_NOTE" || documentType === "PURCHASE_DEBIT_NOTE" ? -1 : 1;

function events(invoice: TaxSummarySourceInvoice): TaxEvent[] {
  const multiplier = originalMultiplier(invoice.documentType);
  if (invoice.documentStatus === "DRAFT" || invoice.documentStatus === "CANCELLED") {
    return [{ documentId: invoice.documentId, documentDate: invoice.documentDate, status: invoice.documentStatus, multiplier }];
  }
  const result: TaxEvent[] = [{ documentId: invoice.documentId, documentDate: invoice.documentDate, status: "POSTED", multiplier }];
  if (invoice.documentStatus === "REVERSED" && invoice.reversalDocument) {
    result.push({
      documentId: invoice.reversalDocument.id,
      documentDate: invoice.reversalDocument.documentDate,
      status: "REVERSED",
      multiplier: multiplier === 1 ? -1 : 1,
    });
  }
  return result;
}

export function calculateTaxSummary(source: TaxSummarySourceData, query: TaxSummaryQuery) {
  const references = new Map(source.taxRates.map((rate) => [rate.id, rate]));
  const selectedStatuses = query.status ? new Set<TaxSummaryStatus>([query.status]) : new Set<TaxSummaryStatus>(["POSTED", "REVERSED"]);
  const aggregates = new Map<string, Aggregate>();
  const allDocumentIds = new Set<string>();

  for (const invoice of source.invoices) {
    for (const event of events(invoice)) {
      if (event.documentDate < query.dateFrom || event.documentDate > query.dateTo || !selectedStatuses.has(event.status)) continue;
      allDocumentIds.add(event.documentId);
      for (const line of invoice.lines) {
        const reference = line.taxRateId ? references.get(line.taxRateId) : undefined;
        const key = [invoice.usage, invoice.documentType, event.status, line.taxRateId ?? "NO_TAX", line.taxRateSnapshot].join("|");
        const aggregate = aggregates.get(key) ?? {
          usage: invoice.usage,
          documentType: invoice.documentType,
          status: event.status,
          taxRateId: line.taxRateId,
          taxCode: reference?.code ?? null,
          taxNameAr: reference?.nameAr ?? null,
          rate: money(line.taxRateSnapshot).toFixed(4),
          documentIds: new Set<string>(),
          taxableBase: ZERO,
          taxBase: ZERO,
        };
        const sign = new Prisma.Decimal(event.multiplier);
        aggregate.documentIds.add(event.documentId);
        aggregate.taxableBase = aggregate.taxableBase.add(money(new Prisma.Decimal(line.netAmount).mul(invoice.exchangeRate)).mul(sign));
        aggregate.taxBase = aggregate.taxBase.add(money(new Prisma.Decimal(line.taxAmount).mul(invoice.exchangeRate)).mul(sign));
        aggregates.set(key, aggregate);
      }
    }
  }

  const statusOrder: Record<TaxSummaryStatus, number> = { POSTED: 0, REVERSED: 1, DRAFT: 2, CANCELLED: 3 };
  const usageOrder: Record<TaxSummaryUsage, number> = { OUTPUT: 0, INPUT: 1 };
  const rows = [...aggregates.values()]
    .sort((left, right) =>
      usageOrder[left.usage] - usageOrder[right.usage]
      || statusOrder[left.status] - statusOrder[right.status]
      || left.documentType.localeCompare(right.documentType)
      || new Prisma.Decimal(left.rate).comparedTo(right.rate)
      || (left.taxCode ?? "").localeCompare(right.taxCode ?? ""))
    .map((row) => ({
      usage: row.usage,
      documentType: row.documentType,
      status: row.status,
      taxRateId: row.taxRateId,
      taxCode: row.taxCode,
      taxNameAr: row.taxNameAr,
      rate: row.rate,
      documentCount: row.documentIds.size,
      taxableBase: row.taxableBase.toFixed(4),
      taxBase: row.taxBase.toFixed(4),
    }));

  const sum = (usage: TaxSummaryUsage, field: "taxableBase" | "taxBase") => rows
    .filter((row) => row.usage === usage)
    .reduce((total, row) => total.add(row[field]), ZERO);
  const outputTaxable = sum("OUTPUT", "taxableBase");
  const outputTax = sum("OUTPUT", "taxBase");
  const inputTaxable = sum("INPUT", "taxableBase");
  const inputTax = sum("INPUT", "taxBase");

  return {
    range: { dateFrom: query.dateFrom, dateTo: query.dateTo },
    filter: { status: query.status ?? null, basis: query.status ? "STATUS_FILTER" as const : "LEDGER" as const },
    company: source.company,
    baseCurrency: source.baseCurrency,
    totals: {
      outputTaxable: outputTaxable.toFixed(4),
      outputTax: outputTax.toFixed(4),
      inputTaxable: inputTaxable.toFixed(4),
      inputTax: inputTax.toFixed(4),
      netTaxDue: outputTax.sub(inputTax).toFixed(4),
      documentCount: allDocumentIds.size,
    },
    rows,
  };
}

export const taxSummaryIsoDate = iso;
