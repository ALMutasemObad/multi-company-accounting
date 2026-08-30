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
          select: {
            module: {
              select: {
                code: true,
                dependencies: {
                  select: {
                    dependsOnModule: { select: { code: true, isActive: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!subscription) return null;

    const canonicalModules = subscription.entitlements.filter(({ module }) =>
      isPlatformModuleCode(module.code),
    );
    const entitledCodes = new Set(canonicalModules.map(({ module }) => module.code));
    const dependencyMap = new Map(canonicalModules.map(({ module }) => [
      module.code,
      module.dependencies.map(({ dependsOnModule }) => dependsOnModule),
    ]));
    const resolved = new Map<string, boolean>();
    const dependencyClosed = (code: string, ancestors = new Set<string>()): boolean => {
      const cached = resolved.get(code);
      if (cached !== undefined) return cached;
      if (ancestors.has(code)) return false;
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(code);
      const allowed = (dependencyMap.get(code) ?? []).every((dependency) =>
        dependency.isActive
        && isPlatformModuleCode(dependency.code)
        && entitledCodes.has(dependency.code)
        && dependencyClosed(dependency.code, nextAncestors),
      );
      resolved.set(code, allowed);
      return allowed;
    };
    const moduleCodes = [...entitledCodes]
      .filter((code) => dependencyClosed(code))
      .filter(isPlatformModuleCode)
      .sort();

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
      moduleCodes,
    };
  }
}
