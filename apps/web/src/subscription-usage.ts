import { api, ApiError } from "./api";

export type SubscriptionUsageMetric = {
  used: number | null; included: number | null; remaining: number | null; excess: number | null;
  state: "WITHIN_LIMIT" | "AT_LIMIT" | "EXCEEDED" | "NOT_CONFIGURED" | "UNKNOWN";
  comparisonBasis: "CURRENT_SNAPSHOT" | "UNCONFIRMED_PERIOD";
  definition: "ACTIVE_COMPANY_USERS" | "ACTIVE_OR_ON_LEAVE_EMPLOYEES" | "DOCUMENTS_POSTED_IN_WINDOW";
};
export type SubscriptionUsage = {
  companyId: string; measuredAt: string; consistency: "BEST_EFFORT";
  plan: { id: string; displayName: string; billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL" } | null;
  period: {
    kind: "STATISTICAL_MONTH_TO_DATE"; timezone: "UTC"; startsAt: string; endsAtExclusive: string;
    billingPeriodStatus: "NOT_CONFIGURED" | "UNCONFIRMED";
  };
  metrics: { users: SubscriptionUsageMetric; employees: SubscriptionUsageMetric; postedDocuments: SubscriptionUsageMetric };
};

export const SUBSCRIPTION_USAGE_TIMEOUT_MS = 12_000;
export class SubscriptionUsageTimeout extends Error {}

/** Scoped, abortable read. No automatic retry, storage, or financial side effects. */
export async function loadSubscriptionUsage(companyId: string, signal: AbortSignal): Promise<SubscriptionUsage> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      api<SubscriptionUsage>("/subscription/usage", { signal: controller.signal, cache: "no-store" }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => { reject(new SubscriptionUsageTimeout()); controller.abort(); }, SUBSCRIPTION_USAGE_TIMEOUT_MS);
      }),
    ]);
    if (result.companyId !== companyId) throw new Error("Usage scope mismatch");
    return result;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function subscriptionUsageError(error: unknown): "forbidden" | "timeout" | "loadError" {
  if (error instanceof SubscriptionUsageTimeout) return "timeout";
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return "forbidden";
  return "loadError";
}

/** Catalog pages are partial results; absence is not proof of withdrawal or invalidity. */
export function resolveSubscriptionPlanSelection(ids: readonly string[], candidate: string, allowDefault: boolean) {
  if (candidate) return { selectedId: ids.includes(candidate) ? candidate : "", missing: !ids.includes(candidate) };
  return { selectedId: allowDefault ? ids[0] ?? "" : "", missing: false };
}
