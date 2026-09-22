import type { Prisma } from "@prisma/client";
import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js";

export class ReportingAccountUsageQueryAdapter implements AccountUsageQueryPort {
  readonly owner = "REPORTING" as const;

  async queryAccountUsage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ) {
    const count = await tx.cashFlowAccountMapping.count({ where: { companyId, accountId } });
    return [{
      category: "REPORTING_CASH_FLOW_MAPPING" as const,
      count,
      hasImmutableHistory: false,
    }];
  }
}
