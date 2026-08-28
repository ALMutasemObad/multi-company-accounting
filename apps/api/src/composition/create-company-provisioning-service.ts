import type { PrismaClient } from "@prisma/client";
import { AccountingCompanyProvisioningAdapter } from "../accounts/company-provisioning-adapter.js";
import { PrismaAuditAppendAdapter } from "../audit/prisma-audit-append-adapter.js";
import { TenantCompanyProvisioningAdapter } from "../companies/company-provisioning-adapter.js";
import { CompanyProvisioningService } from "../platform/company-provisioning-service.js";
import { TreasuryCompanyProvisioningAdapter } from "../treasury/company-provisioning-adapter.js";
import { IdentityCompanyProvisioningAdapter } from "../users/company-provisioning-adapter.js";

export function createCompanyProvisioningService(prisma: PrismaClient) {
  return new CompanyProvisioningService(
    prisma,
    new TenantCompanyProvisioningAdapter(),
    new IdentityCompanyProvisioningAdapter(),
    new AccountingCompanyProvisioningAdapter(),
    new TreasuryCompanyProvisioningAdapter(),
    new PrismaAuditAppendAdapter(),
  );
}
