import type { PermissionPolicy } from "./authorization";

const permission = <Code extends string>(code: Code) =>
  ({ permission: code }) as const satisfies PermissionPolicy;

/** Read policies copied from the OpenAPI x-permission of shared reference endpoints. */
export const endpointPermissionPolicies = {
  accounts: permission("accounts.view"),
  bankReconciliation: permission("bank_reconciliation.view"),
  cashBankAccounts: permission("cash_bank_accounts.view"),
  costCenters: permission("cost_centers.manage"),
  currencies: permission("currencies.view"),
  customers: permission("customers.view"),
  fiscalPeriods: permission("fiscal_periods.view"),
  inventoryCatalog: permission("inventory_catalog.view"),
  payablesAging: permission("reports.payables.view"),
  paymentMethods: permission("cash_bank_accounts.view"),
  purchaseInvoices: permission("purchase_invoices.view"),
  purchaseTaxRates: permission("purchase_invoices.view"),
  receivablesAging: permission("reports.receivables.view"),
  salesInvoices: permission("sales_invoices.view"),
  salesTaxRates: permission("sales_invoices.view"),
  suppliers: permission("suppliers.view"),
  warehouses: permission("warehouses.view"),
} as const;

const referenceEndpointPolicies: Record<string, PermissionPolicy> = {
  "/accounts": endpointPermissionPolicies.accounts,
  "/cash-bank-accounts": endpointPermissionPolicies.cashBankAccounts,
  "/cost-centers": endpointPermissionPolicies.costCenters,
  "/currencies": endpointPermissionPolicies.currencies,
  "/customers": endpointPermissionPolicies.customers,
  "/fiscal-periods": endpointPermissionPolicies.fiscalPeriods,
  "/inventory-items": endpointPermissionPolicies.inventoryCatalog,
  "/payment-methods": endpointPermissionPolicies.paymentMethods,
  "/purchase-invoices": endpointPermissionPolicies.purchaseInvoices,
  "/purchase-tax-rates": endpointPermissionPolicies.purchaseTaxRates,
  "/sales-invoices": endpointPermissionPolicies.salesInvoices,
  "/suppliers": endpointPermissionPolicies.suppliers,
  "/tax-rates": endpointPermissionPolicies.salesTaxRates,
  "/warehouses": endpointPermissionPolicies.warehouses,
};

export function referenceEndpointPermission(endpoint: string) {
  const path = new URL(endpoint, "https://reference.local").pathname;
  return referenceEndpointPolicies[path];
}
