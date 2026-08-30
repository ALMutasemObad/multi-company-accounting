import { describe, expect, it, vi } from 'vitest';
import { permissionDefinitions } from '../src/platform/reference-data.js';
import {
  CompanyCapabilityService,
  PLATFORM_FOUNDATION,
  permissionEntitlement,
} from '../src/platform-subscriptions/company-capability-service.js';
import type {
  CompanyEntitlementQueryPort,
  CompanyEntitlementSnapshot,
  PlatformModuleCode,
} from '../src/platform-subscriptions/platform-entitlement-ports.js';

function entitlementQuery(
  moduleCodes: PlatformModuleCode[] | null,
): CompanyEntitlementQueryPort {
  return {
    findCompanyEntitlements: vi.fn(async (companyId: bigint): Promise<CompanyEntitlementSnapshot | null> => moduleCodes === null ? null : ({
      subscriptionId: 7n,
      companyId,
      status: 'SUSPENDED',
      version: 1,
      plan: { code: 'LEGACY', versionNumber: 1, displayName: 'Legacy' },
      moduleCodes,
    })),
  };
}

describe('CompanyCapabilityService', () => {
  it('maps every seeded RBAC permission to an explicit module or platform foundation', () => {
    for (const [permission] of permissionDefinitions) {
      expect(permissionEntitlement(permission), permission).not.toBeNull();
    }
    expect(permissionEntitlement('unknown.future.permission')).toBeNull();
  });

  it('intersects dated company entitlements with RBAC and fails closed for unknown permissions', async () => {
    const service = new CompanyCapabilityService(entitlementQuery(['SALES']));

    await expect(service.resolve(20n, [
      'sales_invoices.view',
      'payments.view',
      'auth.sessions.view',
      'unknown.future.permission',
    ])).resolves.toEqual({
      moduleCodes: ['SALES'],
      permissions: ['auth.sessions.view', 'sales_invoices.view'],
    });
    await expect(service.allows(20n, 'sales_invoices.view')).resolves.toBe(true);
    await expect(service.allows(20n, 'payments.view')).resolves.toBe(false);
    await expect(service.allows(20n, 'unknown.future.permission')).resolves.toBe(false);
  });

  it('fails closed without a subscription while retaining recovery-safe foundation permissions', async () => {
    const service = new CompanyCapabilityService(entitlementQuery(null));

    await expect(service.resolve(30n, ['customers.view', 'users.view'])).resolves.toEqual({
      moduleCodes: [],
      permissions: ['users.view'],
    });
    expect(permissionEntitlement('users.view')).toBe(PLATFORM_FOUNDATION);
    await expect(service.allows(30n, 'customers.view')).resolves.toBe(false);
  });

  it('honors effective grandfathered rows independently of deferred SUB-3 grace policy', async () => {
    const service = new CompanyCapabilityService(entitlementQuery(['TREASURY']));

    await expect(service.allows(40n, 'receipts.view')).resolves.toBe(true);
  });
});
