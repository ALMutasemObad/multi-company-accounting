import { visibleNavigationItems, type NavigationAccess, type View } from "./app-navigation";
import type { CashierContextField } from "./cashier-context-model";
import type { TranslationKey } from "./i18n";
import type { PlatformModuleCode } from "./types";

// Sections describe the intended destination for the composition owner. The current
// onNavigate(View) contract opens the real page, never an invented hash/deep link.
export type RetailSetupTarget =
  | { view: "inventory"; section: "warehouses" | "units" | "items" | "balances" }
  | { view: "treasury"; section: "accounts" | "methods" }
  | { view: Exclude<View, "inventory" | "treasury" | "platform" | "platformSubscriptions">; section?: never };

export type RetailFactId = "warehouses" | "units" | "items" | "stock" | "cash";
export type RetailFactState = "notChecked" | "unavailable" | "loading" | "found" | "empty" | "error";
export type RetailFacts = Record<RetailFactId, RetailFactState>;
export type PosRequirementId = CashierContextField | "period" | "catalog";
export type PosReadinessFactId = Exclude<PosRequirementId, "period">;
export type PosReadinessState = "notChecked" | "loading" | "ready" | "empty" | "forbidden" | "timeout" | "error";
export type PosReadinessFacts = Record<PosReadinessFactId, PosReadinessState>;
export type RetailStepId = "business" | "catalog" | "stock" | "cash" | "checkout" | "results";
export type RetailOutputCapabilityId = "barcodeLabel" | "receiptArchive";
export type RetailOutputCapability = {
  id: RetailOutputCapabilityId;
  title: TranslationKey;
  description: TranslationKey;
  modules: readonly PlatformModuleCode[];
  permissions: readonly string[];
};
export type RetailAction = { id: string; label: TranslationKey; target: RetailSetupTarget; permissions?: readonly string[] };
export type RetailStep = {
  id: RetailStepId;
  title: TranslationKey;
  description: TranslationKey;
  note: TranslationKey;
  facts: readonly RetailFactId[];
  actions: readonly RetailAction[];
};

export const retailSteps: readonly RetailStep[] = [
  {
    id: "business", title: "home.setup.business", description: "home.setup.businessDescription", note: "home.setup.businessNote", facts: [],
    actions: [
      { id: "settings", label: "nav.settings", target: { view: "settings" } },
      { id: "fiscal", label: "nav.fiscal", target: { view: "fiscal" } },
      { id: "accounts", label: "nav.accounts", target: { view: "accounts" } },
      { id: "customers", label: "nav.customers", target: { view: "customers" } },
    ],
  },
  {
    id: "catalog", title: "home.setup.catalog", description: "home.setup.catalogDescription", note: "home.setup.catalogNote", facts: ["units", "items"],
    actions: [
      { id: "items", label: "home.setup.openItems", target: { view: "inventory", section: "items" }, permissions: ["inventory_catalog.view"] },
      { id: "units", label: "home.setup.openUnits", target: { view: "inventory", section: "units" }, permissions: ["inventory_catalog.view"] },
      { id: "barcodes", label: "home.setup.openBarcodes", target: { view: "inventory", section: "items" }, permissions: ["inventory_catalog.view", "inventory_barcodes.view"] },
      { id: "sellingProfile", label: "home.setup.openSellingProfile", target: { view: "inventory", section: "items" }, permissions: ["inventory_catalog.view", "sales_catalog.view"] },
    ],
  },
  {
    id: "stock", title: "home.setup.stock", description: "home.setup.stockDescription", note: "home.setup.stockNote", facts: ["warehouses", "stock"],
    actions: [
      { id: "warehouses", label: "home.setup.openWarehouses", target: { view: "inventory", section: "warehouses" } },
      { id: "suppliers", label: "nav.suppliers", target: { view: "suppliers" } },
      { id: "purchases", label: "nav.purchases", target: { view: "purchases" } },
      { id: "balances", label: "home.setup.openBalances", target: { view: "inventory", section: "balances" }, permissions: ["inventory_movements.view", "inventory_catalog.view"] },
    ],
  },
  {
    id: "cash", title: "home.setup.cash", description: "home.setup.cashDescription", note: "home.setup.cashNote", facts: ["cash"],
    actions: [{ id: "cash", label: "nav.treasury", target: { view: "treasury", section: "accounts" } }],
  },
  {
    id: "checkout", title: "home.setup.checkout", description: "home.setup.checkoutDescription", note: "home.setup.checkoutNote", facts: [],
    actions: [{ id: "checkout", label: "home.openCashier", target: { view: "pos" }, permissions: ["pos.checkout"] }],
  },
  {
    id: "results", title: "home.setup.results", description: "home.setup.resultsDescription", note: "home.setup.resultsNote", facts: [],
    actions: [
      { id: "posResults", label: "home.reviewSales", target: { view: "pos" } },
      { id: "barcodeOutputs", label: "home.setup.openBarcodes", target: { view: "inventory", section: "items" }, permissions: ["inventory_catalog.view", "inventory_barcodes.view", "inventory_barcodes.print"] },
      { id: "sales", label: "nav.sales", target: { view: "sales" } },
      { id: "receipts", label: "nav.receipts", target: { view: "receipts" } },
      { id: "reports", label: "nav.reports", target: { view: "reports" } },
    ],
  },
];

