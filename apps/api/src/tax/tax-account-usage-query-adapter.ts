import type { Prisma } from "@prisma/client";
import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js";

export class TaxAccountUsageQueryAdapter implements AccountUsageQueryPort {
  readonly owner = "TAX" as const;

  async queryAccountUsage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ) {
    const count = await tx.taxRate.count({
      where: {
        companyId,
        OR: [
          { outputTaxAccountId: accountId },
          { inputTaxAccountId: accountId },
        ],
      },
    });

    return [{ category: "TAX_RATE" as const, count, hasImmutableHistory: false }];
  }
}
