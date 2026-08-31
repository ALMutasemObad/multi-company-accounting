import type {
  SubscriptionUsageMeasurementPort, SubscriptionUsageMetric, SubscriptionUsagePlanPort, SubscriptionUsageSnapshot,
} from "./subscription-usage-ports.js";
import { PlatformSubscriptionError } from "./platform-subscription-service.js";

const safeCount = (value: number | null) => value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function subscriptionUsageMetric(
  measured: number | null, quota: number | null,
  comparisonBasis: SubscriptionUsageMetric["comparisonBasis"], definition: SubscriptionUsageMetric["definition"],
): SubscriptionUsageMetric {
  const used = safeCount(measured);
  const included = safeCount(quota);
  const comparable = included !== null && used !== null && comparisonBasis === "CURRENT_SNAPSHOT";
  return {
    used, included, comparisonBasis, definition,
    remaining: comparable ? Math.max(0, included - used) : null,
    excess: comparable ? Math.max(0, used - included) : null,
    state: included === null ? "NOT_CONFIGURED" : !comparable ? "UNKNOWN"
      : used > included ? "EXCEEDED" : used === included ? "AT_LIMIT" : "WITHIN_LIMIT",
  };
}

export class SubscriptionUsageService {
  constructor(
    private readonly measurements: SubscriptionUsageMeasurementPort,
    private readonly plans: SubscriptionUsagePlanPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Caller must authorize subscriptions.view and supply the selected company, never client input. */
  async companyUsage(companyId: bigint): Promise<SubscriptionUsageSnapshot> {
    if (companyId <= 0n) throw new PlatformSubscriptionError("FORBIDDEN");
    const measuredAt = this.now();
    // Billing accepts operator-selected UTC dates; no authoritative quota-cycle resolver exists.
    // This deliberately is NOT a billing period, even when currentPeriodStart/End are populated.
    const periodStart = new Date(Date.UTC(measuredAt.getUTCFullYear(), measuredAt.getUTCMonth(), 1));
    const [usage, plan] = await Promise.all([
      this.measurements.measure({ companyId, periodStart, periodEndExclusive: measuredAt }),
      this.plans.currentPlan(companyId, measuredAt),
    ]);
    if (!usage) throw new PlatformSubscriptionError("NOT_FOUND");
    return {
      companyId: companyId.toString(), measuredAt: measuredAt.toISOString(), consistency: "BEST_EFFORT",
      plan: plan ? { id: plan.id, displayName: plan.displayName, billingCycle: plan.billingCycle } : null,
      period: {
        kind: "STATISTICAL_MONTH_TO_DATE", timezone: "UTC", startsAt: periodStart.toISOString(),
        endsAtExclusive: measuredAt.toISOString(), billingPeriodStatus: plan?.billingPeriodStatus ?? "NOT_CONFIGURED",
      },
      metrics: {
        users: subscriptionUsageMetric(usage.users, plan?.includedUsers ?? null, "CURRENT_SNAPSHOT", "ACTIVE_COMPANY_USERS"),
        employees: subscriptionUsageMetric(usage.employees, plan?.includedEmployees ?? null, "CURRENT_SNAPSHOT", "ACTIVE_OR_ON_LEAVE_EMPLOYEES"),
        postedDocuments: subscriptionUsageMetric(usage.postedDocuments, plan?.includedPostedDocuments ?? null, "UNCONFIRMED_PERIOD", "DOCUMENTS_POSTED_IN_WINDOW"),
      },
    };
  }
}
