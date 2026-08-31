import { visibleNavigationItems, type NavigationAccess, type View } from "./app-navigation";
import type { TranslationKey } from "./i18n";

// Sections describe the intended destination for the composition owner. The current
// onNavigate(View) contract opens the real page, never an invented hash/deep link.
export type RetailSetupTarget =
  | { view: "inventory"; section: "warehouses" | "units" | "items" | "balances" }
  | { view: "treasury"; section: "accounts" | "methods" }
  | { view: Exclude<View, "inventory" | "treasury" | "platform" | "platformSubscriptions">; section?: never };

export type RetailFactId = "warehouses" | "units" | "items" | "stock" | "cash";
export type RetailFactState = "notChecked" | "unavailable" | "loading" | "found" | "empty" | "error";
export type RetailFacts = Record<RetailFactId, RetailFactState>;
export type RetailStepId = "business" | "catalog" | "stock" | "cash" | "checkout" | "results";
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

export function initialRetailStep(access: NavigationAccess): RetailStepId {
  return retailSteps.find((step) => retailActions(step, access).length)?.id ?? "business";
}
