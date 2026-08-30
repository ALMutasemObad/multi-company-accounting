import {
  type CompanyEntitlementQueryPort,
  type PlatformModuleCode,
} from './platform-entitlement-ports.js';

export const PLATFORM_FOUNDATION = 'PLATFORM_FOUNDATION' as const;
export type PermissionEntitlement = PlatformModuleCode | typeof PLATFORM_FOUNDATION;

const permissionEntitlementPrefixes = [
  ['audit_logs.', PLATFORM_FOUNDATION],
  ['security_events.', PLATFORM_FOUNDATION],
  ['companies.', PLATFORM_FOUNDATION],
  ['settings.', PLATFORM_FOUNDATION],
  ['currencies.', PLATFORM_FOUNDATION],
  ['auth.', PLATFORM_FOUNDATION],
  ['users.', PLATFORM_FOUNDATION],
  ['roles.', PLATFORM_FOUNDATION],
  ['fiscal_periods.', 'CORE_ACCOUNTING'],
  ['accounts.', 'CORE_ACCOUNTING'],
  ['cost_centers.', 'CORE_ACCOUNTING'],
  ['manual_journals.', 'CORE_ACCOUNTING'],
  ['customers.', 'SALES'],
  ['sales_invoices.', 'SALES'],
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
  ['tax_rates.', 'TAX'],
  ['input_tax_rates.', 'TAX'],
] as const satisfies readonly (readonly [string, PermissionEntitlement])[];

export function permissionEntitlement(permission: string): PermissionEntitlement | null {
  return permissionEntitlementPrefixes.find(([prefix]) => permission.startsWith(prefix))?.[1] ?? null;
}

export type EffectiveCompanyCapabilities = {
  moduleCodes: PlatformModuleCode[];
  permissions: string[];
};

export interface CompanyCapabilityPort {
  resolve(companyId: bigint, rbacPermissions: readonly string[]): Promise<EffectiveCompanyCapabilities>;
  allows(companyId: bigint, permission: string): Promise<boolean>;
}

export class CompanyCapabilityService implements CompanyCapabilityPort {
  constructor(private readonly entitlements: CompanyEntitlementQueryPort) {}

  async resolve(companyId: bigint, rbacPermissions: readonly string[]) {
    const snapshot = await this.entitlements.findCompanyEntitlements(companyId);
    const moduleCodes = [...new Set(snapshot?.moduleCodes ?? [])].sort();
    const entitled = new Set(moduleCodes);
    const permissions = [...new Set(rbacPermissions)]
      .filter((permission) => {
        const required = permissionEntitlement(permission);
        return required === PLATFORM_FOUNDATION
          || (required !== null && entitled.has(required));
      })
      .sort();
    return { moduleCodes, permissions };
  }

  async allows(companyId: bigint, permission: string) {
    const required = permissionEntitlement(permission);
    if (required === PLATFORM_FOUNDATION) return true;
    if (required === null) return false;
    const snapshot = await this.entitlements.findCompanyEntitlements(companyId);
    return snapshot?.moduleCodes.includes(required) ?? false;
  }
}
