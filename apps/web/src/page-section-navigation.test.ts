import { describe, expect, it } from 'vitest';
import type { NavigationAccess } from './app-navigation';
import { effectivePermissionSet } from './module-entitlements';
import { authorizedPageRoute, pageRouteHash, parsePageRoute, visibleInventorySections } from './page-section-navigation';
import type { PlatformModuleCode } from './types';

function access(permissions: string[], modules: PlatformModuleCode[] = ['INVENTORY', 'TREASURY']): NavigationAccess {
  const moduleSet = new Set(modules);
  return { moduleSet, permissionSet: effectivePermissionSet(permissions, moduleSet), hasSelectedCompany: true, platformOperations: false };
}

describe('permission-aware page sections', () => {
  it('round-trips known sections while preserving old page-only links', () => {
    for (const hash of ['inventory?section=items', 'inventory?section=units', 'inventory?section=balances',
      'inventory?section=warehouses', 'inventory?section=movements', 'treasury?section=methods',
      'treasury?section=accounts', 'pos', 'subscription']) {
      expect(pageRouteHash(parsePageRoute(`#${hash}`))).toBe(hash);
    }
  });

  it('never treats an arbitrary query, company, duplicate section or URL as a navigation command', () => {
    for (const hash of ['#inventory?section=unknown', '#inventory?section=items&companyId=99',
      '#inventory?section=items&section=units', '#inventory?section=items?section=units',
      '#inventory?redirect=https://example.com', '#inventory?section=../../admin']) {
      expect(parsePageRoute(hash)).toEqual({ view: 'inventory' });
    }
    expect(parsePageRoute('#https://example.com')).toEqual({ view: 'home' });
    expect(parsePageRoute('#sales?section=items')).toEqual({ view: 'sales' });
  });

  it('checks page RBAC and company modules before honoring a section', () => {
    const route = parsePageRoute('#inventory?section=items');
    expect(authorizedPageRoute(route, access(['inventory_catalog.view']))).toEqual({ view: 'home' });
    expect(authorizedPageRoute(route, access(['warehouses.view', 'inventory_catalog.view'], []))).toEqual({ view: 'home' });
    expect(authorizedPageRoute(route, access(['warehouses.view']))).toEqual({ view: 'inventory' });
    expect(authorizedPageRoute(route, access(['warehouses.view', 'inventory_catalog.view']))).toEqual(route);
  });

  it('never mounts a stock panel without all its read permissions', () => {
    expect(visibleInventorySections(new Set(['warehouses.view']))).toEqual(['warehouses']);
    expect(visibleInventorySections(new Set(['warehouses.view', 'inventory_catalog.view']))).toEqual(['warehouses', 'units', 'items']);
    expect(visibleInventorySections(new Set(['warehouses.view', 'inventory_catalog.view', 'inventory_movements.view'])))
      .toEqual(['warehouses', 'balances', 'movements', 'units', 'items']);
  });

  it('leaves reconciliation capability-gated in its existing page and does not infer tenant access from platform status', () => {
    expect(parsePageRoute('#treasury?section=reconciliation')).toEqual({ view: 'treasury' });
    const route = parsePageRoute('#treasury?section=accounts');
    expect(authorizedPageRoute(route, access(['cash_bank_accounts.view']))).toEqual(route);
    expect(authorizedPageRoute(route, { ...access([]), hasSelectedCompany: false, platformOperations: true })).toEqual({ view: 'platform' });
  });
});
