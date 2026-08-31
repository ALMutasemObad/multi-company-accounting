import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

// Test-only catalog data, never a commercial default or a production seed.
export async function createStartPlanFixture(prisma: PrismaClient, currencyCode: string) {
  const core = await prisma.platformModule.findUniqueOrThrow({ where: { code: 'CORE_ACCOUNTING' } });
  const reporting = await prisma.platformModule.findUniqueOrThrow({ where: { code: 'REPORTING' } });
  const plan = await prisma.platformPlan.create({ data: { code: `TEST_START_${randomUUID()}` } });
  const version = await prisma.platformPlanVersion.create({ data: {
    planId: plan.id, versionNumber: 1, displayName: 'Test-only onboarding policy',
    billingCycle: 'MONTHLY', currencyCode, recurringFee: '0', selfServicePolicy: 'IMMEDIATE_FREE',
    pricePerAdditionalUser: '0', pricePerAdditionalEmployee: '0', pricePerAdditionalPostedDocument: '0',
    includedUsers: 2, includedEmployees: 3, includedPostedDocuments: 4,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'), publishedAt: new Date('2026-01-01T00:00:00Z'),
    entitlements: { create: [
      { moduleId: core.id, selectionMode: 'INCLUDED' },
      { moduleId: reporting.id, selectionMode: 'OPTIONAL', additionalRecurringFee: '7.25' },
    ] },
  } });
  return {
    plan, version, core,
    async cleanup() {
      await prisma.platformPlanEntitlement.deleteMany({ where: { planVersionId: version.id } });
      await prisma.platformPlanVersion.delete({ where: { id: version.id } });
      await prisma.platformPlan.delete({ where: { id: plan.id } });
    },
  };
}
