import { FormEvent, lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError, beginLogin, login, logout } from "./api";
import { localizedBrand, storageKey } from "./branding";
import { LanguageSwitcher, type TranslationKey, useI18n } from "./i18n";
import type { Company, User } from "./types";
import { Button, Icon, Spinner, Toast } from "./ui";
import { RegistrationPage } from "./RegistrationPage";
import { PasswordResetPage } from "./PasswordResetPage";

const DashboardPage = lazy(() => import("./DashboardPage").then((module) => ({ default: module.DashboardPage })));
const CustomersPage = lazy(() => import("./CustomersPage").then((module) => ({ default: module.CustomersPage })));
const SalesInvoicesPage = lazy(() => import("./SalesInvoicesPage").then((module) => ({ default: module.SalesInvoicesPage })));
const ReceiptsPage = lazy(() => import("./ReceiptsPage").then((module) => ({ default: module.ReceiptsPage })));
const SuppliersPage = lazy(() => import("./SuppliersPage").then((module) => ({ default: module.SuppliersPage })));
const PurchaseInvoicesPage = lazy(() => import("./PurchaseInvoicesPage").then((module) => ({ default: module.PurchaseInvoicesPage })));
const PaymentsPage = lazy(() => import("./PaymentsPage").then((module) => ({ default: module.PaymentsPage })));
const ManualJournalsPage = lazy(() => import("./ManualJournalsPage").then((module) => ({ default: module.ManualJournalsPage })));
const FiscalPage = lazy(() => import("./FiscalPage").then((module) => ({ default: module.FiscalPage })));
const AccountsPage = lazy(() => import("./AccountsPage").then((module) => ({ default: module.AccountsPage })));
const TreasuryPage = lazy(() => import("./TreasuryPage").then((module) => ({ default: module.TreasuryPage })));
const InventoryPage = lazy(() => import("./InventoryPage").then((module) => ({ default: module.InventoryPage })));
const ReportsPage = lazy(() => import("./ReportsPage").then((module) => ({ default: module.ReportsPage })));
const AdminPage = lazy(() => import("./AdminPage").then((module) => ({ default: module.AdminPage })));
const AuditLogsPage = lazy(() => import("./AuditLogsPage").then((module) => ({ default: module.AuditLogsPage })));
const SecurityEventsPage = lazy(() => import("./SecurityEventsPage").then((module) => ({ default: module.SecurityEventsPage })));
const CompanySettingsPage = lazy(() => import("./CompanySettingsPage").then((module) => ({ default: module.CompanySettingsPage })));
const DataImportsPage = lazy(() => import("./DataImportsPage").then((module) => ({ default: module.DataImportsPage })));
const PosPage = lazy(() => import("./PosPage").then((module) => ({ default: module.PosPage })));
const ApprovalsPage = lazy(() => import("./ApprovalsPage").then((module) => ({ default: module.ApprovalsPage })));
const ProfessionalProjectsPage = lazy(() => import("./ProfessionalProjectsPage").then((module) => ({ default: module.ProfessionalProjectsPage })));

type View = "dashboard" | "pos" | "customers" | "professionalProjects" | "sales" | "receipts" | "suppliers" | "purchases" | "payments" | "journals" | "fiscal" | "approvals" | "accounts" | "treasury" | "inventory" | "reports" | "imports" | "admin" | "audit" | "security" | "settings";

const viewFromHash = (): View => {
  const value = location.hash.slice(1);
  return ["dashboard", "pos", "customers", "professionalProjects", "sales", "receipts", "suppliers", "purchases", "payments", "journals", "fiscal", "approvals", "accounts", "treasury", "inventory", "reports", "imports", "admin", "audit", "security", "settings"].includes(value) ? value as View : "dashboard";
};

