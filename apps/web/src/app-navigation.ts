import type { TranslationKey } from "./i18n";
import type { IconName } from "./ui";

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

type ModuleCard = NavigationItem & { description: TranslationKey };
export const systemGroups: Array<{
  key: "business" | "workforce" | "finance" | "administration";
  title: TranslationKey;
  description: TranslationKey;
  modules: ModuleCard[];
}> = [
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
