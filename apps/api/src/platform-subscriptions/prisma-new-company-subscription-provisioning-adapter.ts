import type { Prisma } from "@prisma/client";
import type {
  PlatformSubscriptionCompanyProvisioningInput,
  PlatformSubscriptionCompanyProvisioningPort,
} from "./platform-entitlement-ports.js";
import { configuredStartPlanVersionId, validateNewCompanyStartPlan } from "./new-company-start-policy.js";

/** Operational onboarding only; the caller owns the serializable provisioning transaction and retries. */
export class PrismaNewCompanySubscriptionProvisioningAdapter implements PlatformSubscriptionCompanyProvisioningPort {
  constructor(private readonly configuredVersionId?: string) {}

  async provisionNewCompanyAccess(tx: Prisma.TransactionClient, input: PlatformSubscriptionCompanyProvisioningInput) {
    const existing = await tx.platformSubscription.findUnique({
      where: { companyId: input.companyId }, select: { id: true },
    });
    // Replays and historical subscriptions never change, even if the current start policy is unavailable.
    if (existing) return;
    const targetPlanVersionId = configuredStartPlanVersionId(this.configuredVersionId);
    const plan = await tx.platformPlanVersion.findUnique({
      where: { id: targetPlanVersionId },
      include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
    });
    const { version, modules } = validateNewCompanyStartPlan(plan, input.effectiveFrom, input.baseCurrencyCode);
    const trialEndsAt = version.trialDays > 0
      ? new Date(input.effectiveFrom.getTime() + version.trialDays * 86_400_000) : null;
    const subscription = await tx.platformSubscription.create({
      data: {
        companyId: input.companyId, planVersionId: version.id,
        status: trialEndsAt ? "TRIALING" : "ACTIVE", startsAt: input.effectiveFrom, trialEndsAt,
      },
      select: { id: true },
    });
    if (modules.length) await tx.platformSubscriptionEntitlement.createMany({
      data: modules.map(({ moduleId }) => ({
        companyId: input.companyId, subscriptionId: subscription.id, moduleId,
        source: "PLAN", effectiveFrom: input.effectiveFrom,
        reason: "Server-configured new-company start policy",
      })),
    });
    await tx.platformSubscriptionChange.create({
      data: {
        companyId: input.companyId, subscriptionId: subscription.id, targetPlanVersionId: version.id,
        state: "APPROVED", source: "PLATFORM_OPERATOR", requestedSubscriptionVersion: 0,
        requestedAt: input.effectiveFrom, effectiveAt: input.effectiveFrom, decidedAt: input.effectiveFrom,
        // Operator-managed server configuration, not an individual operator or an owner plan-selection action.
        decisionReason: "Server-configured new-company start policy",
        currencyCode: version.currencyCode, baseRecurringFee: version.recurringFee!,
        optionalRecurringFee: "0", totalRecurringFee: version.recurringFee!,
        ...(modules.length ? { modules: { create: modules } } : {}),
      },
    });
  }
}
