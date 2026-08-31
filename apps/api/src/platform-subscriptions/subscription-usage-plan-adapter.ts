import type { PrismaClient } from "@prisma/client";
import type { SubscriptionUsagePlanPort } from "./subscription-usage-ports.js";
import { assertRequestActive } from "../operations/request-context.js";

const planSelection = {
  id: true, displayName: true, billingCycle: true,
  includedUsers: true, includedEmployees: true, includedPostedDocuments: true,
} as const;

/** Subscription-owned projection. Same effective-change ordering as lifecycle and billing snapshots. */
export class SubscriptionUsagePlanAdapter implements SubscriptionUsagePlanPort {
  constructor(private readonly prisma: PrismaClient) {}

  async currentPlan(companyId: bigint, asOf: Date) {
    assertRequestActive("SUBSCRIPTION_USAGE_PLAN_READ");
    const subscription = await this.prisma.platformSubscription.findUnique({
      where: { companyId },
      select: { id: true, currentPeriodStart: true, currentPeriodEnd: true, planVersion: { select: planSelection } },
    });
    assertRequestActive("SUBSCRIPTION_USAGE_PLAN_READ");
    if (!subscription) return null;
    const effective = await this.prisma.platformSubscriptionChange.findFirst({
      where: { companyId, subscriptionId: subscription.id, state: "APPROVED", effectiveAt: { lte: asOf } },
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
      select: { targetPlanVersion: { select: planSelection } },
    });
    const plan = effective?.targetPlanVersion ?? subscription.planVersion;
    return {
      ...plan, id: plan.id.toString(),
      billingPeriodStatus: subscription.currentPeriodStart || subscription.currentPeriodEnd
        ? "UNCONFIRMED" as const : "NOT_CONFIGURED" as const,
    };
  }
}
