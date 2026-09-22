import type { Prisma } from "@prisma/client";
import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js";

const IMMUTABLE_DOCUMENT_STATUSES = ["POSTED", "REVERSED", "CANCELLED"] as const;
const SALES_DOCUMENT_TYPES = ["SALES_INVOICE", "SALES_CREDIT_NOTE"] as const;

export class SalesAccountUsageQueryAdapter implements AccountUsageQueryPort {
  readonly owner = "SALES" as const;

  async queryAccountUsage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ) {
    const customerCount = await tx.customer.count({
      where: { companyId, receivableAccountId: accountId },
    });
    const sellingProfileCount = await tx.salesItemSellingProfile.count({
      where: { companyId, revenueAccountId: accountId },
    });
    const invoiceLineCount = await tx.salesInvoiceLine.count({
      where: { companyId, revenueAccountId: accountId },
    });
    const immutableInvoiceLine = await tx.salesInvoiceLine.findFirst({
      where: {
        companyId,
        revenueAccountId: accountId,
        salesInvoice: {
          companyId,
          accountingDocument: {
            companyId,
            documentType: { in: [...SALES_DOCUMENT_TYPES] },
            status: { in: [...IMMUTABLE_DOCUMENT_STATUSES] },
          },
        },
      },
      select: { id: true },
    });

    return [
      {
        category: "SALES_CUSTOMER" as const,
        count: customerCount,
        hasImmutableHistory: false,
      },
      {
        category: "SALES_SELLING_PROFILE" as const,
        count: sellingProfileCount,
        hasImmutableHistory: false,
      },
      {
        category: "SALES_INVOICE_HISTORY" as const,
        count: invoiceLineCount,
        hasImmutableHistory: immutableInvoiceLine != null,
      },
    ];
  }
}
