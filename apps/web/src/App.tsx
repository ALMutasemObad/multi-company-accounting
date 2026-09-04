import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, logout } from "./api";
import { localizedBrand } from "./branding";
import { LanguageSwitcher, useI18n } from "./i18n";
import type { Company, CurrentAuthorization } from "./types";
import { Button, Icon, Spinner, Toast } from "./ui";
import { RegistrationPage } from "./RegistrationPage";
import { PasswordResetPage } from "./PasswordResetPage";
import { subscriptionPlanForRoute, subscriptionPlanHash, subscriptionRouteBase } from "./public-plans";
import { LoginScreen } from "./LoginScreen";
import { AuthFeedback } from "./AuthFeedback";
import { useAuthAction } from "./use-auth-action";
import { assertRequestActive } from "./request-scope";
import {
  viewTitleKey,
  visibleNavigationItems,
  type NavigationAccess,
  type View,
} from "./app-navigation";
import { AuthorizationProvider } from "./authorization-context";
import { effectivePermissionSet } from './module-entitlements';
import { authorizedPageRoute, pageRouteHash, parsePageRoute, type PageRoute } from './page-section-navigation';
import { createSubscriptionUpgradeDismissals } from './subscription-upgrade-dismissal';

const SystemHomePage = lazy(() => import("./SystemHomePage").then((module) => ({ default: module.SystemHomePage })));
const SubscriptionUpgradeHome = lazy(() => import('./SubscriptionUpgradeHome').then(module => ({ default: module.SubscriptionUpgradeHome })));
const DashboardPage = lazy(() => import("./DashboardPage").then((module) => ({ default: module.DashboardPage })));
const PlatformOperationsPage = lazy(() => import("./PlatformOperationsPage").then((module) => ({ default: module.PlatformOperationsPage })));
const PlatformSubscriptionsPage = lazy(() => import("./PlatformSubscriptionsPage").then((module) => ({ default: module.PlatformSubscriptionsPage })));
const CompanySubscriptionPage = lazy(() => import("./CompanySubscriptionPage").then((module) => ({ default: module.CompanySubscriptionPage })));
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

type PlatformCapabilities = { platformOperations: boolean };

const replaceHash = (view: string) => {
  const url = new URL(location.href);
  history.replaceState(null, "", `${url.pathname}${url.search}#${view}`);
};

