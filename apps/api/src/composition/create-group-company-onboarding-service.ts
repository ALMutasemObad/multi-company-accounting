import type { PrismaClient } from "@prisma/client";
import { AccountingCompanyProvisioningAdapter } from "../accounts/company-provisioning-adapter.js";
import { PrismaAuditAppendAdapter } from "../audit/prisma-audit-append-adapter.js";
import { GroupCompanyOnboardingTenantAdapter } from "../companies/group-company-onboarding-tenant-adapter.js";
import { GroupCompanyOnboardingService } from "../organizations/group-company-onboarding-service.js";
import { PrismaNewCompanySubscriptionProvisioningAdapter } from "../platform-subscriptions/prisma-new-company-subscription-provisioning-adapter.js";
import { TreasuryCompanyProvisioningAdapter } from "../treasury/company-provisioning-adapter.js";
import { GroupCompanyOnboardingIdentityAdapter } from "../users/group-company-onboarding-identity-adapter.js";

export function createGroupCompanyOnboardingService(prisma: PrismaClient, startPlanVersionId = process.env.PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID) {
  return new GroupCompanyOnboardingService(prisma, {
    tenant: new GroupCompanyOnboardingTenantAdapter(prisma), identity: new GroupCompanyOnboardingIdentityAdapter(),
    accounting: new AccountingCompanyProvisioningAdapter(), treasury: new TreasuryCompanyProvisioningAdapter(),
    subscriptions: new PrismaNewCompanySubscriptionProvisioningAdapter(startPlanVersionId), audit: new PrismaAuditAppendAdapter(),
  });
}
