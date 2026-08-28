import { describe, expect, it } from "vitest";
import { calculateTaxSummary } from "../src/reports/tax-summary-calculator.js";
import type { TaxSummarySourceData, TaxSummarySourceInvoice } from "../src/reports/tax-summary-types.js";

const line = (netAmount: string, taxAmount: string, taxRateId: string | null = "15") => ({
  taxRateId,
  taxRateSnapshot: taxRateId ? "15.0000" : "0.0000",
  netAmount,
  taxAmount,
});

const invoice = (value: Partial<TaxSummarySourceInvoice> & Pick<TaxSummarySourceInvoice, "usage" | "documentType">): TaxSummarySourceInvoice => ({
  invoiceId: "1",
  documentId: "101",
  documentDate: "2026-08-01",
  documentStatus: "POSTED",
  reversalDocument: null,
  exchangeRate: "1.00000000",
  lines: [line("100.0000", "15.0000")],
  ...value,
});

const source = (invoices: TaxSummarySourceInvoice[]): TaxSummarySourceData => ({
  company: { name: "شركة الاختبار" },
  baseCurrency: { id: "1", code: "SAR", nameAr: "ريال سعودي", decimals: 2 },
  taxRates: [{ id: "15", code: "VAT-15", nameAr: "ضريبة 15%" }],
  invoices,
});

describe("tax summary calculation", () => {
  it("separates output and input tax and calculates the net due in base currency", () => {
    const report = calculateTaxSummary(source([
      invoice({ usage: "OUTPUT", documentType: "SALES_INVOICE" }),
      invoice({ invoiceId: "2", documentId: "102", usage: "INPUT", documentType: "PURCHASE_INVOICE", lines: [line("40.0000", "6.0000")] }),
    ]), { dateFrom: "2026-08-01", dateTo: "2026-08-31" });

    expect(report.filter).toEqual({ status: null, basis: "LEDGER" });
    expect(report.totals).toEqual({
      outputTaxable: "100.0000",
      outputTax: "15.0000",
      inputTaxable: "40.0000",
      inputTax: "6.0000",
      netTaxDue: "9.0000",
      documentCount: 2,
    });
    expect(report.rows.map((row) => row.usage)).toEqual(["OUTPUT", "INPUT"]);
  });

  it("places a reversal on its own date and offsets the original posted effect", () => {
    const reversed = invoice({
      usage: "OUTPUT",
      documentType: "SALES_INVOICE",
      documentStatus: "REVERSED",
      documentDate: "2026-07-30",
      reversalDocument: { id: "201", documentDate: "2026-08-10" },
    });
    const full = calculateTaxSummary(source([reversed]), { dateFrom: "2026-07-01", dateTo: "2026-08-31" });
    expect(full.totals).toMatchObject({ outputTaxable: "0.0000", outputTax: "0.0000", netTaxDue: "0.0000", documentCount: 2 });
    expect(full.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "POSTED", taxableBase: "100.0000", taxBase: "15.0000" }),
      expect.objectContaining({ status: "REVERSED", taxableBase: "-100.0000", taxBase: "-15.0000" }),
    ]));

    const reversalOnly = calculateTaxSummary(source([reversed]), { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    expect(reversalOnly.totals).toMatchObject({ outputTax: "-15.0000", documentCount: 1 });
    expect(reversalOnly.rows).toHaveLength(1);
    expect(reversalOnly.rows[0]).toMatchObject({ status: "REVERSED", documentCount: 1 });
  });

  it("applies credit-note signs, status filters, exchange rates, and four-decimal rounding", () => {
    const report = calculateTaxSummary(source([
      invoice({ usage: "OUTPUT", documentType: "SALES_CREDIT_NOTE", exchangeRate: "1.50000000", lines: [line("10.12345", "1.51852")] }),
      invoice({ invoiceId: "2", documentId: "102", usage: "INPUT", documentType: "PURCHASE_INVOICE", documentStatus: "DRAFT", lines: [line("20.0000", "3.0000")] }),
      invoice({ invoiceId: "3", documentId: "103", usage: "OUTPUT", documentType: "SALES_INVOICE", documentStatus: "CANCELLED", lines: [line("30.0000", "4.5000")] }),
    ]), { dateFrom: "2026-08-01", dateTo: "2026-08-31" });

    expect(report.totals).toMatchObject({ outputTaxable: "-15.1852", outputTax: "-2.2778", inputTax: "0.0000", netTaxDue: "-2.2778", documentCount: 1 });
    const drafts = calculateTaxSummary(source([
      invoice({ invoiceId: "2", documentId: "102", usage: "INPUT", documentType: "PURCHASE_INVOICE", documentStatus: "DRAFT", lines: [line("20.0000", "3.0000")] }),
    ]), { dateFrom: "2026-08-01", dateTo: "2026-08-31", status: "DRAFT" });
    expect(drafts.filter).toEqual({ status: "DRAFT", basis: "STATUS_FILTER" });
    expect(drafts.totals).toMatchObject({ inputTaxable: "20.0000", inputTax: "3.0000", documentCount: 1 });
  });
});
