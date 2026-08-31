import type { PrismaClient } from "@prisma/client";
import type { PlatformAnalyticsQueryPort } from "../platform-operations/platform-operations-ports.js";
import { SubscriptionUsagePlanAdapter } from "../platform-subscriptions/subscription-usage-plan-adapter.js";
import { SubscriptionUsageService } from "../platform-subscriptions/subscription-usage-service.js";

export function createSubscriptionUsageService(
  prisma: PrismaClient,
  analytics: Pick<PlatformAnalyticsQueryPort, "companyUsage">,
  now: () => Date = () => new Date(),
) {
  return new SubscriptionUsageService({
    async measure(input) {
      // Reuse precisely the aggregate definitions consumed by PlatformBillingService.
      const usage = await analytics.companyUsage(input);
      return usage ? { users: usage.users, employees: usage.employees, postedDocuments: usage.postedDocuments } : null;
    },
  }, new SubscriptionUsagePlanAdapter(prisma), now);
}
