import type { Prisma } from "@prisma/client";

export interface PlatformSubscriptionPaymentEvidencePort {
  hasSettledPayment(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      subscriptionChangeId: bigint;
      amount: Prisma.Decimal;
      currencyCode: string;
    },
  ): Promise<boolean>;
}
