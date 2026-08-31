import { Prisma, type PrismaClient } from "@prisma/client";

export const PUBLIC_PLAN_PAGE_SIZE = 9;
export const PUBLIC_PLAN_MAX_PAGE = 1000;

export function publicPlanWhere(now: Date): Prisma.PlatformPlanVersionWhereInput {
  return {
    publiclyListed: true,
    publishedAt: { not: null }, retiredAt: null, effectiveFrom: { lte: now },
    selfServicePolicy: { not: "DISABLED" }, recurringFee: { not: null },
    includedUsers: { not: null }, includedEmployees: { not: null },
    includedPostedDocuments: { not: null },
    plan: { isActive: true, code: { not: { startsWith: "LEGACY_COMPANY_" } } },
    entitlements: { none: { module: { isActive: false } } },
  };
}

// Explicit public projection: never serialize an operator DTO or tenant data here.
const publicPlanSelect = {
  id: true, displayName: true, description: true, billingCycle: true,
  currencyCode: true, recurringFee: true, includedUsers: true,
  includedEmployees: true, includedPostedDocuments: true,
  pricePerAdditionalUser: true, pricePerAdditionalEmployee: true,
  pricePerAdditionalPostedDocument: true, trialDays: true, taxRate: true,
  selfServicePolicy: true,
  entitlements: {
    take: 100,
    orderBy: { moduleId: "asc" },
    select: {
      selectionMode: true, additionalRecurringFee: true,
      module: { select: { code: true, displayName: true } },
    },
  },
} satisfies Prisma.PlatformPlanVersionSelect;

export async function readPublicPlanCatalog(prisma: PrismaClient, page: number, now: Date) {
  if (!Number.isSafeInteger(page) || page < 1 || page > PUBLIC_PLAN_MAX_PAGE) {
    throw new RangeError("Invalid public catalog page");
  }
  const where = publicPlanWhere(now);
  const [total, versions] = await Promise.all([
    prisma.platformPlanVersion.count({ where }),
    prisma.platformPlanVersion.findMany({
      where, select: publicPlanSelect,
      orderBy: [{ planId: "asc" }, { versionNumber: "desc" }, { id: "desc" }],
      skip: (page - 1) * PUBLIC_PLAN_PAGE_SIZE, take: PUBLIC_PLAN_PAGE_SIZE,
    }),
  ]);
  const money = (value: Prisma.Decimal | null) => value?.toFixed(4) ?? null;
  return {
    plans: versions.map((version) => ({
      id: version.id.toString(), displayName: version.displayName,
      description: version.description, billingCycle: version.billingCycle,
      currencyCode: version.currencyCode, recurringFee: version.recurringFee!.toFixed(4),
      includedUsers: version.includedUsers!, includedEmployees: version.includedEmployees!,
      includedPostedDocuments: version.includedPostedDocuments!,
      pricePerAdditionalUser: money(version.pricePerAdditionalUser),
      pricePerAdditionalEmployee: money(version.pricePerAdditionalEmployee),
      pricePerAdditionalPostedDocument: money(version.pricePerAdditionalPostedDocument),
      trialDays: version.trialDays, taxRate: version.taxRate.toFixed(4),
      requiresApproval: version.selfServicePolicy === "REQUEST_ONLY",
      modules: version.entitlements.map((item) => ({
        code: item.module.code, displayName: item.module.displayName,
        selectionMode: item.selectionMode, additionalRecurringFee: money(item.additionalRecurringFee),
      })),
    })),
    meta: { page, pageSize: PUBLIC_PLAN_PAGE_SIZE, total, totalPages: Math.ceil(total / PUBLIC_PLAN_PAGE_SIZE) },
  };
}
