import type { PrismaClient } from "@prisma/client";
import type {
  OrganizationCompanyMetricAccess,
  OrganizationMetricAuthorizationQueryPort,
} from "../organizations/organization-owner-ports.js";
import { isPlatformModuleCode, type PlatformModuleCode } from "./platform-entitlement-ports.js";
import { PLATFORM_FOUNDATION, permissionEntitlement } from "./company-capability-service.js";

const METRIC_PERMISSIONS = {
  activeUsers: "users.view",
  postedDocuments: "dashboard.view",
  postedSales: "sales_invoices.view",
  postedPurchases: "purchase_invoices.view",
} as const;

type EntitledModule = {
  code: string;
  dependencies: Array<{ dependsOnModule: { code: string; isActive: boolean } }>;
};

function dependencyClosedModules(modules: readonly EntitledModule[]): Set<PlatformModuleCode> {
  const canonical = modules.filter(({ code }) => isPlatformModuleCode(code));
  const entitled = new Set(canonical.map(({ code }) => code));
  const dependencyMap = new Map(canonical.map(({ code, dependencies }) => [
    code,
    dependencies.map(({ dependsOnModule }) => dependsOnModule),
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
      && entitled.has(dependency.code)
      && dependencyClosed(dependency.code, nextAncestors),
    );
    resolved.set(code, allowed);
    return allowed;
  };
  return new Set([...entitled].filter((code) => dependencyClosed(code)).filter(isPlatformModuleCode));
}

export class OrganizationOwnerMetricAuthorizationAdapter implements OrganizationMetricAuthorizationQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async metricAccess(userId: bigint, companyIds: readonly bigint[], effectiveAt: Date) {
    if (companyIds.length === 0) return [];
    const ids = [...companyIds];
    const [roleRows, subscriptions] = await Promise.all([
      this.prisma.userCompanyRole.findMany({
        where: {
          userId,
          companyId: { in: ids },
          assignment: { isActive: true, user: { isActive: true }, company: { isActive: true } },
          role: { isActive: true },
        },
        select: {
          companyId: true,
          role: {
            select: {
              permissions: { select: { permission: { select: { code: true } } } },
            },
          },
        },
      }),
      this.prisma.platformSubscription.findMany({
        where: { companyId: { in: ids } },
        select: {
          companyId: true,
          entitlements: {
            where: {
              effectiveFrom: { lte: effectiveAt },
              OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: effectiveAt } }],
              module: { isActive: true },
            },
            select: {
              module: {
                select: {
                  code: true,
                  dependencies: {
                    select: { dependsOnModule: { select: { code: true, isActive: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const permissionsByCompany = new Map<string, Set<string>>();
    for (const row of roleRows) {
      const key = row.companyId.toString();
      const permissions = permissionsByCompany.get(key) ?? new Set<string>();
      for (const { permission } of row.role.permissions) permissions.add(permission.code);
      permissionsByCompany.set(key, permissions);
    }
    const modulesByCompany = new Map(subscriptions.map(({ companyId, entitlements }) => [
      companyId.toString(),
      dependencyClosedModules(entitlements.map(({ module }) => module)),
    ]));
    const allowed = (companyId: bigint, permission: string) => {
      if (!permissionsByCompany.get(companyId.toString())?.has(permission)) return false;
      const required = permissionEntitlement(permission);
      return required === PLATFORM_FOUNDATION
        || (required !== null && modulesByCompany.get(companyId.toString())?.has(required) === true);
    };

    return companyIds.map((companyId): OrganizationCompanyMetricAccess => ({
      companyId,
      activeUsers: allowed(companyId, METRIC_PERMISSIONS.activeUsers),
      postedDocuments: allowed(companyId, METRIC_PERMISSIONS.postedDocuments),
      postedSales: allowed(companyId, METRIC_PERMISSIONS.postedSales),
      postedPurchases: allowed(companyId, METRIC_PERMISSIONS.postedPurchases),
    }));
  }
}
