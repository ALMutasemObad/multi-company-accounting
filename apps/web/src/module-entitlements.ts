import type { PlatformModuleCode } from './types';

const PLATFORM_FOUNDATION = 'PLATFORM_FOUNDATION' as const;
type PermissionEntitlement = PlatformModuleCode | typeof PLATFORM_FOUNDATION;

const permissionEntitlementPrefixes = [
  ['audit_logs.', PLATFORM_FOUNDATION],
  ['security_events.', PLATFORM_FOUNDATION],
  ['companies.', PLATFORM_FOUNDATION],
  ['settings.', PLATFORM_FOUNDATION],
  ['subscriptions.', PLATFORM_FOUNDATION],
  ['currencies.', PLATFORM_FOUNDATION],
  ['auth.', PLATFORM_FOUNDATION],
  ['users.', PLATFORM_FOUNDATION],
  ['roles.', PLATFORM_FOUNDATION],
  ['fiscal_periods.', 'CORE_ACCOUNTING'],
  ['accounts.', 'CORE_ACCOUNTING'],
  ['cost_centers.', 'CORE_ACCOUNTING'],
  ['manual_journals.', 'CORE_ACCOUNTING'],
  ['customers.', 'SALES'],
  ['crm.', 'SALES'],
  ['sales_invoices.', 'SALES'],
  ['sales_catalog.', 'SALES'],
  ['suppliers.', 'PURCHASES'],
  ['purchase_invoices.', 'PURCHASES'],
  ['cash_bank_accounts.', 'TREASURY'],
  ['bank_reconciliation.', 'TREASURY'],
  ['receipts.', 'TREASURY'],
  ['payments.', 'TREASURY'],
  ['warehouses.', 'INVENTORY'],
  ['inventory_catalog.', 'INVENTORY'],
  ['inventory_barcodes.', 'INVENTORY'],
  ['inventory_movements.', 'INVENTORY'],
  ['pos.', 'POS'],
  ['dashboard.', 'REPORTING'],
  ['reports.', 'REPORTING'],
  ['data_imports.', 'DATA_IMPORT'],
  ['approvals.', 'APPROVALS'],
  ['professional_', 'PROFESSIONAL_PROJECTS'],
  ['hr.', 'HUMAN_RESOURCES'],
  ['employee_expenses.', 'HUMAN_RESOURCES'],
  ['tax_rates.', 'TAX'],
  ['input_tax_rates.', 'TAX'],
] as const satisfies readonly (readonly [string, PermissionEntitlement])[];

export function permissionModule(permission: string): PermissionEntitlement | null {
  return permissionEntitlementPrefixes.find(([prefix]) => permission.startsWith(prefix))?.[1] ?? null;
}

export function effectivePermissionSet(
  permissions: readonly string[],
  modules: ReadonlySet<PlatformModuleCode>,
) {
  return new Set(permissions.filter((permission) => {
    const required = permissionModule(permission);
    return required === PLATFORM_FOUNDATION
      || (required !== null && modules.has(required));
  }));
}
