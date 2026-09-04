import type { PrismaClient } from "@prisma/client";
import { PrismaAuditAppendAdapter } from "../audit/prisma-audit-append-adapter.js";
import { OrganizationOwnerTenantAdapter } from "../companies/organization-owner-tenant-adapter.js";
import { OrganizationOwnerAccountingAdapter } from "../core-accounting/organization-owner-accounting-adapter.js";
import { OrganizationOwnerPurchaseAdapter } from "../purchases/organization-owner-purchase-adapter.js";
import { OrganizationOwnerSalesAdapter } from "../sales/organization-owner-sales-adapter.js";
import { OrganizationMembershipService } from "../users/organization-membership-service.js";
import { OrganizationOwnerMetricAuthorizationAdapter } from "../platform-subscriptions/organization-owner-metric-authorization-adapter.js";

export function createOrganizationMembershipService(prisma: PrismaClient) {
  return new OrganizationMembershipService(prisma, {
    tenant: new OrganizationOwnerTenantAdapter(prisma),
    accounting: new OrganizationOwnerAccountingAdapter(prisma),
    sales: new OrganizationOwnerSalesAdapter(prisma),
    purchases: new OrganizationOwnerPurchaseAdapter(prisma),
    authorization: new OrganizationOwnerMetricAuthorizationAdapter(prisma),
    audit: new PrismaAuditAppendAdapter(),
  });
}
