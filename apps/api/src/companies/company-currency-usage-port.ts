import type { Prisma } from "@prisma/client";

export interface CompanyCurrencyUsageQueryPort {
  isAnyCurrencyUsed(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    currencyIds: readonly bigint[],
  ): Promise<boolean>;
}
