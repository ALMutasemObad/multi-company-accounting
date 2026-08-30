import { Prisma } from "@prisma/client";
import type {
  PlatformBillingSubscriptionSnapshot,
  PlatformBillingSubscriptionSnapshotPort,
} from "./platform-billing-subscription-snapshot-port.js";

const zero = () => new Prisma.Decimal(0);

export class PrismaPlatformBillingSubscriptionSnapshotAdapter implements PlatformBillingSubscriptionSnapshotPort {
  async resolve(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; subscriptionChangePublicId?: string | null | undefined; asOf: Date },
  ): Promise<PlatformBillingSubscriptionSnapshot | null> {
    const subscription = await tx.platformSubscription.findUnique({
      where: { companyId: input.companyId },
      select: { id: true, planVersionId: true },
    });
    if (!subscription) return null;

    const requestedChange = input.subscriptionChangePublicId
      ? await tx.platformSubscriptionChange.findFirst({
        where: {
          publicId: input.subscriptionChangePublicId,
          companyId: input.companyId,
          subscriptionId: subscription.id,
          source: "COMPANY_OWNER",
          state: "PENDING_APPROVAL",
        },
        include: { targetPlanVersion: { include: { plan: true } } },
      })
      : null;
    if (input.subscriptionChangePublicId && !requestedChange) return null;

    const effectiveChange = requestedChange ? null : await tx.platformSubscriptionChange.findFirst({
      where: { companyId: input.companyId, subscriptionId: subscription.id, state: "APPROVED", effectiveAt: { lte: input.asOf } },
      select: { targetPlanVersionId: true, totalRecurringFee: true },
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
    });
    const planVersionId = requestedChange?.targetPlanVersionId
      ?? effectiveChange?.targetPlanVersionId
      ?? subscription.planVersionId;
    const version = requestedChange?.targetPlanVersion ?? await tx.platformPlanVersion.findUnique({
      where: { id: planVersionId },
      include: { plan: true },
    });
    if (!version || version.publishedAt === null) return null;

    const requiredPricing = [
      version.recurringFee,
      version.includedUsers,
      version.pricePerAdditionalUser,
      version.includedEmployees,
      version.pricePerAdditionalEmployee,
      version.includedPostedDocuments,
      version.pricePerAdditionalPostedDocument,
    ];
    if (requiredPricing.some((value) => value === null)) return null;

    return {
      subscriptionId: subscription.id,
      planVersionId: version.id,
      subscriptionChangeId: requestedChange?.id ?? null,
      planDisplayName: version.displayName,
      currencyCode: version.currencyCode,
      recurringFee: requestedChange?.totalRecurringFee ?? effectiveChange?.totalRecurringFee ?? version.recurringFee ?? zero(),
      includedUsers: version.includedUsers!,
      pricePerAdditionalUser: version.pricePerAdditionalUser!,
      includedEmployees: version.includedEmployees!,
      pricePerAdditionalEmployee: version.pricePerAdditionalEmployee!,
      includedPostedDocuments: version.includedPostedDocuments!,
      pricePerAdditionalPostedDocument: version.pricePerAdditionalPostedDocument!,
      taxRate: version.taxRate,
      paymentTermsDays: version.paymentTermsDays,
    };
  }
}
