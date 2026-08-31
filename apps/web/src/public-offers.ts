import type { PublicSubscriptionPlan } from "./public-plans";
import type { SubscriptionPlanVersion } from "./types";

// Display only: no money arithmetic or change to the cross-track intent contract.
export function publicOfferDecimal(value: string) {
  return value.includes(".") ? value.replace(/0+$/u, "").replace(/\.$/u, "") : value;
}

export function comparedModuleCodes(plans: PublicSubscriptionPlan[]) {
  return [...new Set(plans.flatMap((plan) => plan.modules.map((module) => module.code)))];
}

// Advisory checks against the loaded operator snapshot, never an authorization
// decision. The versioned server command rechecks eligibility at submission.
export function publicOfferReadiness(plan: { active: boolean; code: string }, version: SubscriptionPlanVersion, now: number) {
  const byId = new Map(version.modules.map((module) => [module.id, module]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const validModule = (id: string): boolean => {
    if (visited.has(id)) return true;
    const module = byId.get(id);
    if (!module?.active || visiting.has(id)) return false;
    visiting.add(id);
    const valid = module.dependencyIds.every((dependencyId) =>
      (module.selectionMode !== "INCLUDED" || byId.get(dependencyId)?.selectionMode === "INCLUDED") && validModule(dependencyId));
    visiting.delete(id);
    if (valid) visited.add(id);
    return valid;
  };
  return [
    { key: "active", passed: plan.active && !plan.code.startsWith("LEGACY_COMPANY_") },
    { key: "published", passed: version.publicationStatus === "PUBLISHED" && !!version.publishedAt },
    { key: "effective", passed: Number.isFinite(Date.parse(version.effectiveFrom)) && Date.parse(version.effectiveFrom) <= now && !version.retiredAt },
    { key: "selfService", passed: version.selfServicePolicy !== "DISABLED" },
    { key: "complete", passed: version.recurringFee !== null && version.includedUsers !== null && version.includedEmployees !== null && version.includedPostedDocuments !== null },
    { key: "modules", passed: byId.size === version.modules.length && version.modules.every((module) => validModule(module.id)
      && (module.selectionMode === "INCLUDED" ? module.additionalRecurringFee === null
        : module.additionalRecurringFee !== null && /^[0-9]+(?:\.[0-9]+)?$/u.test(module.additionalRecurringFee))) },
  ] as const;
}
