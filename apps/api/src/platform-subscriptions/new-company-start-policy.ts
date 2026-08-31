import type { Prisma } from "@prisma/client";
import { isPlatformModuleCode } from "./platform-entitlement-ports.js";

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
  const edges = new Map(included.map((item) => [item.moduleId.toString(),
    item.module.dependencies.map((dependency) => dependency.dependsOnModuleId.toString()),
  ]));
  if (edges.size !== included.length || included.some((item) => !item.module.isActive
    || !isPlatformModuleCode(item.module.code) || item.additionalRecurringFee !== null)) return invalid();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (!edges.has(id) || visiting.has(id)) return invalid();
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of edges.get(id)!) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of edges.keys()) visit(id);
  return { version, modules: included.map((item) => ({ moduleId: item.moduleId, selectionMode: item.selectionMode })) };
}
