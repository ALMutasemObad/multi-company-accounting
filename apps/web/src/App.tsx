import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, beginLogin, login, logout } from "./api";
import { localizedBrand } from "./branding";
import { LanguageSwitcher, useI18n } from "./i18n";
import type { Company, CurrentAuthorization, User } from "./types";
import { Button, Icon, Spinner, Toast } from "./ui";
import { RegistrationPage } from "./RegistrationPage";
import { PasswordResetPage } from "./PasswordResetPage";
import {
  resolveAuthorizedView,
  viewTitleKey,
  views,
  visibleNavigationItems,
  type NavigationAccess,
  type View,
} from "./app-navigation";
import { AuthorizationProvider } from "./authorization-context";
import { effectivePermissionSet } from './module-entitlements';

const SystemHomePage = lazy(() => import("./SystemHomePage").then((module) => ({ default: module.SystemHomePage })));
const DashboardPage = lazy(() => import("./DashboardPage").then((module) => ({ default: module.DashboardPage })));
const PlatformOperationsPage = lazy(() => import("./PlatformOperationsPage").then((module) => ({ default: module.PlatformOperationsPage })));
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
const HumanResourcesPage = lazy(() => import("./HumanResourcesPage").then((module) => ({ default: module.HumanResourcesPage })));

const viewFromHash = (): View => {
  const value = location.hash.slice(1);
  return views.has(value as View) ? value as View : "home";
};

type PlatformCapabilities = { platformOperations: boolean };
const noPlatformCapabilities: PlatformCapabilities = { platformOperations: false };

const replaceHash = (view: View) => {
  const url = new URL(location.href);
  history.replaceState(null, "", `${url.pathname}${url.search}#${view}`);
};

