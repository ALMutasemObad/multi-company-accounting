import type { Prisma } from "@prisma/client";

export type PlatformBillingSubscriptionSnapshot = {
  subscriptionId: bigint;
  planVersionId: bigint;
  subscriptionChangeId: bigint | null;
  planDisplayName: string;
  currencyCode: string;
  recurringFee: Prisma.Decimal;
  includedUsers: number;
  pricePerAdditionalUser: Prisma.Decimal;
  includedEmployees: number;
  pricePerAdditionalEmployee: Prisma.Decimal;
  includedPostedDocuments: number;
  pricePerAdditionalPostedDocument: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  paymentTermsDays: number;
};

export interface PlatformBillingSubscriptionSnapshotPort {
  resolve(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      subscriptionChangePublicId?: string | null | undefined;
      asOf: Date;
    },
  ): Promise<PlatformBillingSubscriptionSnapshot | null>;
}
