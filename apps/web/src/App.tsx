import { FormEvent, lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiError, beginLogin, login, logout } from "./api";
import { productMark, productName, productShortName, storageKey } from "./branding";
import type { Company, User } from "./types";
import { Button, Icon, Spinner, Toast } from "./ui";

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
const ReportsPage = lazy(() => import("./ReportsPage").then((module) => ({ default: module.ReportsPage })));
const AdminPage = lazy(() => import("./AdminPage").then((module) => ({ default: module.AdminPage })));
const AuditLogsPage = lazy(() => import("./AuditLogsPage").then((module) => ({ default: module.AuditLogsPage })));
const SecurityEventsPage = lazy(() => import("./SecurityEventsPage").then((module) => ({ default: module.SecurityEventsPage })));
const CompanySettingsPage = lazy(() => import("./CompanySettingsPage").then((module) => ({ default: module.CompanySettingsPage })));

type View = "dashboard" | "customers" | "sales" | "receipts" | "suppliers" | "purchases" | "payments" | "journals" | "fiscal" | "accounts" | "treasury" | "reports" | "admin" | "audit" | "security" | "settings";

const viewFromHash = (): View => {
  const value = location.hash.slice(1);
  return ["dashboard", "customers", "sales", "receipts", "suppliers", "purchases", "payments", "journals", "fiscal", "accounts", "treasury", "reports", "admin", "audit", "security", "settings"].includes(value) ? value as View : "dashboard";
};

const viewTitle: Record<View, string> = {
  admin: "المستخدمون والصلاحيات",
  audit: "سجل التدقيق",
  security: "سجل الأمان",
  settings: "إعدادات الشركة",
  dashboard: "لوحة التحكم",
  customers: "العملاء",
  sales: "فواتير المبيعات والذمم",
  receipts: "سندات القبض",
  suppliers: "الموردون",
  purchases: "فواتير المشتريات والذمم",
  payments: "سندات الصرف",
  journals: "القيود اليومية",
  fiscal: "السنوات والفترات المالية",
  accounts: "دليل الحسابات ومراكز التكلفة",
  treasury: "إدارة الخزينة",
  reports: "التقارير المالية",
};

export default function App() {
  const [state, setState] = useState<"booting" | "login" | "company" | "ready">("booting");
  const [user, setUser] = useState<User | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [view, setView] = useState<View>(viewFromHash);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

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
              sessionStorage.getItem(storageKey("userName")) ?? "المستخدم الحالي",
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
        <div className="brand-mark large">{productMark}</div>
        <Spinner label={`جارٍ تهيئة ${productName}`} />
      </main>
    );

  if (state === "login")
    return (
      <LoginScreen
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

  if (state === "company")
    return (
      <CompanyScreen
        companies={companies}
        onSelect={(selected) =>
          void chooseCompany(selected).catch((cause) =>
            notify(cause instanceof Error ? cause.message : "تعذر اختيار الشركة.", "error"),
          )
        }
      />
    );

  return (
    <div className="app-shell" dir="rtl">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">{productMark}</div>
          <div><strong>{productShortName}</strong><span>إدارة مالية موثوقة</span></div>
        </div>
        <nav aria-label="التنقل الرئيسي">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => navigate("dashboard")}>
            <Icon name="dashboard" /><span>لوحة التحكم</span>
          </button>
          <button className={view === "customers" ? "active" : ""} onClick={() => navigate("customers")}>
            <Icon name="customers" /><span>العملاء</span>
          </button>
          <button className={view === "sales" ? "active" : ""} onClick={() => navigate("sales")}>
            <Icon name="document" /><span>فواتير المبيعات</span>
          </button>
          <button className={view === "receipts" ? "active" : ""} onClick={() => navigate("receipts")}>
            <Icon name="receipts" /><span>سندات القبض</span>
          </button>
          <button className={view === "suppliers" ? "active" : ""} onClick={() => navigate("suppliers")}>
            <Icon name="suppliers" /><span>الموردون</span>
          </button>
          <button className={view === "purchases" ? "active" : ""} onClick={() => navigate("purchases")}>
            <Icon name="document" /><span>فواتير المشتريات</span>
          </button>
          <button className={view === "payments" ? "active" : ""} onClick={() => navigate("payments")}>
            <Icon name="payments" /><span>سندات الصرف</span>
          </button>
          <button className={view === "journals" ? "active" : ""} onClick={() => navigate("journals")}>
            <Icon name="journal" /><span>القيود اليومية</span>
          </button>
          <button className={view === "fiscal" ? "active" : ""} onClick={() => navigate("fiscal")}>
            <Icon name="calendar" /><span>الفترات المالية</span>
          </button>
          <button className={view === "accounts" ? "active" : ""} onClick={() => navigate("accounts")}>
            <Icon name="accounts" /><span>دليل الحسابات</span>
          </button>
          <button className={view === "treasury" ? "active" : ""} onClick={() => navigate("treasury")}>
            <Icon name="treasury" /><span>إدارة الخزينة</span>
          </button>
          <button className={view === "reports" ? "active" : ""} onClick={() => navigate("reports")}>
            <Icon name="reports" /><span>التقارير المالية</span>
          </button>
          <button className={view === "admin" ? "active" : ""} onClick={() => navigate("admin")}>
            <Icon name="users" /><span>المستخدمون والصلاحيات</span>
          </button>
          <button className={view === "audit" ? "active" : ""} onClick={() => navigate("audit")}>
            <Icon name="audit" /><span>سجل التدقيق</span>
          </button>
          <button className={view === "security" ? "active" : ""} onClick={() => navigate("security")}>
            <Icon name="audit" /><span>سجل الأمان</span>
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => navigate("settings")}>
            <Icon name="settings" /><span>إعدادات الشركة</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          <div className="company-badge"><Icon name="building" /><div><span>الشركة الحالية</span><strong>{company?.name}</strong></div></div>
          <button
            className="switch-company"
            onClick={() => setState("company")}
            disabled={companies.length < 2}
          >
            تبديل الشركة
          </button>
        </div>
      </aside>
      {mobileNav && <button className="nav-scrim" aria-label="إغلاق القائمة" onClick={() => setMobileNav(false)} />}
      <div className="app-main">
        <header className="topbar">
          <button className="menu-button" aria-label="فتح القائمة" onClick={() => setMobileNav(true)}><Icon name="menu" /></button>
          <div className="topbar-title"><span>{viewTitle[view]}</span><small>{company?.name}</small></div>
          <div className="user-menu">
            <div className="avatar">{user?.displayName?.slice(0, 1) ?? "م"}</div>
            <span>{user?.displayName}</span>
            <button
              aria-label="تسجيل الخروج"
              title="تسجيل الخروج"
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
        <main className="content">
          <Suspense fallback={<div className="loading"><Spinner /><span>جارٍ تحميل الوحدة…</span></div>}>
            {view === "dashboard" && <DashboardPage onNavigate={navigate} />}
            {view === "customers" && <CustomersPage notify={notify} />}
            {view === "sales" && <SalesInvoicesPage notify={notify} />}
            {view === "receipts" && <ReceiptsPage notify={notify} />}
            {view === "suppliers" && <SuppliersPage notify={notify} />}
            {view === "purchases" && <PurchaseInvoicesPage notify={notify} />}
            {view === "payments" && <PaymentsPage notify={notify} />}
            {view === "journals" && <ManualJournalsPage notify={notify} />}
            {view === "fiscal" && <FiscalPage notify={notify} />}
            {view === "accounts" && <AccountsPage notify={notify} />}
            {view === "treasury" && <TreasuryPage notify={notify} />}
            {view === "reports" && <ReportsPage />}
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

