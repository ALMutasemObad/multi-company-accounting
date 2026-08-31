import { resolveAuthorizedView, views, type NavigationAccess, type View } from './app-navigation';

export type InventorySection = 'warehouses' | 'balances' | 'movements' | 'units' | 'items';
export type TreasurySection = 'accounts' | 'methods';
export type PageRoute =
  | { view: 'inventory'; section?: InventorySection }
  | { view: 'treasury'; section?: TreasurySection }
  | { view: Exclude<View, 'inventory' | 'treasury'>; section?: never };

const inventorySections: readonly InventorySection[] = ['warehouses', 'balances', 'movements', 'units', 'items'];
const treasurySections: readonly TreasurySection[] = ['accounts', 'methods'];

export function visibleInventorySections(permissions: ReadonlySet<string>): InventorySection[] {
  return inventorySections.filter(section => {
    if (!permissions.has('warehouses.view')) return false;
    if (section === 'warehouses') return true;
    if (!permissions.has('inventory_catalog.view')) return false;
    return section === 'units' || section === 'items' || permissions.has('inventory_movements.view');
  });
}

/** Only known local pages and sections are accepted. No IDs, tenant context or redirect URLs. */
export function parsePageRoute(hash: string): PageRoute {
  const [name, query = '', ...extra] = hash.replace(/^#/, '').split('?');
  if (!views.has(name as View)) return { view: 'home' };
  const view = name as View;
  const plain = { view } as PageRoute;
  const params = new URLSearchParams(query);
  if (extra.length || [...params.keys()].some(key => key !== 'section') || params.getAll('section').length !== 1) return plain;
  const section = params.get('section');
  if (view === 'inventory' && inventorySections.includes(section as InventorySection)) return { view, section: section as InventorySection };
  if (view === 'treasury' && treasurySections.includes(section as TreasurySection)) return { view, section: section as TreasurySection };
  return plain;
}

export function pageRouteHash(route: PageRoute): string {
  return route.section ? `${route.view}?section=${route.section}` : route.view;
}

export function authorizedPageRoute(requested: PageRoute, access: NavigationAccess): PageRoute {
  const view = resolveAuthorizedView(requested.view, access);
  if (view !== requested.view) return { view } as PageRoute;
  if (requested.view === 'inventory' && requested.section
    && !visibleInventorySections(access.permissionSet).includes(requested.section)) return { view: 'inventory' };
  return requested;
}
