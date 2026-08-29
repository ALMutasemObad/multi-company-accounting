import type { TranslationKey } from "./i18n";
import type { IconName } from "./ui";
import { allows, type PermissionPolicy } from "./authorization";

export type View =
  | "home"
  | "dashboard"
  | "platform"
  | "pos"
  | "customers"
  | "professionalProjects"
  | "humanResources"
  | "sales"
  | "receipts"
  | "suppliers"
  | "purchases"
  | "payments"
  | "journals"
  | "fiscal"
  | "approvals"
  | "accounts"
  | "treasury"
  | "inventory"
  | "reports"
  | "imports"
  | "admin"
  | "audit"
  | "security"
  | "settings";

export type NavigationItem = {
  view: View;
  icon: IconName;
  label: TranslationKey;
  platformOnly?: boolean;
};

export type NavigationAccess = {
  permissionSet: ReadonlySet<string>;
  hasSelectedCompany: boolean;
  platformOperations: boolean;
};

type TenantProtectedView = Exclude<View, "home" | "platform">;

export const viewPermissionPolicies: Record<TenantProtectedView, PermissionPolicy> = {
  dashboard: { permission: "dashboard.view" },
  pos: { permission: "pos.view" },
  customers: { permission: "customers.view" },
  professionalProjects: { permission: "professional_projects.view" },
  humanResources: { allOf: ["hr.employees.view", "hr.structure.view", "hr.contracts.view"] },
  sales: { permission: "sales_invoices.view" },
  receipts: { permission: "receipts.view" },
  suppliers: { permission: "suppliers.view" },
  purchases: { permission: "purchase_invoices.view" },
  payments: { permission: "payments.view" },
  journals: { permission: "manual_journals.view" },
  fiscal: { permission: "fiscal_periods.view" },
  approvals: { permission: "approvals.view" },
  accounts: { allOf: ["accounts.view", "cost_centers.manage"] },
  treasury: { permission: "cash_bank_accounts.view" },
  inventory: { permission: "warehouses.view" },
  reports: { permission: "reports.cash_flow.view" },
  imports: { permission: "data_imports.view" },
  admin: { allOf: ["users.view", "roles.view"] },
  audit: { permission: "audit_logs.view" },
  security: { permission: "security_events.view" },
  settings: { allOf: ["companies.view", "settings.manage", "currencies.view"] },
};

export const navigationItems: NavigationItem[] = [
  { view: "home", icon: "home", label: "nav.home" },
  { view: "dashboard", icon: "dashboard", label: "nav.dashboard" },
  { view: "platform", icon: "platform", label: "nav.platform", platformOnly: true },
  { view: "pos", icon: "wallet", label: "nav.pos" },
  { view: "customers", icon: "customers", label: "nav.customers" },
  { view: "professionalProjects", icon: "users", label: "nav.professionalProjects" },
  { view: "humanResources", icon: "building", label: "nav.humanResources" },
  { view: "sales", icon: "document", label: "nav.sales" },
  { view: "receipts", icon: "receipts", label: "nav.receipts" },
  { view: "suppliers", icon: "suppliers", label: "nav.suppliers" },
  { view: "purchases", icon: "document", label: "nav.purchases" },
  { view: "payments", icon: "payments", label: "nav.payments" },
  { view: "journals", icon: "journal", label: "nav.journals" },
  { view: "fiscal", icon: "calendar", label: "nav.fiscal" },
  { view: "approvals", icon: "check", label: "nav.approvals" },
  { view: "accounts", icon: "accounts", label: "nav.accounts" },
  { view: "treasury", icon: "treasury", label: "nav.treasury" },
  { view: "inventory", icon: "inventory", label: "nav.inventory" },
  { view: "reports", icon: "reports", label: "nav.reports" },
  { view: "imports", icon: "arrowUp", label: "nav.imports" },
  { view: "admin", icon: "users", label: "nav.admin" },
  { view: "audit", icon: "audit", label: "nav.audit" },
  { view: "security", icon: "audit", label: "nav.security" },
  { view: "settings", icon: "settings", label: "nav.settings" },
];

export const viewTitleKey = Object.fromEntries(
  navigationItems.map((item) => [item.view, item.label]),
) as Record<View, TranslationKey>;

export const views = new Set<View>(navigationItems.map((item) => item.view));

export function isNavigationItemVisible(
  item: NavigationItem,
  access: NavigationAccess,
) {
  if (item.view === "platform") return item.platformOnly === true && access.platformOperations;
  if (!access.hasSelectedCompany) return false;
  if (item.view === "home") return true;
  return allows(access.permissionSet, viewPermissionPolicies[item.view]);
}

export const visibleNavigationItems = (access: NavigationAccess) =>
  navigationItems.filter((item) => isNavigationItemVisible(item, access));

export function resolveAuthorizedView(requested: View, access: NavigationAccess): View {
  const requestedItem = navigationItems.find((item) => item.view === requested);
  if (requestedItem && isNavigationItemVisible(requestedItem, access)) return requested;
  return access.hasSelectedCompany ? "home" : access.platformOperations ? "platform" : "home";
}

export type ModuleCard = NavigationItem & { description: TranslationKey };
export type SystemGroup = {
  key: "business" | "workforce" | "finance" | "administration";
  title: TranslationKey;
  description: TranslationKey;
  modules: ModuleCard[];
};

export const systemGroups: SystemGroup[] = [
  {
    key: "business",
    title: "home.group.business",
    description: "home.group.businessDescription",
    modules: navigationItems.filter((item) => ["pos", "customers", "sales", "receipts", "suppliers", "purchases", "payments"].includes(item.view))
      .map((item) => ({ ...item, description: `home.module.${item.view}` as TranslationKey })),
  },
  {
    key: "workforce",
    title: "home.group.workforce",
    description: "home.group.workforceDescription",
    modules: navigationItems.filter((item) => ["professionalProjects", "humanResources", "approvals"].includes(item.view))
      .map((item) => ({ ...item, description: `home.module.${item.view}` as TranslationKey })),
  },
  {
    key: "finance",
    title: "home.group.finance",
    description: "home.group.financeDescription",
    modules: navigationItems.filter((item) => ["dashboard", "journals", "fiscal", "accounts", "treasury", "inventory", "reports"].includes(item.view))
      .map((item) => ({ ...item, description: `home.module.${item.view}` as TranslationKey })),
  },
  {
    key: "administration",
    title: "home.group.administration",
    description: "home.group.administrationDescription",
    modules: navigationItems.filter((item) => ["imports", "admin", "audit", "security", "settings"].includes(item.view))
      .map((item) => ({ ...item, description: `home.module.${item.view}` as TranslationKey })),
  },
];

export const visibleSystemGroups = (access: NavigationAccess): SystemGroup[] =>
  systemGroups
    .map((group) => ({
      ...group,
      modules: group.modules.filter((item) => isNavigationItemVisible(item, access)),
    }))
    .filter((group) => group.modules.length > 0);