const navigationItems: Array<{ view: View; icon: Parameters<typeof Icon>[0]["name"]; label: TranslationKey }> = [
  { view: "dashboard", icon: "dashboard", label: "nav.dashboard" },
  { view: "pos", icon: "wallet", label: "nav.pos" },
  { view: "customers", icon: "customers", label: "nav.customers" },
  { view: "professionalProjects", icon: "users", label: "nav.professionalProjects" },
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

const viewTitleKey: Record<View, TranslationKey> = {
  admin: "nav.admin",
  audit: "nav.audit",
  security: "nav.security",
  settings: "nav.settings",
  dashboard: "nav.dashboard",
  pos: "nav.pos",
  customers: "nav.customers",
  professionalProjects: "view.professionalProjects",
  sales: "view.sales",
  receipts: "nav.receipts",
  suppliers: "nav.suppliers",
  purchases: "view.purchases",
  payments: "nav.payments",
  journals: "nav.journals",
  fiscal: "view.fiscal",
  approvals: "view.approvals",
  accounts: "view.accounts",
  treasury: "nav.treasury",
  inventory: "nav.inventory",
  reports: "nav.reports",
  imports: "nav.imports",
};

export default function App() {
  const { dir, t } = useI18n();
  const brand = localizedBrand(t);
  const [state, setState] = useState<"booting" | "login" | "register" | "password-reset" | "company" | "ready">("booting");
  const [user, setUser] = useState<User | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [view, setView] = useState<View>(viewFromHash);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  useEffect(() => {
    document.title = brand.name;
  }, [brand.name]);

  const notify = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const chooseCompany = useCallback(async (selected: Company) => {
    await api<void>("/auth/context", {
      method: "PUT",
      body: JSON.stringify({ companyId: selected.id }),
    });
    setCompany(selected);
    localStorage.setItem(storageKey("company"), selected.id);
    setState("ready");
  }, []);

  useEffect(() => {
    void (async () => {
      if (location.hash.startsWith("#reset-password")) {
        await beginLogin().catch(() => undefined);
        setState("password-reset");
        return;
      }
      if (location.hash.startsWith("#register")) {
        await beginLogin().catch(() => undefined);
        setState("register");
        return;
      }
      try {
        const result = await api<{ data: Company[] }>("/auth/companies");
        setCompanies(result.data);
        const saved = localStorage.getItem(storageKey("company"));
        const selected =
          result.data.find((item) => item.id === saved) ?? result.data[0];
        if (!selected) {
          setState("company");
          return;
        }
        try {
          await chooseCompany(selected);
          setUser({
            id: "current",
            displayName:
              sessionStorage.getItem(storageKey("userName")) ?? "",
          });
        } catch {
          await beginLogin();
          setState("login");
        }
      } catch {
        await beginLogin().catch(() => undefined);
        setState("login");
      }
    })();
  }, [chooseCompany]);

  function navigate(next: View) {
    setView(next);
    location.hash = next;
    setMobileNav(false);
  }

  if (state === "booting")
    return (
      <main className="center-screen">
        <div className="brand-mark large">{brand.mark}</div>
        <Spinner label={t("app.booting", { productName: brand.name })} />
      </main>
    );

  if (state === "login")
    return (
      <LoginScreen
        onForgotPassword={() => {
          location.hash = "reset-password";
          void beginLogin().finally(() => setState("password-reset"));
        }}
        onRegister={() => {
          location.hash = "register";
          setState("register");
        }}
        onLoggedIn={async (loggedInUser) => {
          setUser(loggedInUser);
          sessionStorage.setItem(storageKey("userName"), loggedInUser.displayName);
          const result = await api<{ data: Company[] }>("/auth/companies");
          setCompanies(result.data);
          if (result.data.length === 1) await chooseCompany(result.data[0]!);
          else setState("company");
        }}
      />
    );

  if (state === "register")
    return (
      <RegistrationPage
        onBackToLogin={() => {
          const url = new URL(location.href);
          history.replaceState(null, "", `${url.pathname}${url.search}`);
          void beginLogin().finally(() => setState("login"));
        }}
      />
    );

  if (state === "password-reset")
    return (
      <PasswordResetPage
        onBackToLogin={() => {
          const url = new URL(location.href);
          history.replaceState(null, "", `${url.pathname}${url.search}`);
          void beginLogin().finally(() => setState("login"));
        }}
      />
    );

  if (state === "company")
    return (
      <CompanyScreen
        companies={companies}
        onSelect={(selected) =>
          void chooseCompany(selected).catch((cause) =>
            notify(cause instanceof Error ? cause.message : t("app.chooseCompanyError"), "error"),
          )
        }
      />
    );

  return (
    <div className="app-shell" dir={dir}>
      <a className="skip-link" href="#main-content">{t("common.skipToContent")}</a>
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">{brand.mark}</div>
          <div><strong>{brand.shortName}</strong><span>{t("app.trustedFinance")}</span></div>
        </div>
        <nav aria-label={t("app.mainNavigation")}>
          {navigationItems.map((item) => (
            <button type="button" key={item.view} className={view === item.view ? "active" : ""} aria-current={view === item.view ? "page" : undefined} onClick={() => navigate(item.view)}>
              <Icon name={item.icon} /><span>{t(item.label)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="company-badge"><Icon name="building" /><div><span>{t("app.currentCompany")}</span><strong>{company?.name}</strong></div></div>
          <button
            type="button"
            className="switch-company"
            onClick={() => setState("company")}
            disabled={companies.length < 2}
          >
            {t("app.switchCompany")}
          </button>
        </div>
      </aside>
      {mobileNav && <button type="button" className="nav-scrim" aria-label={t("app.closeNavigation")} onClick={() => setMobileNav(false)} />}
      <div className="app-main">
        <header className="topbar">
          <button type="button" className="menu-button" aria-label={t("app.openNavigation")} onClick={() => setMobileNav(true)}><Icon name="menu" /></button>
          <div className="topbar-title"><span>{t(viewTitleKey[view])}</span><small>{company?.name}</small></div>
          <div className="user-menu">
            <div className="avatar">{user?.displayName?.slice(0, 1) || brand.mark.slice(0, 1)}</div>
            <span>{user?.displayName || t("app.currentUser")}</span>
            <LanguageSwitcher compact />
            <button
              type="button"
              aria-label={t("app.logout")}
              title={t("app.logout")}
              onClick={() =>
                void logout().finally(() => {
                  sessionStorage.removeItem(storageKey("userName"));
                  void beginLogin().finally(() => setState("login"));
                })
              }
            >
              <Icon name="logout" size={19} />
            </button>
          </div>
        </header>
        <main id="main-content" className="content" tabIndex={-1}>
          <Suspense fallback={<div className="loading"><Spinner /><span>{t("app.loadingModule")}</span></div>}>
            {view === "dashboard" && <DashboardPage onNavigate={navigate} />}
            {view === "pos" && <PosPage notify={notify} />}
            {view === "customers" && <CustomersPage notify={notify} />}
            {view === "professionalProjects" && <ProfessionalProjectsPage notify={notify} />}
            {view === "sales" && <SalesInvoicesPage notify={notify} />}
            {view === "receipts" && <ReceiptsPage notify={notify} />}
            {view === "suppliers" && <SuppliersPage notify={notify} />}
            {view === "purchases" && <PurchaseInvoicesPage notify={notify} />}
            {view === "payments" && <PaymentsPage notify={notify} />}
            {view === "journals" && <ManualJournalsPage notify={notify} />}
            {view === "fiscal" && <FiscalPage notify={notify} />}
            {view === "approvals" && <ApprovalsPage notify={notify} />}
            {view === "accounts" && <AccountsPage notify={notify} />}
            {view === "treasury" && <TreasuryPage notify={notify} />}
            {view === "inventory" && <InventoryPage notify={notify} />}
            {view === "reports" && <ReportsPage />}
            {view === "imports" && <DataImportsPage notify={notify} />}
            {view === "admin" && <AdminPage notify={notify} />}
            {view === "audit" && <AuditLogsPage notify={notify} onNavigate={navigate} />}
            {view === "security" && <SecurityEventsPage notify={notify} />}
            {view === "settings" && <CompanySettingsPage notify={notify} />}
          </Suspense>
        </main>
      </div>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function LoginScreen({ onLoggedIn, onRegister, onForgotPassword }: { onLoggedIn: (user: User) => Promise<void>; onRegister: () => void; onForgotPassword: () => void }) {
  const { dir, t } = useI18n();
  const brand = localizedBrand(t);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await onLoggedIn(
        await login(String(data.get("email")), String(data.get("password"))),
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "INVALID_CREDENTIALS")
        setError(t("login.invalidCredentials"));
      else if (cause instanceof ApiError && cause.code === "ACCOUNT_LOCKED")
        setError(t("login.accountLocked"));
      else setError(cause instanceof Error ? cause.message : t("login.error"));
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="auth-layout" dir={dir}>
      <div className="auth-language"><LanguageSwitcher /></div>
      <section className="auth-story">
        <div className="auth-brand"><div className="brand-mark">{brand.mark}</div><span>{brand.name}</span></div>
        <div>
          <span className="section-kicker light">{t("login.storyKicker")}</span>
          <h1>{t("login.headlineFirst")}<br />{t("login.headlineSecond")}</h1>
          <p>{t("login.storyDescription")}</p>
        </div>
      </section>
      <section className="auth-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-auth-brand"><div className="brand-mark">{brand.mark}</div><strong>{brand.shortName}</strong></div>
          <span className="section-kicker">{t("login.welcome")}</span>
          <h2>{t("login.title")}</h2>
          <p>{t("login.description")}</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <label><span>{t("login.email")}</span><input name="email" type="email" dir="ltr" autoComplete="username" required /></label>
          <label><span>{t("login.password")}</span><input name="password" type="password" dir="ltr" autoComplete="current-password" required /></label>
          <button className="auth-text-link" type="button" onClick={onForgotPassword}>{t("login.forgotPassword")}</button>
          <Button type="submit" disabled={loading}>{loading ? t("login.checking") : t("login.submit")}</Button>
          <button className="auth-text-link" type="button" onClick={onRegister}>{t("login.createAccount")}</button>
        </form>
      </section>
    </main>
  );
}

function CompanyScreen({
  companies,
  onSelect,
}: {
  companies: Company[];
  onSelect: (company: Company) => void;
}) {
  const { dir, t } = useI18n();
  const brand = localizedBrand(t);
  return (
    <main className="company-screen" dir={dir}>
      <div className="company-screen-language"><LanguageSwitcher /></div>
      <div className="brand"><div className="brand-mark">{brand.mark}</div><div><strong>{brand.shortName}</strong><span>{t("companyPicker.workspace")}</span></div></div>
      <section>
        <span className="section-kicker">{t("companyPicker.available")}</span>
        <h1>{t("companyPicker.title")}</h1>
        <p>{t("companyPicker.description")}</p>
        <div className="company-grid">
          {companies.map((item) => (
            <button type="button" key={item.id} onClick={() => onSelect(item)}>
              <Icon name="building" size={28} />
              <div><strong>{item.name}</strong><span>{t("companyPicker.open")}</span></div>
              <Icon name="back" />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
