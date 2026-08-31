/** Read contracts only: no pricing, person records, persistence commands or cross-context Prisma types. */
export interface SubscriptionUsageMeasurementPort {
  measure(input: { companyId: bigint; periodStart: Date; periodEndExclusive: Date }): Promise<{
    users: number | null;
    employees: number | null;
    postedDocuments: number | null;
  } | null>;
}

export type SubscriptionUsagePlan = {
  id: string;
  displayName: string;
  billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  includedUsers: number | null;
  includedEmployees: number | null;
  includedPostedDocuments: number | null;
  billingPeriodStatus: "NOT_CONFIGURED" | "UNCONFIRMED";
};

export interface SubscriptionUsagePlanPort {
  currentPlan(companyId: bigint, asOf: Date): Promise<SubscriptionUsagePlan | null>;
}

export type SubscriptionUsageMetric = {
  used: number | null;
  included: number | null;
  remaining: number | null;
  excess: number | null;
  state: "WITHIN_LIMIT" | "AT_LIMIT" | "EXCEEDED" | "NOT_CONFIGURED" | "UNKNOWN";
  comparisonBasis: "CURRENT_SNAPSHOT" | "UNCONFIRMED_PERIOD";
  definition: "ACTIVE_COMPANY_USERS" | "ACTIVE_OR_ON_LEAVE_EMPLOYEES" | "DOCUMENTS_POSTED_IN_WINDOW";
};

export type SubscriptionUsageSnapshot = {
  companyId: string;
  measuredAt: string;
  consistency: "BEST_EFFORT";
  plan: Pick<SubscriptionUsagePlan, "id" | "displayName" | "billingCycle"> | null;
  period: {
    kind: "STATISTICAL_MONTH_TO_DATE";
    timezone: "UTC";
    startsAt: string;
    endsAtExclusive: string;
    billingPeriodStatus: "NOT_CONFIGURED" | "UNCONFIRMED";
  };
  metrics: { users: SubscriptionUsageMetric; employees: SubscriptionUsageMetric; postedDocuments: SubscriptionUsageMetric };
};
