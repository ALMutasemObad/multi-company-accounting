import type { Prisma } from "@prisma/client";
import type {
  PlatformSubscriptionCompanyProvisioningInput,
  PlatformSubscriptionGrandfatheringPort,
} from "./platform-entitlement-ports.js";

export class PrismaCompanySubscriptionProvisioningAdapter implements PlatformSubscriptionGrandfatheringPort {
  async provisionGrandfatheredAccess(
    tx: Prisma.TransactionClient,
    input: PlatformSubscriptionCompanyProvisioningInput,
  ) {
    const existing = await tx.platformSubscription.findUnique({
      where: { companyId: input.companyId },
      select: { id: true },
    });
    if (existing) return;

    const plan = await tx.platformPlan.create({
      data: { code: `LEGACY_COMPANY_${input.companyId}` },
      select: { id: true },
    });
    const planVersion = await tx.platformPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        displayName: "Legacy full access",
        description: "Grandfathered from access that existed before self-service subscriptions",
        billingCycle: "MONTHLY",
        currencyCode: input.baseCurrencyCode,
        recurringFee: "0",
        effectiveFrom: input.effectiveFrom,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    const modules = await tx.platformModule.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { code: "asc" },
    });
    await tx.platformPlanEntitlement.createMany({
      data: modules.map(({ id }) => ({ planVersionId: planVersion.id, moduleId: id })),
      skipDuplicates: true,
    });
    const subscription = await tx.platformSubscription.create({
      data: {
        companyId: input.companyId,
        planVersionId: planVersion.id,
        status: "ACTIVE",
        startsAt: input.effectiveFrom,
      },
      select: { id: true },
    });
    await tx.platformSubscriptionEntitlement.createMany({
      data: modules.map(({ id }) => ({
        companyId: input.companyId,
        subscriptionId: subscription.id,
        moduleId: id,
        source: "GRANDFATHERED",
        effectiveFrom: input.effectiveFrom,
        reason: "Preserve full access for companies provisioned before self-service plan selection",
      })),
    });
    const lifecycleChange = await tx.platformSubscriptionChange.create({
      data: {
        companyId: input.companyId,
        subscriptionId: subscription.id,
        targetPlanVersionId: planVersion.id,
        state: "APPROVED",
        source: "MIGRATION",
        requestedSubscriptionVersion: 0,
        requestedAt: input.effectiveFrom,
        effectiveAt: input.effectiveFrom,
        decidedAt: input.effectiveFrom,
        decisionReason: "Grandfather access provisioned before self-service plan selection",
        currencyCode: input.baseCurrencyCode,
        baseRecurringFee: "0",
        optionalRecurringFee: "0",
        totalRecurringFee: "0",
      },
      select: { id: true },
    });
    await tx.platformSubscriptionChangeModule.createMany({
      data: modules.map(({ id }) => ({
        changeId: lifecycleChange.id,
        moduleId: id,
        selectionMode: "INCLUDED",
      })),
    });
  }
}
