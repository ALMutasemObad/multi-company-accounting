import type { PrismaClient } from "@prisma/client";
import type { PlatformCompanyQuotaUsageQueryPort } from "../platform-operations/platform-operations-ports.js";
import { SubscriptionUsagePlanAdapter } from "../platform-subscriptions/subscription-usage-plan-adapter.js";
import { SubscriptionUsageService } from "../platform-subscriptions/subscription-usage-service.js";

export function createSubscriptionUsageService(
  prisma: PrismaClient,
  analytics: PlatformCompanyQuotaUsageQueryPort,
  now: () => Date = () => new Date(),
) {
  return new SubscriptionUsageService({
    measure(input) {
      // Shared billing definitions, without its unused Audit operations counter.
      return analytics.companyQuotaUsage(input);
    },
  }, new SubscriptionUsagePlanAdapter(prisma), now);
}