export function retailActions(step: RetailStep, access: NavigationAccess) {
  const visible = new Set(visibleNavigationItems(access).map((item) => item.view));
  return step.actions.filter((action) => visible.has(action.target.view)
    && (action.id !== "sellingProfile" || access.moduleSet.has("SALES"))
    && (action.permissions ?? []).every((permission) => access.permissionSet.has(permission)));
}

export function showRetailGuide(access: NavigationAccess) {
  return access.hasSelectedCompany && (access.moduleSet.has("POS")
    || (access.moduleSet.has("INVENTORY") && access.moduleSet.has("SALES")));
}

const outputCapabilities: readonly RetailOutputCapability[] = [
  {
    id: "barcodeLabel",
    title: "home.setup.output.barcodeLabel",
    description: "home.setup.output.barcodeLabelDescription",
    modules: ["INVENTORY"],
    permissions: ["inventory_catalog.view", "inventory_barcodes.view", "inventory_barcodes.print"],
  },
  {
    id: "receiptArchive",
    title: "home.setup.output.receiptArchive",
    description: "home.setup.output.receiptArchiveDescription",
    modules: ["POS", "SALES"],
    permissions: ["pos.view", "sales_invoices.print"],
  },
];

export function retailOutputCapabilities(access: NavigationAccess): readonly RetailOutputCapability[] {
  if (!access.hasSelectedCompany) return [];
  return outputCapabilities.filter((capability) => capability.modules.every((module) => access.moduleSet.has(module))
    && capability.permissions.every((permission) => access.permissionSet.has(permission)));
}

export function initialRetailStep(access: NavigationAccess): RetailStepId {
  return retailSteps.find((step) => retailActions(step, access).length)?.id ?? "business";
}

type PosSetupDefinition = {
  id: PosRequirementId;
  target: RetailSetupTarget;
  modules: readonly PlatformModuleCode[];
  permissions: readonly string[];
};

/** Setup links are navigation only. Requiring the owner's manage permission
 * avoids presenting a cashier with an action that cannot correct the problem. */
const posSetupDefinitions: readonly PosSetupDefinition[] = [
  { id: "warehouseId", target: { view: "inventory", section: "warehouses" }, modules: ["INVENTORY"], permissions: ["warehouses.view", "warehouses.manage"] },
  { id: "period", target: { view: "fiscal" }, modules: ["CORE_ACCOUNTING"], permissions: ["fiscal_periods.view", "fiscal_periods.manage"] },
  { id: "cashBankAccountId", target: { view: "treasury", section: "accounts" }, modules: ["TREASURY"], permissions: ["cash_bank_accounts.view", "cash_bank_accounts.manage"] },
  { id: "paymentMethodId", target: { view: "treasury", section: "methods" }, modules: ["TREASURY"], permissions: ["cash_bank_accounts.view", "cash_bank_accounts.manage"] },
  { id: "currencyId", target: { view: "settings" }, modules: [], permissions: ["companies.view", "settings.manage", "currencies.view", "currencies.manage"] },
  { id: "catalog", target: { view: "inventory", section: "items" }, modules: ["INVENTORY", "SALES"], permissions: ["warehouses.view", "inventory_catalog.view", "sales_catalog.view", "sales_catalog.manage"] },
];

export function posSetupTarget(id: PosRequirementId, access: NavigationAccess): RetailSetupTarget | null {
  if (!access.hasSelectedCompany) return null;
  const definition = posSetupDefinitions.find((item) => item.id === id);
  if (!definition || !definition.modules.every((module) => access.moduleSet.has(module))
    || !definition.permissions.every((permission) => access.permissionSet.has(permission))) return null;
  return visibleNavigationItems(access).some((item) => item.view === definition.target.view) ? definition.target : null;
}
