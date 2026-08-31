import type { PrismaClient } from "@prisma/client";
import { AccountingCompanyProvisioningAdapter } from "../accounts/company-provisioning-adapter.js";
import { PrismaAuditAppendAdapter } from "../audit/prisma-audit-append-adapter.js";
import { TenantCompanyProvisioningAdapter } from "../companies/company-provisioning-adapter.js";
import { CompanyProvisioningService } from "../platform/company-provisioning-service.js";
import { PrismaNewCompanySubscriptionProvisioningAdapter } from "../platform-subscriptions/prisma-new-company-subscription-provisioning-adapter.js";
import { TreasuryCompanyProvisioningAdapter } from "../treasury/company-provisioning-adapter.js";
import { IdentityCompanyProvisioningAdapter } from "../users/company-provisioning-adapter.js";

export function createCompanyProvisioningService(
  prisma: PrismaClient,
  startPlanVersionId: string | undefined = process.env.PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID,
) {
  return new CompanyProvisioningService(
    prisma,
    new TenantCompanyProvisioningAdapter(),
    new IdentityCompanyProvisioningAdapter(),
    new AccountingCompanyProvisioningAdapter(),
    new TreasuryCompanyProvisioningAdapter(),
    new PrismaNewCompanySubscriptionProvisioningAdapter(startPlanVersionId),
    new PrismaAuditAppendAdapter(),
  );
}