function LoginScreen({ onLoggedIn }: { onLoggedIn: (user: User) => Promise<void> }) {
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
        setError("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
      else if (cause instanceof ApiError && cause.code === "ACCOUNT_LOCKED")
        setError("الحساب مقفل مؤقتًا بسبب محاولات دخول متكررة.");
      else setError(cause instanceof Error ? cause.message : "تعذر تسجيل الدخول.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="auth-layout" dir="rtl">
      <section className="auth-story">
        <div className="auth-brand"><div className="brand-mark">{productMark}</div><span>{productName}</span></div>
        <div>
          <span className="section-kicker light">مساحة عمل مالية متكاملة</span>
          <h1>وضوح في الأرقام.<br />ثقة في القرار.</h1>
          <p>أدر مورديك ومدفوعاتك ضمن دورة محاسبية آمنة، موثقة، ومعزولة لكل شركة.</p>
        </div>
        <small>جميع العمليات الحساسة محمية بالصلاحيات وسجل التدقيق.</small>
      </section>
      <section className="auth-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-auth-brand"><div className="brand-mark">{productMark}</div><strong>{productShortName}</strong></div>
          <span className="section-kicker">مرحبًا بعودتك</span>
          <h2>تسجيل الدخول</h2>
          <p>أدخل بيانات حسابك للوصول إلى مساحة الشركة.</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <label><span>البريد الإلكتروني</span><input name="email" type="email" dir="ltr" autoComplete="username" defaultValue="admin@mcap.local" required /></label>
          <label><span>كلمة المرور</span><input name="password" type="password" dir="ltr" autoComplete="current-password" required /></label>
          <Button type="submit" disabled={loading}>{loading ? "جارٍ التحقق…" : "دخول آمن"}</Button>
          <small>تُحدد كلمة مرور حساب التطوير من إعداد <code>SEED_ADMIN_PASSWORD</code>.</small>
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
  return (
    <main className="company-screen" dir="rtl">
      <div className="brand"><div className="brand-mark">{productMark}</div><div><strong>{productShortName}</strong><span>اختر مساحة العمل</span></div></div>
      <section>
        <span className="section-kicker">الشركات المتاحة</span>
        <h1>أي شركة تريد فتحها؟</h1>
        <p>ستُعزل جميع البيانات والعمليات وفق الشركة المختارة.</p>
        <div className="company-grid">
          {companies.map((item) => (
            <button key={item.id} onClick={() => onSelect(item)}>
              <Icon name="building" size={28} />
              <div><strong>{item.name}</strong><span>فتح مساحة العمل</span></div>
              <Icon name="back" />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
