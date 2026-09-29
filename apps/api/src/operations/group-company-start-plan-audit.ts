import type { PrismaClient } from "@prisma/client";
import {
  configuredStartPlanVersionId,
  SubscriptionStartPolicyError,
  validateNewCompanyStartPlan,
} from "../platform-subscriptions/new-company-start-policy.js";

export type GroupCompanyStartPlanAuditResult = {
  status: "READY" | "NOT_CONFIGURED" | "INVALID_CONFIGURATION" | "PLAN_NOT_FOUND"
    | "PLAN_NOT_ELIGIBLE" | "PLAN_CURRENCY_NOT_ACTIVE" | "REQUESTED_CURRENCY_INVALID"
    | "REQUESTED_CURRENCY_MISMATCH";
  planCurrency?: string;
  requestedCurrency?: string;
};

type ReadOnlyCatalog = Pick<PrismaClient, "platformPlanVersion" | "currency">;

/** Uses the same eligibility policy as provisioning; only SELECT operations are permitted here. */
export async function auditGroupCompanyStartPlan(
  catalog: ReadOnlyCatalog,
  configuredVersionId: string | undefined,
  requestedCurrency: string | undefined,
  effectiveAt = new Date(),
): Promise<GroupCompanyStartPlanAuditResult> {
  if (requestedCurrency !== undefined && !/^[A-Z]{3}$/.test(requestedCurrency)) {
    return { status: "REQUESTED_CURRENCY_INVALID" };
  }

  let versionId: bigint;
  try {
    versionId = configuredStartPlanVersionId(configuredVersionId);
  } catch (error) {
    if (error instanceof SubscriptionStartPolicyError && error.reason !== "PLAN_NOT_ELIGIBLE") {
      return { status: error.reason };
    }
    throw error;
  }

  const version = await catalog.platformPlanVersion.findUnique({
    where: { id: versionId },
    include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
  });
  if (!version) return { status: "PLAN_NOT_FOUND" };

  const planCurrency = version.currencyCode;
  try {
    validateNewCompanyStartPlan(version, effectiveAt, planCurrency);
  } catch (error) {
    if (error instanceof SubscriptionStartPolicyError && error.reason === "PLAN_NOT_ELIGIBLE") {
      return { status: "PLAN_NOT_ELIGIBLE", planCurrency };
    }
    throw error;
  }

  const currency = await catalog.currency.findUnique({
    where: { scopeKey_code: { scopeKey: "GLOBAL", code: planCurrency } },
    select: { isActive: true },
  });
  if (!currency?.isActive) return { status: "PLAN_CURRENCY_NOT_ACTIVE", planCurrency };
  if (requestedCurrency !== undefined && requestedCurrency !== planCurrency) {
    return { status: "REQUESTED_CURRENCY_MISMATCH", planCurrency, requestedCurrency };
  }
  return { status: "READY", planCurrency, ...(requestedCurrency ? { requestedCurrency } : {}) };
}
