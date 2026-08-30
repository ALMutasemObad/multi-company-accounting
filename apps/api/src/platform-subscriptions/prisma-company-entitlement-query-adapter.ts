import type { PrismaClient } from "@prisma/client";
import {
  isPlatformModuleCode,
  type CompanyEntitlementQueryPort,
  type CompanyEntitlementSnapshot,
} from "./platform-entitlement-ports.js";

export class PrismaCompanyEntitlementQueryAdapter implements CompanyEntitlementQueryPort {
  constructor(private readonly prisma: Pick<PrismaClient, "platformSubscription">) {}

  async findCompanyEntitlements(
    companyId: bigint,
    effectiveAt = new Date(),
  ): Promise<CompanyEntitlementSnapshot | null> {
    const subscription = await this.prisma.platformSubscription.findUnique({
      where: { companyId },
      select: {
        id: true,
        companyId: true,
        status: true,
        version: true,
        planVersion: {
          select: {
            versionNumber: true,
            displayName: true,
            plan: { select: { code: true } },
          },
        },
        entitlements: {
          where: {
            effectiveFrom: { lte: effectiveAt },
            OR: [
              { effectiveUntil: null },
              { effectiveUntil: { gt: effectiveAt } },
            ],
            module: { isActive: true },
          },
          orderBy: { module: { code: "asc" } },
          select: { module: { select: { code: true } } },
        },
      },
    });
    if (!subscription) return null;

    const moduleCodes = subscription.entitlements
      .map(({ module }) => module.code)
      .filter(isPlatformModuleCode);

    return {
      subscriptionId: subscription.id,
      companyId: subscription.companyId,
      status: subscription.status,
      version: subscription.version,
      plan: {
        code: subscription.planVersion.plan.code,
        versionNumber: subscription.planVersion.versionNumber,
        displayName: subscription.planVersion.displayName,
      },
      moduleCodes: [...new Set(moduleCodes)],
    };
  }
}
