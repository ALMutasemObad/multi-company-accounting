import type { PrismaClient } from '@prisma/client';
import { CompanyCapabilityService } from '../../src/platform-subscriptions/company-capability-service.js';
import { PrismaCompanyEntitlementQueryAdapter } from '../../src/platform-subscriptions/prisma-company-entitlement-query-adapter.js';

export function testAuthOptions(database: PrismaClient) {
  return {
    preAuthTtlMinutes: 10,
    sessionTtlHours: 12,
    companyCapabilities: new CompanyCapabilityService(
      new PrismaCompanyEntitlementQueryAdapter(database),
    ),
  };
}
