import { describe, expect, it } from 'vitest';
import { effectivePermissionSet, permissionModule } from './module-entitlements';

describe('sales catalogue entitlement boundary', () => {
  it('maps both catalogue permissions to SALES without granting manage from view', () => {
    expect(permissionModule('sales_catalog.view')).toBe('SALES');
    expect(permissionModule('sales_catalog.manage')).toBe('SALES');
    expect([...effectivePermissionSet(['sales_catalog.view'], new Set(['SALES']))])
      .toEqual(['sales_catalog.view']);
    expect(effectivePermissionSet([], new Set(['SALES'])).size).toBe(0);
  });

  it('does not infer SALES from POS, INVENTORY or a raw RBAC grant', () => {
    const permissions = ['sales_catalog.view', 'sales_catalog.manage'];
    expect(effectivePermissionSet(permissions, new Set()).size).toBe(0);
    expect(effectivePermissionSet(permissions, new Set(['POS', 'INVENTORY'])).size).toBe(0);
    expect([...effectivePermissionSet(permissions, new Set(['SALES']))]).toEqual(permissions);
  });
});

describe('inventory count entitlement boundary', () => {
  it('keeps dedicated count permissions when INVENTORY is entitled', () => {
    const permissions = ['inventory_counts.enter', 'inventory_counts.manage'];
    expect(permissionModule('inventory_counts.enter')).toBe('INVENTORY');
    expect(permissionModule('inventory_counts.manage')).toBe('INVENTORY');
    expect([...effectivePermissionSet(permissions, new Set(['INVENTORY']))]).toEqual(permissions);
  });

  it('does not expose count permissions without the INVENTORY module', () => {
    const permissions = ['inventory_counts.enter', 'inventory_counts.manage'];
    expect(effectivePermissionSet(permissions, new Set()).size).toBe(0);
    expect(effectivePermissionSet(permissions, new Set(['CORE_ACCOUNTING'])).size).toBe(0);
  });
});
