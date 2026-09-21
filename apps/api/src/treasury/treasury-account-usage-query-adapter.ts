import type { Prisma } from "@prisma/client";
import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js";

const finalDocumentStatuses = ["POSTED", "REVERSED", "CANCELLED"] as const;

export class TreasuryAccountUsageQueryAdapter implements AccountUsageQueryPort {
  readonly owner = "TREASURY" as const;

  async queryAccountUsage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ) {
    const cashBankAccountCount = await tx.cashBankAccount.count({
      where: { companyId, ledgerAccountId: accountId },
    });
    const receiptWhere = {
      companyId,
      counterAccountId: accountId,
      accountingDocument: { companyId, documentType: "RECEIPT" as const },
    };
    const paymentWhere = {
      companyId,
      counterAccountId: accountId,
      accountingDocument: { companyId, documentType: "PAYMENT" as const },
    };
    const receiptCount = await tx.receipt.count({ where: receiptWhere });
    const paymentCount = await tx.payment.count({ where: paymentWhere });
    const immutableReceipt = await tx.receipt.findFirst({
      where: {
        ...receiptWhere,
        accountingDocument: {
          ...receiptWhere.accountingDocument,
          status: { in: [...finalDocumentStatuses] },
        },
      },
      select: { id: true },
    });
    const immutablePayment = await tx.payment.findFirst({
      where: {
        ...paymentWhere,
        accountingDocument: {
          ...paymentWhere.accountingDocument,
          status: { in: [...finalDocumentStatuses] },
        },
      },
      select: { id: true },
    });

    return [
      {
        category: "TREASURY_CASH_BANK_ACCOUNT" as const,
        count: cashBankAccountCount,
        hasImmutableHistory: false,
      },
      {
        category: "TREASURY_DOCUMENT_HISTORY" as const,
        count: receiptCount + paymentCount,
        hasImmutableHistory: immutableReceipt !== null || immutablePayment !== null,
      },
    ];
  }
}
