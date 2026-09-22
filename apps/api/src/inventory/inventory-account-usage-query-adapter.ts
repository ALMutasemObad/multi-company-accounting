import type { Prisma } from "@prisma/client";
import type { AccountUsageQueryPort } from "../accounts/account-usage-query-port.js";

export class InventoryAccountUsageQueryAdapter implements AccountUsageQueryPort {
  readonly owner = "INVENTORY" as const;

  async queryAccountUsage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ) {
    const count = await tx.inventoryMovement.count({
      where: { companyId, offsetAccountId: accountId },
    });

    return [{
      category: "INVENTORY_MOVEMENT_HISTORY" as const,
      count,
      hasImmutableHistory: count > 0,
    }];
  }
}
