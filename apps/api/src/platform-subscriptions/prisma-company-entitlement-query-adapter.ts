import type { PrismaClient } from "@prisma/client";
import {
  isPlatformModuleCode,
  type CompanyEntitlementQueryPort,
  type CompanyEntitlementSnapshot,
} from "./platform-entitlement-ports.js";
import { resolveModuleDependencies } from "./platform-module-dependency-resolver.js";

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
        changes: {
          where: { state: "APPROVED", effectiveAt: { lte: effectiveAt } },
          orderBy: [{ effectiveAt: "desc" as const }, { id: "desc" as const }],
          take: 1,
          select: {
            targetPlanVersion: {
              select: {
                versionNumber: true,
                displayName: true,
                plan: { select: { code: true } },
              },
            },
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
                id: true,
                code: true,
                isActive: true,
                dependencies: {
                  select: {
                    dependsOnModule: { select: { id: true, code: true, isActive: true } },
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
    const resolution = resolveModuleDependencies(canonicalModules.map(({ module }) => ({
      // Older fixtures/adapters may omit the id; code remains a deterministic
      // projection key while the Prisma selection uses the real id in runtime.
      id: module.id ?? module.code,
      code: module.code,
      // The entitlement query already filters active modules; retain that
      // invariant for older test doubles that omit the selected flag.
      isActive: module.isActive ?? true,
      dependencies: module.dependencies.map(({ dependsOnModule }) => ({
        id: dependsOnModule.id,
        code: dependsOnModule.code,
        isActive: dependsOnModule.isActive,
      })),
    })), { strict: false, deduplicate: true });
    const moduleCodes = [...new Set(resolution.valid.map((module) => module.code))]
      .filter(isPlatformModuleCode)
      .sort();

    const effectivePlan = subscription.changes?.[0]?.targetPlanVersion ?? subscription.planVersion;
    return {
      subscriptionId: subscription.id,
      companyId: subscription.companyId,
      status: subscription.status,
      version: subscription.version,
      plan: {
        code: effectivePlan.plan.code,
        versionNumber: effectivePlan.versionNumber,
        displayName: effectivePlan.displayName,
      },
      moduleCodes,
    };
  }
}
