import type { TranslationKey } from "./i18n";
import type { IconName } from "./ui";
import { allows, type PermissionPolicy } from "./authorization";
import type { PlatformModuleCode } from './types';

export type View =
  | "home"
  | "dashboard"
  | "organizationOwner"
  | "platform"
  | "platformSubscriptions"
  | "subscription"
  | "pos"
  | "customers"
  | "crm"
  | "professionalProjects"
  | "humanResources"
  | "employeeExpenses"
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
  module?: PlatformModuleCode;
  platformOnly?: boolean;
  organizationOnly?: boolean;
};

export type NavigationAccess = {
  moduleSet: ReadonlySet<PlatformModuleCode>;
  permissionSet: ReadonlySet<string>;
  hasSelectedCompany: boolean;
  platformOperations: boolean;
  organizationWorkspace?: boolean;
};

type TenantProtectedView = Exclude<View, "home" | "organizationOwner" | "platform" | "platformSubscriptions">;

export const viewPermissionPolicies: Record<TenantProtectedView, PermissionPolicy> = {
  dashboard: { permission: "dashboard.view" },
  pos: { permission: "pos.view" },
  customers: { permission: "customers.view" },
  crm: { permission: "crm.view" },
  professionalProjects: { permission: "professional_projects.view" },
  humanResources: { allOf: ["hr.employees.view", "hr.structure.view", "hr.contracts.view"] },
  employeeExpenses: { anyOf: ["employee_expenses.view", "employee_expenses.review"] },
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
  subscription: { permission: "subscriptions.view" },
};

export const navigationItems: NavigationItem[] = [
  { view: "home", icon: "home", label: "nav.home" },
  { view: "dashboard", icon: "dashboard", label: "nav.dashboard", module: 'REPORTING' },
  { view: "organizationOwner", icon: "building", label: "nav.organizationOwner", organizationOnly: true },
  { view: "platform", icon: "platform", label: "nav.platform", platformOnly: true },
  { view: "platformSubscriptions", icon: "calendar", label: "nav.platformSubscriptions", platformOnly: true },
  { view: "subscription", icon: "calendar", label: "nav.subscription" },
  { view: "pos", icon: "wallet", label: "nav.pos", module: 'POS' },
  { view: "customers", icon: "customers", label: "nav.customers", module: 'SALES' },
  { view: "crm", icon: "dashboard", label: "nav.crm", module: 'SALES' },
  { view: "professionalProjects", icon: "users", label: "nav.professionalProjects", module: 'PROFESSIONAL_PROJECTS' },
  { view: "humanResources", icon: "building", label: "nav.humanResources", module: 'HUMAN_RESOURCES' },
  { view: "employeeExpenses", icon: "wallet", label: "nav.employeeExpenses", module: 'HUMAN_RESOURCES' },
  { view: "sales", icon: "document", label: "nav.sales", module: 'SALES' },
  { view: "receipts", icon: "receipts", label: "nav.receipts", module: 'TREASURY' },
  { view: "suppliers", icon: "suppliers", label: "nav.suppliers", module: 'PURCHASES' },
  { view: "purchases", icon: "document", label: "nav.purchases", module: 'PURCHASES' },
  { view: "payments", icon: "payments", label: "nav.payments", module: 'TREASURY' },
  { view: "journals", icon: "journal", label: "nav.journals", module: 'CORE_ACCOUNTING' },
  { view: "fiscal", icon: "calendar", label: "nav.fiscal", module: 'CORE_ACCOUNTING' },
  { view: "approvals", icon: "check", label: "nav.approvals", module: 'APPROVALS' },
  { view: "accounts", icon: "accounts", label: "nav.accounts", module: 'CORE_ACCOUNTING' },
  { view: "treasury", icon: "treasury", label: "nav.treasury", module: 'TREASURY' },
  { view: "inventory", icon: "inventory", label: "nav.inventory", module: 'INVENTORY' },
  { view: "reports", icon: "reports", label: "nav.reports", module: 'REPORTING' },
  { view: "imports", icon: "arrowUp", label: "nav.imports", module: 'DATA_IMPORT' },
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
  if (item.view === "platform" || item.view === "platformSubscriptions") {
    return item.platformOnly === true && access.platformOperations;
  }
  if (item.view === "organizationOwner") return item.organizationOnly === true && access.organizationWorkspace;
  if (!access.hasSelectedCompany) return false;
  if (item.view === "home") return true;
  if (item.module && !access.moduleSet.has(item.module)) return false;
  return allows(access.permissionSet, viewPermissionPolicies[item.view]);
}

export const visibleNavigationItems = (access: NavigationAccess) =>
  navigationItems.filter((item) => isNavigationItemVisible(item, access));

export function resolveAuthorizedView(requested: View, access: NavigationAccess): View {
  const requestedItem = navigationItems.find((item) => item.view === requested);
  if (requestedItem && isNavigationItemVisible(requestedItem, access)) return requested;
  return access.hasSelectedCompany ? "home" : access.platformOperations ? "platform" : access.organizationWorkspace ? "organizationOwner" : "home";
}

export type ModuleCard = NavigationItem & { description: TranslationKey };
export type QuickStart = NavigationItem & {
  title: TranslationKey;
  description: TranslationKey;
  path: TranslationKey;
};

export const companyQuickStarts: QuickStart[] = [
  {
    view: "pos",
    icon: "wallet",
    label: "nav.pos",
    title: "home.quick.pos.title",
    description: "home.quick.pos.description",
    path: "home.quick.pos.path",
  },
  {
    view: "sales",
    icon: "document",
    label: "nav.sales",
    title: "home.quick.sales.title",
    description: "home.quick.sales.description",
    path: "home.quick.sales.path",
  },
  {
    view: "purchases",
    icon: "suppliers",
    label: "nav.purchases",
    title: "home.quick.purchases.title",
    description: "home.quick.purchases.description",
    path: "home.quick.purchases.path",
  },
  {
    view: "dashboard",
    icon: "dashboard",
    label: "nav.dashboard",
    title: "home.quick.dashboard.title",
    description: "home.quick.dashboard.description",
    path: "home.quick.dashboard.path",
  },
];

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
    modules: navigationItems.filter((item) => ["pos", "customers", "crm", "sales", "receipts", "suppliers", "purchases", "payments"].includes(item.view))
      .map((item) => ({ ...item, description: `home.module.${item.view}` as TranslationKey })),
  },
  {
    key: "workforce",
    title: "home.group.workforce",
    description: "home.group.workforceDescription",
    modules: navigationItems.filter((item) => ["professionalProjects", "humanResources", "employeeExpenses", "approvals"].includes(item.view))
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
    modules: navigationItems.filter((item) => ["organizationOwner", "subscription", "imports", "admin", "audit", "security", "settings"].includes(item.view))
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
