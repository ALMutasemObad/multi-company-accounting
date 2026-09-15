import type { Prisma } from "@prisma/client";
import { ModuleDependencyResolutionError, resolveModuleDependencies } from "./platform-module-dependency-resolver.js";

export class SubscriptionStartPolicyError extends Error {
  constructor(public readonly reason: "NOT_CONFIGURED" | "INVALID_CONFIGURATION" | "PLAN_NOT_ELIGIBLE") {
    super(`SUBSCRIPTION_START_POLICY_${reason}`);
  }
}

/** Server configuration only. A browser-selected plan is never an input to this policy. */
export function configuredStartPlanVersionId(value: string | undefined): bigint {
  if (value === undefined || value === "") throw new SubscriptionStartPolicyError("NOT_CONFIGURED");
  if (!/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n) {
    throw new SubscriptionStartPolicyError("INVALID_CONFIGURATION");
  }
  return BigInt(value);
}

export type StartPlanVersion = Prisma.PlatformPlanVersionGetPayload<{
  include: {
    plan: true;
    entitlements: { include: { module: { include: { dependencies: true } } } };
  };
}>;

/** Recheck the immutable version and mutable module/plan availability in the caller's transaction. */
export function validateNewCompanyStartPlan(version: StartPlanVersion | null, effectiveAt: Date, baseCurrencyCode: string) {
  const invalid = (): never => { throw new SubscriptionStartPolicyError("PLAN_NOT_ELIGIBLE"); };
  if (!version || !Number.isFinite(effectiveAt.getTime()) || !version.plan.isActive
    || version.plan.code.startsWith("LEGACY_")
    || !version.publishedAt || version.publishedAt > effectiveAt || version.retiredAt
    || version.effectiveFrom > effectiveAt || version.selfServicePolicy !== "IMMEDIATE_FREE"
    || version.recurringFee === null || !version.recurringFee.eq(0)) return invalid();

  // Missing metered prices invalidate the billing snapshot and can fall back to account pricing.
  // Require explicit zeros; never infer that null means free or enroll in paid metered usage.
  if ([version.pricePerAdditionalUser, version.pricePerAdditionalEmployee, version.pricePerAdditionalPostedDocument]
    .some((fee) => fee === null || !fee.eq(0))) return invalid();
  if ([version.includedUsers, version.includedEmployees, version.includedPostedDocuments]
    .some((limit) => limit === null || !Number.isInteger(limit) || limit < 0 || limit > 4294967295)) return invalid();
  if (!Number.isInteger(version.trialDays) || version.trialDays < 0 || version.trialDays > 65535
    || !/^[A-Z]{3}$/.test(version.currencyCode) || version.currencyCode !== baseCurrencyCode) return invalid();

  // Only INCLUDED modules are provisioned. Optional modules always require a later explicit choice.
  const included = version.entitlements.filter((item) => item.selectionMode === "INCLUDED");
  if (included.some((item) => !item.module.isActive || item.additionalRecurringFee !== null)) return invalid();
  try {
    resolveModuleDependencies(included.map((item) => ({
      id: item.moduleId,
      code: item.module.code,
      isActive: item.module.isActive,
      selectionMode: item.selectionMode,
      dependencies: item.module.dependencies.map((dependency) => ({ id: dependency.dependsOnModuleId })),
    })), { strict: true });
  } catch (error) {
    if (error instanceof ModuleDependencyResolutionError) return invalid();
    throw error;
  }
  // Preserve the established entitlement order in the external provisioning
  // contract; the resolver only determines eligibility and validates closure.
  return { version, modules: included.map((item) => ({ moduleId: item.moduleId, selectionMode: item.selectionMode })) };
}
