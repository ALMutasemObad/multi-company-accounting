import type { Prisma } from "@prisma/client";
import type { AccountUsageQueryPort } from "./account-usage-query-port.js";

export class CoreAccountUsageQueryAdapter implements AccountUsageQueryPort {
  readonly owner = "CORE_ACCOUNTING" as const;

  async queryAccountUsage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ) {
    const childCount = await tx.account.count({
      where: { companyId, parentAccountId: accountId },
    });
    const journalCount = await tx.journalLine.count({
      where: { companyId, accountId },
    });
    const immutableJournalLine = await tx.journalLine.findFirst({
      where: {
        companyId,
        accountId,
        journalEntry: {
          companyId,
          accountingDocument: {
            companyId,
            status: { in: ["POSTED", "REVERSED", "CANCELLED"] },
          },
        },
      },
      select: { id: true },
    });

    return [
      {
        category: "CORE_ACCOUNT_CHILD" as const,
        count: childCount,
        hasImmutableHistory: false,
      },
      {
        category: "CORE_JOURNAL_HISTORY" as const,
        count: journalCount,
        hasImmutableHistory: immutableJournalLine != null,
      },
    ];
  }
}
