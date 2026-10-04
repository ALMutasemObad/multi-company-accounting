import { describe, expect, it } from 'vitest';
import { effectivePermissionSet, permissionModule } from './module-entitlements';
import { localeDictionary as arLocale } from './i18n/locales/ar.locale';
import { localeDictionary as enLocale } from './i18n/locales/en.locale';
import { localeDictionary as hiLocale } from './i18n/locales/hi.locale';
import { localeDictionary as urLocale } from './i18n/locales/ur.locale';

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

describe('independent service catalog entitlement', () => {
  it('does not inherit project or sales catalog permissions', () => {
    expect(permissionModule('services.manage')).toBe('SERVICE_CATALOG');
    expect(permissionModule('services.view')).toBe('SERVICE_CATALOG');
    expect(permissionModule('sales_catalog.view')).toBe('SALES');
    expect([...effectivePermissionSet(['services.manage'], new Set(['SALES', 'PROFESSIONAL_PROJECTS']))]).toEqual([]);
  });

  it('names the standalone catalog as general service management in every locale', () => {
    for (const [dictionary, label] of [
      [arLocale, 'إدارة الخدمات'],
      [enLocale, 'Service management'],
      [hiLocale, 'सेवाओं का प्रबंधन'],
      [urLocale, 'خدمات کا انتظام'],
    ] as const) {
      expect(dictionary['nav.services']).toBe(label);
      expect(dictionary['view.services']).toBe(label);
      expect(dictionary['service.title']).toBe(label);
    }
  });
});
