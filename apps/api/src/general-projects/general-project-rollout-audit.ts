import type { PrismaClient } from "@prisma/client";
import {
  configuredStartPlanVersions,
  SubscriptionStartPolicyError,
  validateNewCompanyStartPlan,
} from "../platform-subscriptions/new-company-start-policy.js";

type Catalog = Pick<PrismaClient, "currency" | "platformModule" | "platformPlanVersion">;
type Finding = "CURRENCY_MAP_REQUIRED" | "CURRENCY_NOT_CONFIGURED" | "PLAN_NOT_FOUND"
  | "PLAN_NOT_ELIGIBLE" | "PROJECTS_NOT_INCLUDED" | "HR_NOT_INCLUDED";

/** Read-only release preflight. It never activates a module or changes a published plan. */
export async function auditGeneralProjectRollout(
  catalog: Catalog,
  startPlanVersionId: string | undefined,
  startPlanVersionsByCurrency: string | undefined,
  effectiveAt = new Date(),
) {
  let configuration: ReturnType<typeof configuredStartPlanVersions>;
  try {
    configuration = configuredStartPlanVersions(startPlanVersionId, startPlanVersionsByCurrency);
  } catch (error) {
    if (error instanceof SubscriptionStartPolicyError) {
      return { status: "NOT_READY" as const, configuration: error.reason,
        moduleActive: null, currencies: [] as Array<{ code: string; finding: Finding | null }> };
    }
    throw error;
  }
  const [activeCurrencies, projectModule] = await Promise.all([
    catalog.currency.findMany({ where: { scopeKey: "GLOBAL", isActive: true }, select: { code: true }, orderBy: { code: "asc" } }),
    catalog.platformModule.findUnique({ where: { code: "GENERAL_PROJECTS" }, select: { isActive: true } }),
  ]);
  const moduleActive = projectModule?.isActive === true;
  const activeCodes = new Set(activeCurrencies.map((item) => item.code));
  const configurationStatus = activeCurrencies.length === 0 ? "NO_ACTIVE_CURRENCIES"
    : configuration.kind === "currency-map" && [...configuration.ids.keys()].some((code) => !activeCodes.has(code))
      ? "EXTRA_CURRENCY_CONFIGURED" : "VALID";
  const currencies: Array<{ code: string; finding: Finding | null }> = [];
  for (const currency of activeCurrencies) {
    const code = currency.code;
    if (configuration.kind === "single" && activeCurrencies.length > 1) {
      currencies.push({ code, finding: "CURRENCY_MAP_REQUIRED" });
      continue;
    }
    const id = configuration.kind === "single" ? configuration.id : configuration.ids.get(code);
    if (id === undefined) {
      currencies.push({ code, finding: "CURRENCY_NOT_CONFIGURED" });
      continue;
    }
    const version = await catalog.platformPlanVersion.findUnique({
      where: { id },
      include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
    });
    if (!version) {
      currencies.push({ code, finding: "PLAN_NOT_FOUND" });
      continue;
    }
    try {
      validateNewCompanyStartPlan(version, effectiveAt, code);
    } catch (error) {
      if (!(error instanceof SubscriptionStartPolicyError)) throw error;
      currencies.push({ code, finding: "PLAN_NOT_ELIGIBLE" });
      continue;
    }
    const included = new Set(version.entitlements
      .filter((item) => item.selectionMode === "INCLUDED")
      .map((item) => item.module.code));
    currencies.push({ code, finding: !included.has("HUMAN_RESOURCES") ? "HR_NOT_INCLUDED"
      : !included.has("GENERAL_PROJECTS") ? "PROJECTS_NOT_INCLUDED" : null });
  }
  return {
    status: moduleActive && configurationStatus === "VALID" && currencies.every((item) => item.finding === null)
      ? "READY" as const : "NOT_READY" as const,
    configuration: configurationStatus,
    moduleActive,
    currencies,
  };
}
