import type { Prisma } from "@prisma/client";
import type {
  SettlementFinancialCloseReadinessPort,
  SettlementFinancialCloseSummary,
} from "../fiscal/financial-close-types.js";

type CountRow = { invalid_count: bigint };

export class SettlementFinancialCloseReadinessAdapter implements SettlementFinancialCloseReadinessPort {
  async summarizeForClose(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; asOf: Date },
  ): Promise<SettlementFinancialCloseSummary> {
    const [receivables, payables] = await Promise.all([
      tx.$queryRaw<CountRow[]>`
        SELECT COUNT(*) AS invalid_count
        FROM receivable_items item
        JOIN sales_invoices invoice ON invoice.id=item.sales_invoice_id AND invoice.company_id=item.company_id
        JOIN accounting_documents document ON document.id=invoice.accounting_document_id AND document.company_id=invoice.company_id
        LEFT JOIN journal_lines line ON line.id=invoice.ar_journal_line_id AND line.company_id=invoice.company_id
        WHERE item.company_id=${input.companyId}
          AND document.document_date <= ${input.asOf}
          AND document.status='POSTED'
          AND (
            line.id IS NULL
            OR ABS((line.base_debit_amount-line.base_credit_amount)-item.original_base_amount) > 0.00005
            OR item.original_amount <= 0 OR item.original_base_amount <= 0
            OR item.outstanding_amount < 0 OR item.outstanding_base_amount < 0
            OR item.outstanding_amount > item.original_amount OR item.outstanding_base_amount > item.original_base_amount
            OR (item.status IN ('SETTLED','REVERSED') AND (item.outstanding_amount <> 0 OR item.outstanding_base_amount <> 0))
            OR (item.status='OPEN' AND (item.outstanding_amount <> item.original_amount OR item.outstanding_base_amount <> item.original_base_amount))
            OR (item.status='PARTIAL' AND (item.outstanding_amount <= 0 OR item.outstanding_amount >= item.original_amount))
          )`,
      tx.$queryRaw<CountRow[]>`
        SELECT COUNT(*) AS invalid_count
        FROM payable_items item
        JOIN purchase_invoices invoice ON invoice.id=item.purchase_invoice_id AND invoice.company_id=item.company_id
        JOIN accounting_documents document ON document.id=invoice.accounting_document_id AND document.company_id=invoice.company_id
        LEFT JOIN journal_lines line ON line.id=invoice.ap_journal_line_id AND line.company_id=invoice.company_id
        WHERE item.company_id=${input.companyId}
          AND document.document_date <= ${input.asOf}
          AND document.status='POSTED'
          AND (
            line.id IS NULL
            OR ABS((line.base_credit_amount-line.base_debit_amount)-item.original_base_amount) > 0.00005
            OR item.original_amount <= 0 OR item.original_base_amount <= 0
            OR item.outstanding_amount < 0 OR item.outstanding_base_amount < 0
            OR item.outstanding_amount > item.original_amount OR item.outstanding_base_amount > item.original_base_amount
            OR (item.status IN ('SETTLED','REVERSED') AND (item.outstanding_amount <> 0 OR item.outstanding_base_amount <> 0))
            OR (item.status='OPEN' AND (item.outstanding_amount <> item.original_amount OR item.outstanding_base_amount <> item.original_base_amount))
            OR (item.status='PARTIAL' AND (item.outstanding_amount <= 0 OR item.outstanding_amount >= item.original_amount))
          )`,
    ]);
    return {
      invalidReceivables: Number(receivables[0]?.invalid_count ?? 0),
      invalidPayables: Number(payables[0]?.invalid_count ?? 0),
    };
  }
}