export default function App() {
  const { dir, t } = useI18n();
  const brand = localizedBrand(t);
  const [state, setState] = useState<"booting" | "login" | "register" | "password-reset" | "company" | "ready">("booting");
  const [authorization, setAuthorization] = useState<CurrentAuthorization | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [route, setRoute] = useState<PageRoute>(() => parsePageRoute(location.hash));
  const [platformOperator, setPlatformOperator] = useState<boolean | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const startup = useAuthAction();
  const runStartup = startup.run;
  const routeScope = useRef<string | null>(null);
  const subscriptionDismissals = useMemo(() => createSubscriptionUpgradeDismissals(), [authorization?.user.id]);

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
    const planIntent = subscriptionPlanForRoute(location.hash);
    const entryRoute = subscriptionRouteBase(location.hash);
    const nextScope = JSON.stringify([snapshot.user.id, snapshot.selectedCompany?.id,
      [...snapshot.modules].sort(), [...snapshot.permissions].sort()]);
    if (routeScope.current !== null && routeScope.current !== nextScope) {
      const pageOnly = { view: parsePageRoute(location.hash).view } as PageRoute;
      setRoute(pageOnly);
      replaceHash(pageRouteHash(pageOnly));
    }
    routeScope.current = nextScope;
    setAuthorization(snapshot);
    setPlatformOperator(capabilities.platformOperations);
    if (!snapshot.selectedCompany && capabilities.platformOperations) {
      setRoute({ view: "platform" });
      replaceHash("platform");
    } else if (snapshot.selectedCompany && snapshot.permissions.includes("subscriptions.view")
      && planIntent && ["", "#home", "#login", "#register"].includes(entryRoute)) {
      setRoute({ view: "subscription" });
      replaceHash(subscriptionPlanHash("subscription", planIntent));
    }
    setState("ready");
  }, []);

  const chooseCompany = useCallback(async (selected: Company, signal: AbortSignal) => {
    await api<void>("/auth/context", {
      method: "PUT",
      body: JSON.stringify({ companyId: selected.id }),
      signal,
    });
    const [snapshot, capabilities] = await Promise.all([
      api<CurrentAuthorization>("/auth/me", { signal }),
      api<PlatformCapabilities>("/platform/capabilities", { signal }),
    ]);
    assertRequestActive(signal);
    if (snapshot.selectedCompany?.id !== selected.id) {
      throw new ApiError("", 503, "AUTH_CONTEXT_MISMATCH");
    }
    activateAuthorization(snapshot, capabilities);
  }, [activateAuthorization]);

  const loadAuthenticatedShell = useCallback(async (autoSelectSingleCompany: boolean, signal: AbortSignal) => {
    const [companyResult, snapshot, capabilities] = await Promise.all([
      api<{ data: Company[] }>("/auth/companies", { signal }),
      api<CurrentAuthorization>("/auth/me", { signal }),
      api<PlatformCapabilities>("/platform/capabilities", { signal }),
    ]);
    assertRequestActive(signal);
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
      await chooseCompany(companyResult.data[0]!, signal);
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
  const activeRoute = authorizedPageRoute(route, navigationAccess);
  const activeView = activeRoute.view;
  const activeHash = pageRouteHash(activeRoute);
  const requestedHash = pageRouteHash(route);

  useEffect(() => {
    const onHashChange = () => {
      if (location.hash === "#main-content") return;
      setRoute(parsePageRoute(location.hash));
      const entry = subscriptionRouteBase(location.hash);
      setState(current => {
        if (current !== "login" && current !== "register") return current;
        return entry === "#register" ? "register" : entry === "#login" ? "login" : current;
      });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (state !== "ready" || activeHash === requestedHash) return;
    setRoute(parsePageRoute(activeHash));
    replaceHash(activeHash);
  }, [activeHash, requestedHash, state]);

  useEffect(() => {
      if (location.hash.startsWith("#reset-password")) {
        setState("password-reset");
        return;
      }
      if (location.hash.startsWith("#register")) {
        setState("register");
        return;
      }
      void runStartup((signal) => loadAuthenticatedShell(false, signal), {
        onError: (cause) => { if (cause instanceof ApiError && cause.status === 401) setState("login"); },
      });
  }, [loadAuthenticatedShell, runStartup]);

  function navigate(next: View) {
    navigateRoute({ view: next } as PageRoute);
  }

  function navigateRoute(next: PageRoute) {
    const authorized = authorizedPageRoute(next, navigationAccess);
    setRoute(authorized);
    location.hash = pageRouteHash(authorized);
    setMobileNav(false);
  }

  if (state === "booting")
    return (
      <main className="center-screen auth-resilient" dir={dir}>
        <div className="brand-mark large">{brand.mark}</div>
        <section className="login-card">
          <h1>{t("authResilience.bootTitle")}</h1>
          <AuthFeedback {...startup} />
          {!startup.busy && <Button type="button" onClick={() => void runStartup((signal) => loadAuthenticatedShell(false, signal), {
            onError: (cause) => { if (cause instanceof ApiError && cause.status === 401) setState("login"); },
          })}>{t("authResilience.retryRead")}</Button>}
          <Button type="button" variant="ghost" onClick={() => { startup.cancel(); setState("login"); }}>{t("authResilience.back")}</Button>
        </section>
      </main>
    );

  if (state === "login")
    return (
      <LoginScreen
        onForgotPassword={() => {
          location.hash = "reset-password";
          setState("password-reset");
        }}
        onRegister={() => {
          location.hash = subscriptionPlanHash("register", subscriptionPlanForRoute(location.hash));
          setState("register");
        }}
        onLoggedIn={(signal) => loadAuthenticatedShell(true, signal)}
      />
    );

  if (state === "register")
    return (
      <RegistrationPage
        onBackToLogin={() => {
          replaceHash(subscriptionPlanHash("login", subscriptionPlanForRoute(location.hash)));
          setState("login");
        }}
      />
    );

  if (state === "password-reset")
    return (
      <PasswordResetPage
        onBackToLogin={() => {
          const url = new URL(location.href);
          history.replaceState(null, "", `${url.pathname}${url.search}`);
          setState("login");
        }}
      />
    );

  if (state === "company")
    return (
      <CompanyScreen
        companies={companies}
        onSelect={chooseCompany}
        onBackToLogin={() => setState("login")}
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
          {allowedNavigationItems.some((item) => item.view === "home" || item.view === "dashboard") && <>
            <span className="sidebar-section-label">{t("app.companyWorkspace")}</span>
            {allowedNavigationItems.filter((item) => item.view === "home" || item.view === "dashboard").map((item) => (
              <button type="button" key={item.view} className={activeView === item.view ? "active" : ""} aria-current={activeView === item.view ? "page" : undefined} onClick={() => navigate(item.view)}>
                <Icon name={item.icon} /><span>{t(item.label)}</span>
              </button>
            ))}
          </>}
          {allowedNavigationItems.some((item) => item.platformOnly) && <>
            <span className="sidebar-section-label platform">{t("app.platformWorkspace")}</span>
            {allowedNavigationItems.filter((item) => item.platformOnly).map((item) => (
              <button type="button" key={item.view} className={`platform-nav-item ${activeView === item.view ? "active" : ""}`} aria-current={activeView === item.view ? "page" : undefined} onClick={() => navigate(item.view)}>
                <Icon name={item.icon} /><span>{t(item.label)}</span>
              </button>
            ))}
          </>}
          {allowedNavigationItems.some((item) => !item.platformOnly && item.view !== "home" && item.view !== "dashboard") && <>
            <span className="sidebar-section-label modules">{t("app.companyModules")}</span>
            {allowedNavigationItems.filter((item) => !item.platformOnly && item.view !== "home" && item.view !== "dashboard").map((item) => (
              <button type="button" key={item.view} className={activeView === item.view ? "active" : ""} aria-current={activeView === item.view ? "page" : undefined} onClick={() => navigate(item.view)}>
              <Icon name={item.icon} /><span>{t(item.label)}</span>
            </button>
          ))}
          </>}
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
          <div className="topbar-title"><span>{t(viewTitleKey[activeView])}</span><small>{activeView === "platform" || activeView === "platformSubscriptions" ? t("app.platformScope") : company?.name}</small></div>
          <div className="user-menu">
            <div className="avatar">{user.displayName.slice(0, 1) || brand.mark.slice(0, 1)}</div>
            <span>{user.displayName || t("app.currentUser")}</span>
            <LanguageSwitcher compact />
            <button
              type="button"
              aria-label={t("app.logout")}
              title={t("app.logout")}
              onClick={() =>
                void logout().catch(() => undefined).finally(() => {
                  setAuthorization(null);
                  setCompanies([]);
                  setPlatformOperator(null);
                  setState("login");
                })
              }
            >
              <Icon name="logout" size={19} />
            </button>
          </div>
        </header>
        <main id="main-content" className="content" tabIndex={-1}>
          <Suspense key={`${user.id}:${company?.id ?? "platform"}`} fallback={<div className="loading"><Spinner /><span>{t("app.loadingModule")}</span></div>}>
            {activeView === "home" && <>
              <SubscriptionUpgradeHome dismissals={subscriptionDismissals} onOpenSubscription={() => navigate('subscription')} />
              <SystemHomePage onNavigate={navigate} onOpenSetupTarget={navigateRoute} platformOperator={platformOperator === true} />
            </>}
            {activeView === "dashboard" && <DashboardPage onNavigate={navigate} />}
            {activeView === "platform" && platformOperator && <PlatformOperationsPage onNavigate={navigate} />}
            {activeView === "platformSubscriptions" && platformOperator && <PlatformSubscriptionsPage notify={notify} />}
            {activeView === "subscription" && <CompanySubscriptionPage notify={notify} />}
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
            {activeRoute.view === "treasury" && <TreasuryPage notify={notify} section={activeRoute.section} />}
            {activeRoute.view === "inventory" && <InventoryPage notify={notify} section={activeRoute.section} onSectionChange={(section) => navigateRoute({ view: "inventory", section })} />}
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

function CompanyScreen({
  companies,
  onSelect,
  onBackToLogin,
}: {
  companies: Company[];
  onSelect: (company: Company, signal: AbortSignal) => Promise<void>;
  onBackToLogin: () => void;
}) {
  const { dir, t } = useI18n();
  const brand = localizedBrand(t);
  const action = useAuthAction();
  return (
    <main className="company-screen auth-resilient" dir={dir}>
      <div className="company-screen-language"><LanguageSwitcher /></div>
      <div className="brand"><div className="brand-mark">{brand.mark}</div><div><strong>{brand.shortName}</strong><span>{t("companyPicker.workspace")}</span></div></div>
      <section>
        <span className="section-kicker">{t("companyPicker.available")}</span>
        <h1>{t("companyPicker.title")}</h1>
        <p>{t("companyPicker.description")}</p>
        <AuthFeedback {...action} />
        {action.error != null && <Button type="button" variant="ghost" onClick={onBackToLogin}>{t("authResilience.back")}</Button>}
        <div className="company-grid">
          {companies.map((item) => (
            <button type="button" key={item.id} disabled={action.busy} onClick={() => void action.run((signal) => onSelect(item, signal))}>
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
