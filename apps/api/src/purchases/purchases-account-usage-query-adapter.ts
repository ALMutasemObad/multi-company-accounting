import type { Prisma } from "@prisma/client";
import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js";

const IMMUTABLE_DOCUMENT_STATUSES = ["POSTED", "REVERSED", "CANCELLED"] as const;
const PURCHASE_DOCUMENT_TYPES = ["PURCHASE_INVOICE", "PURCHASE_DEBIT_NOTE"] as const;

export class PurchasesAccountUsageQueryAdapter implements AccountUsageQueryPort {
  readonly owner = "PURCHASES" as const;

  async queryAccountUsage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ) {
    const supplierCount = await tx.supplier.count({
      where: { companyId, payableAccountId: accountId },
    });
    const invoiceLineCount = await tx.purchaseInvoiceLine.count({
      where: { companyId, debitAccountId: accountId },
    });
    const immutableInvoiceLine = await tx.purchaseInvoiceLine.findFirst({
      where: {
        companyId,
        debitAccountId: accountId,
        purchaseInvoice: {
          companyId,
          accountingDocument: {
            companyId,
            documentType: { in: [...PURCHASE_DOCUMENT_TYPES] },
            status: { in: [...IMMUTABLE_DOCUMENT_STATUSES] },
          },
        },
      },
      select: { id: true },
    });

    return [
      {
        category: "PURCHASES_SUPPLIER" as const,
        count: supplierCount,
        hasImmutableHistory: false,
      },
      {
        category: "PURCHASES_INVOICE_HISTORY" as const,
        count: invoiceLineCount,
        hasImmutableHistory: immutableInvoiceLine != null,
      },
    ];
  }
}