export default function App() {
  const { dir, t } = useI18n();
  const brand = localizedBrand(t);
  const [state, setState] = useState<"booting" | "login" | "register" | "password-reset" | "company" | "ready">("booting");
  const [authorization, setAuthorization] = useState<CurrentAuthorization | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [view, setView] = useState<View>(viewFromHash);
  const [platformOperator, setPlatformOperator] = useState<boolean | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  useEffect(() => {
    document.title = brand.name;
  }, [brand.name]);

  const notify = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const activateAuthorization = useCallback((
    snapshot: CurrentAuthorization,
    capabilities: PlatformCapabilities,
  ) => {
    setAuthorization(snapshot);
    setPlatformOperator(capabilities.platformOperations);
    if (!snapshot.selectedCompany && capabilities.platformOperations) {
      setView("platform");
      replaceHash("platform");
    }
    setState("ready");
  }, []);

  const chooseCompany = useCallback(async (selected: Company) => {
    await api<void>("/auth/context", {
      method: "PUT",
      body: JSON.stringify({ companyId: selected.id }),
    });
    const [snapshot, capabilities] = await Promise.all([
      api<CurrentAuthorization>("/auth/me"),
      api<PlatformCapabilities>("/platform/capabilities").catch(() => noPlatformCapabilities),
    ]);
    if (snapshot.selectedCompany?.id !== selected.id) {
      throw new Error(t("app.chooseCompanyError"));
    }
    activateAuthorization(snapshot, capabilities);
  }, [activateAuthorization, t]);

  const loadAuthenticatedShell = useCallback(async (autoSelectSingleCompany: boolean) => {
    const [companyResult, snapshot, capabilities] = await Promise.all([
      api<{ data: Company[] }>("/auth/companies"),
      api<CurrentAuthorization>("/auth/me"),
      api<PlatformCapabilities>("/platform/capabilities").catch(() => noPlatformCapabilities),
    ]);
    setCompanies(companyResult.data);
    if (snapshot.selectedCompany) {
      activateAuthorization(snapshot, capabilities);
      return;
    }
    if (companyResult.data.length === 0 && capabilities.platformOperations) {
      activateAuthorization(snapshot, capabilities);
      return;
    }
    setAuthorization(snapshot);
    setPlatformOperator(capabilities.platformOperations);
    if (autoSelectSingleCompany && companyResult.data.length === 1) {
      await chooseCompany(companyResult.data[0]!);
      return;
    }
    setState("company");
  }, [activateAuthorization, chooseCompany]);

  const navigationAccess = useMemo<NavigationAccess>(() => {
    const moduleSet = new Set(authorization?.modules ?? []);
    return {
      moduleSet,
      permissionSet: effectivePermissionSet(authorization?.permissions ?? [], moduleSet),
      hasSelectedCompany: Boolean(authorization?.selectedCompany),
      platformOperations: platformOperator === true,
    };
  }, [authorization, platformOperator]);
  const allowedNavigationItems = useMemo(
    () => visibleNavigationItems(navigationAccess),
    [navigationAccess],
  );
  const activeView = resolveAuthorizedView(view, navigationAccess);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (state !== "ready" || activeView === view) return;
    setView(activeView);
    replaceHash(activeView);
  }, [activeView, state, view]);

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
        await loadAuthenticatedShell(false);
      } catch {
        await beginLogin().catch(() => undefined);
        setState("login");
      }
    })();
  }, [loadAuthenticatedShell]);

  function navigate(next: View) {
    const authorized = resolveAuthorizedView(next, navigationAccess);
    setView(authorized);
    location.hash = authorized;
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
        onLoggedIn={async () => loadAuthenticatedShell(true)}
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

  if (!authorization) {
    return (
      <main className="center-screen">
        <Spinner label={t("app.booting", { productName: brand.name })} />
      </main>
    );
  }

  const user = authorization.user;
  const company = authorization.selectedCompany;

  return (
    <AuthorizationProvider authorization={authorization}>
    <div className="app-shell" dir={dir}>
      <a className="skip-link" href="#main-content">{t("common.skipToContent")}</a>
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">{brand.mark}</div>
          <div><strong>{brand.shortName}</strong><span>{t("app.trustedFinance")}</span></div>
        </div>
        <nav aria-label={t("app.mainNavigation")}>
          {allowedNavigationItems.map((item) => (
            <button type="button" key={item.view} className={activeView === item.view ? "active" : ""} aria-current={activeView === item.view ? "page" : undefined} onClick={() => navigate(item.view)}>
              <Icon name={item.icon} /><span>{t(item.label)}</span>
            </button>
          ))}
        </nav>
        {(company || companies.length > 1) && <div className="sidebar-footer">
          {company && <div className="company-badge"><Icon name="building" /><div><span>{t("app.currentCompany")}</span><strong>{company.name}</strong></div></div>}
          {companies.length > 1 && <button
            type="button"
            className="switch-company"
            onClick={() => setState("company")}
          >
            {t("app.switchCompany")}
          </button>}
        </div>}
      </aside>
      {mobileNav && <button type="button" className="nav-scrim" aria-label={t("app.closeNavigation")} onClick={() => setMobileNav(false)} />}
      <div className="app-main">
        <header className="topbar">
          <button type="button" className="menu-button" aria-label={t("app.openNavigation")} onClick={() => setMobileNav(true)}><Icon name="menu" /></button>
          <div className="topbar-title"><span>{t(viewTitleKey[activeView])}</span><small>{company?.name ?? (activeView === "platform" ? t("nav.platform") : "")}</small></div>
          <div className="user-menu">
            <div className="avatar">{user.displayName.slice(0, 1) || brand.mark.slice(0, 1)}</div>
            <span>{user.displayName || t("app.currentUser")}</span>
            <LanguageSwitcher compact />
            <button
              type="button"
              aria-label={t("app.logout")}
              title={t("app.logout")}
              onClick={() =>
                void logout().finally(() => {
                  setAuthorization(null);
                  setCompanies([]);
                  setPlatformOperator(null);
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
            {activeView === "home" && <SystemHomePage onNavigate={navigate} />}
            {activeView === "dashboard" && <DashboardPage onNavigate={navigate} />}
            {activeView === "platform" && platformOperator && <PlatformOperationsPage />}
            {activeView === "pos" && <PosPage notify={notify} />}
            {activeView === "customers" && <CustomersPage notify={notify} />}
            {activeView === "professionalProjects" && <ProfessionalProjectsPage notify={notify} />}
            {activeView === "humanResources" && <HumanResourcesPage notify={notify} />}
            {activeView === "sales" && <SalesInvoicesPage notify={notify} />}
            {activeView === "receipts" && <ReceiptsPage notify={notify} />}
            {activeView === "suppliers" && <SuppliersPage notify={notify} />}
            {activeView === "purchases" && <PurchaseInvoicesPage notify={notify} />}
            {activeView === "payments" && <PaymentsPage notify={notify} />}
            {activeView === "journals" && <ManualJournalsPage notify={notify} />}
            {activeView === "fiscal" && <FiscalPage notify={notify} />}
            {activeView === "approvals" && <ApprovalsPage notify={notify} />}
            {activeView === "accounts" && <AccountsPage notify={notify} />}
            {activeView === "treasury" && <TreasuryPage notify={notify} />}
            {activeView === "inventory" && <InventoryPage notify={notify} />}
            {activeView === "reports" && <ReportsPage />}
            {activeView === "imports" && <DataImportsPage notify={notify} />}
            {activeView === "admin" && <AdminPage notify={notify} />}
            {activeView === "audit" && <AuditLogsPage notify={notify} onNavigate={navigate} />}
            {activeView === "security" && <SecurityEventsPage notify={notify} />}
            {activeView === "settings" && <CompanySettingsPage notify={notify} />}
          </Suspense>
        </main>
      </div>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
    </AuthorizationProvider>
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
