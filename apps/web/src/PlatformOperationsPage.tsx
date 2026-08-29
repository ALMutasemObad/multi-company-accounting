import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, idempotencyKey } from "./api";
import { activeIntlLocale, useI18n, type TranslationKey } from "./i18n";
import { formatCurrencyDecimal, isPositiveDecimal, isZeroDecimal } from "./decimal-format";
import type {
  PlatformBillingAccount,
  PlatformBillingInvoice,
  PlatformBillingSummary,
  PlatformCompanyBilling,
  PlatformCompanyDetails,
  PlatformCompanyList,
  PlatformOverview,
} from "./types";
import { Button, EmptyState, Icon, Modal, PageHeader, Spinner } from "./ui";
import { PlatformAnalyticsDashboardView } from "./PlatformAnalyticsDashboard";

type PlatformTab = "overview" | "companies" | "billing";
type CompanyTarget = { id: string; name: string };

const moduleLabels: Record<PlatformOverview["modules"][number]["code"], TranslationKey> = {
  SALES: "nav.sales", PURCHASES: "nav.purchases", TREASURY: "nav.treasury", POS: "nav.pos",
  INVENTORY: "nav.inventory", PROJECTS: "nav.professionalProjects", HR: "nav.humanResources",
  APPROVALS: "nav.approvals", IMPORTS: "nav.imports",
};

const accountStatusLabels: Record<PlatformBillingAccount["status"], TranslationKey> = {
  TRIAL: "platform.billing.status.TRIAL", ACTIVE: "platform.billing.status.ACTIVE",
  PAUSED: "platform.billing.status.PAUSED", CLOSED: "platform.billing.status.CLOSED",
};

const invoiceStatusLabels: Record<PlatformBillingInvoice["status"], TranslationKey> = {
  ISSUED: "platform.invoice.status.ISSUED", PARTIALLY_PAID: "platform.invoice.status.PARTIALLY_PAID",
  PAID: "platform.invoice.status.PAID", OVERDUE: "platform.invoice.status.OVERDUE", VOID: "platform.invoice.status.VOID",
};

const lineTypeLabels: Record<PlatformBillingInvoice["lines"][number]["lineType"], TranslationKey> = {
  RECURRING_FEE: "platform.invoice.line.RECURRING_FEE",
  ADDITIONAL_USERS: "platform.invoice.line.ADDITIONAL_USERS",
  ADDITIONAL_EMPLOYEES: "platform.invoice.line.ADDITIONAL_EMPLOYEES",
  ADDITIONAL_POSTED_DOCUMENTS: "platform.invoice.line.ADDITIONAL_POSTED_DOCUMENTS",
  ADJUSTMENT: "platform.invoice.line.ADJUSTMENT",
};

const isoDate = (value = new Date()) => value.toISOString().slice(0, 10);
const monthRange = () => {
  const now = new Date();
  return {
    start: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    end: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
  };
};

export function PlatformOperationsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<PlatformTab>("overview");
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [target, setTarget] = useState<CompanyTarget | null>(null);
  const [revision, setRevision] = useState(0);

  return <section className="workspace-page platform-page">
    <PageHeader
      kicker={t("platform.kicker")}
      title={t("platform.title")}
      description={t("platform.description")}
      actions={tab === "overview" ? undefined : <div className="platform-actions">
        <label><span>{t("platform.window")}</span><select value={days} onChange={(event) => setDays(Number(event.target.value) as 7 | 30 | 90)}>
          <option value={7}>{t("platform.days7")}</option><option value={30}>{t("platform.days30")}</option><option value={90}>{t("platform.days90")}</option>
        </select></label>
      </div>}
    />
    <nav className="platform-tabs" aria-label={t("platform.tabsAria")}>
      {(["overview", "companies", "billing"] as PlatformTab[]).map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{t(`platform.tab.${item}`)}</button>)}
    </nav>
    {tab === "overview" && <PlatformAnalyticsDashboardView revision={revision} onOpenCompany={setTarget} />}
    {tab === "companies" && <CompaniesTab days={days} revision={revision} onOpen={setTarget} />}
    {tab === "billing" && <BillingTab revision={revision} onOpen={setTarget} />}
    {target && <CompanyWorkspace company={target} days={days} onClose={() => setTarget(null)} onChanged={() => setRevision((value) => value + 1)} />}
  </section>;
}

function CompaniesTab({ days, revision, onOpen }: { days: 7 | 30 | 90; revision: number; onOpen: (target: CompanyTarget) => void }) {
  const { formatNumber, t } = useI18n();
  const [result, setResult] = useState<PlatformCompanyList | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ days: String(days), status, page: String(page), pageSize: "25" });
      if (appliedSearch) params.set("search", appliedSearch);
      setResult(await api<PlatformCompanyList>(`/platform/companies?${params}`));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platform.loadError")); }
    finally { setLoading(false); }
  }, [appliedSearch, days, page, revision, status, t]);
  useEffect(() => { void load(); }, [load]);
  return <div className="platform-tab-content">
    <article className="panel platform-list-panel">
      <header><div><h2>{t("platform.companies.title")}</h2><p>{t("platform.companies.description")}</p></div><span className="code-pill">{formatNumber(result?.total ?? 0)}</span></header>
      <form className="platform-filterbar" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search.trim()); }}>
        <label className="platform-search"><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("platform.companies.search")} /></label>
        <select aria-label={t("platform.companies.status")} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="ALL">{t("platform.companies.all")}</option><option value="ACTIVE">{t("platform.companies.active")}</option><option value="INACTIVE">{t("platform.companies.inactive")}</option></select>
        <Button type="submit" variant="secondary">{t("platform.companies.filter")}</Button>
      </form>
      {error && <div className="form-error" role="alert">{error}</div>}
      {loading && !result ? <Spinner label={t("platform.loading")} /> : result?.data.length ? <Table><thead><tr><th>{t("platform.company")}</th><th>{t("platform.companies.users")}</th><th>{t("platform.companies.employees")}</th><th>{t("platform.companies.documents")}</th><th>{t("platform.operations")}</th><th>{t("platform.lastActivity")}</th><th /></tr></thead><tbody>{result.data.map((company) => <tr key={company.id}><td><strong>{company.name}</strong><small>{company.organizationName} · <span dir="ltr">{company.code}</span></small></td><td>{formatNumber(company.activeUsers)}</td><td>{formatNumber(company.activeEmployees)}</td><td>{formatNumber(company.postedDocuments)}</td><td>{formatNumber(company.operations)}</td><td>{company.lastActivityAt ? new Date(company.lastActivityAt).toLocaleString(activeIntlLocale()) : "—"}</td><td><Button variant="ghost" onClick={() => onOpen(company)}>{t("platform.companies.open")}</Button></td></tr>)}</tbody></Table> : <EmptyState title={t("platform.companies.empty")} description={t("platform.companies.emptyDescription")} />}
      {result && result.total > result.pageSize && <div className="platform-pagination"><Button variant="ghost" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t("common.previous")}</Button><span>{formatNumber(page)} / {formatNumber(Math.ceil(result.total / result.pageSize))}</span><Button variant="ghost" disabled={page >= Math.ceil(result.total / result.pageSize)} onClick={() => setPage((value) => value + 1)}>{t("common.next")}</Button></div>}
    </article>
  </div>;
}

function BillingTab({ revision, onOpen }: { revision: number; onOpen: (target: CompanyTarget) => void }) {
  const { formatNumber, t } = useI18n();
  const [summary, setSummary] = useState<PlatformBillingSummary | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setSummary(await api<PlatformBillingSummary>(`/platform/billing/summary?page=${page}&pageSize=10`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("platform.billing.loadError")); }
    finally { setLoading(false); }
  }, [page, revision, t]);
  useEffect(() => { void load(); }, [load]);
  if (loading && !summary) return <Spinner label={t("platform.billing.loading")} />;
  if (!summary) return <ErrorPanel error={error} onRetry={load} />;
  return <div className="platform-tab-content">
    <div className="platform-metric-grid platform-billing-metrics">
      <Metric icon="building" label={t("platform.billing.configured")} value={formatNumber(summary.metrics.configuredCompanies)} hint={t("platform.billing.unconfiguredHint", { value1: summary.metrics.unconfiguredCompanies })} />
      <Metric icon="check" label={t("platform.billing.activeAccounts")} value={formatNumber(summary.metrics.activeAccounts)} hint={t("platform.billing.activeAccountsHint")} />
      <Metric icon="audit" label={t("platform.billing.overdueInvoices")} value={formatNumber(summary.metrics.overdueInvoices)} hint={t("platform.billing.overdueInvoicesHint")} tone={summary.metrics.overdueInvoices ? "warning" : "positive"} />
    </div>
    <div className="platform-currency-grid">{summary.currencies.map((currency) => <article className="panel platform-currency-card" key={currency.currencyCode}><header><div><h2 dir="ltr">{currency.currencyCode}</h2><p>{t("platform.billing.currencyLedger")}</p></div><strong>{currency.collectionRate}%</strong></header><div className="platform-financial-grid"><MoneyStat label={t("platform.billing.mrr")} value={formatMoney(currency.recurringMonthly, currency.currencyCode)} /><MoneyStat label={t("platform.billing.billed")} value={formatMoney(currency.billed, currency.currencyCode)} /><MoneyStat label={t("platform.billing.paid")} value={formatMoney(currency.paid, currency.currencyCode)} /><MoneyStat label={t("platform.billing.balance")} value={formatMoney(currency.balance, currency.currencyCode)} /><MoneyStat label={t("platform.billing.overdue")} value={formatMoney(currency.overdue, currency.currencyCode)} /></div></article>)}</div>
    <article className="panel platform-list-panel"><header><div><h2>{t("platform.billing.accountsTitle")}</h2><p>{t("platform.billing.accountsDescription")}</p></div><Button variant="secondary" disabled={loading} onClick={() => void load()}>{t("platform.refresh")}</Button></header>{error && <div className="form-error" role="alert">{error}</div>}{summary.accounts.length ? <Table><thead><tr><th>{t("platform.company")}</th><th>{t("platform.billing.plan")}</th><th>{t("platform.billing.nextDate")}</th><th>{t("platform.billing.billed")}</th><th>{t("platform.billing.paid")}</th><th>{t("platform.billing.balance")}</th><th>{t("platform.billing.overdue")}</th><th /></tr></thead><tbody>{summary.accounts.map((row) => <tr key={row.companyId}><td><strong>{row.companyName}</strong><small><StatusBadge status={row.account.status}>{t(accountStatusLabels[row.account.status])}</StatusBadge></small></td><td>{row.account.planName}<small dir="ltr">{row.account.currencyCode}</small></td><td>{row.account.nextBillingDate ?? "—"}</td><td>{formatMoney(row.billed, row.account.currencyCode)}</td><td>{formatMoney(row.paid, row.account.currencyCode)}</td><td><strong>{formatMoney(row.balance, row.account.currencyCode)}</strong></td><td className={isPositiveDecimal(row.overdue) ? "platform-overdue" : ""}>{formatMoney(row.overdue, row.account.currencyCode)}</td><td><Button variant="ghost" onClick={() => onOpen({ id: row.companyId, name: row.companyName })}>{t("platform.billing.manage")}</Button></td></tr>)}</tbody></Table> : <EmptyState title={t("platform.billing.empty")} description={t("platform.billing.emptyDescription")} />}{summary.meta.totalPages > 1 && <div className="platform-pagination"><Button variant="ghost" disabled={summary.meta.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t("common.previous")}</Button><span>{formatNumber(summary.meta.page)} / {formatNumber(summary.meta.totalPages)}</span><Button variant="ghost" disabled={summary.meta.page >= summary.meta.totalPages} onClick={() => setPage((value) => value + 1)}>{t("common.next")}</Button></div>}</article>
  </div>;
}

function CompanyWorkspace({ company, days, onClose, onChanged }: { company: CompanyTarget; days: 7 | 30 | 90; onClose: () => void; onChanged: () => void }) {
  const { formatNumber, t } = useI18n();
  const [details, setDetails] = useState<PlatformCompanyDetails | null>(null);
  const [billing, setBilling] = useState<PlatformCompanyBilling | null>(null);
  const [invoicePage, setInvoicePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accountEditor, setAccountEditor] = useState(false);
  const [invoiceEditor, setInvoiceEditor] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<PlatformBillingInvoice | null>(null);
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [companyDetails, companyBilling] = await Promise.all([
        api<PlatformCompanyDetails>(`/platform/companies/${company.id}?days=${days}`),
        api<PlatformCompanyBilling>(`/platform/companies/${company.id}/billing?page=${invoicePage}&pageSize=10`),
      ]);
      setDetails(companyDetails); setBilling(companyBilling);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platform.loadError")); }
    finally { setLoading(false); }
  }, [company.id, days, invoicePage, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setInvoicePage(1); setExpandedInvoice(null); }, [company.id]);
  const changed = async () => { await load(); onChanged(); };
  const voidInvoice = async (invoice: PlatformBillingInvoice) => {
    const reason = window.prompt(t("platform.invoice.voidPrompt"));
    if (!reason || reason.trim().length < 3) return;
    setError("");
    try {
      await api(`/platform/invoices/${invoice.id}/void`, { method: "POST", idempotencyKey: idempotencyKey("platform-invoice-void", invoice.id), body: JSON.stringify({ version: invoice.version, reason: reason.trim() }) });
      await changed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platform.billing.loadError")); }
  };
  return <>
    <Modal wide title={company.name} description={details ? `${details.organizationName} · ${details.code}` : undefined} onClose={onClose}>
      {loading && !details ? <Spinner label={t("platform.loading")} /> : !details || !billing ? <ErrorPanel error={error} onRetry={load} /> : <div className="platform-company-workspace">
        <div className="platform-company-actions"><div><StatusBadge status={details.isActive ? "ACTIVE" : "CLOSED"}>{details.isActive ? t("platform.companies.active") : t("platform.companies.inactive")}</StatusBadge><span dir="ltr">{details.baseCurrencyCode} · {details.timezone}</span></div><div><Button variant="secondary" icon="settings" onClick={() => setAccountEditor(true)}>{billing.account ? t("platform.billing.editAccount") : t("platform.billing.createAccount")}</Button><Button icon="plus" disabled={!billing.account} onClick={() => setInvoiceEditor(true)}>{t("platform.invoice.issue")}</Button></div></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="platform-detail-metrics">
          <MoneyStat label={t("platform.companies.users")} value={formatNumber(details.metrics.activeUsers)} hint={t("platform.company.totalHint", { value1: details.metrics.totalUsers })} />
          <MoneyStat label={t("platform.companies.employees")} value={formatNumber(details.metrics.activeEmployees)} hint={t("platform.company.totalHint", { value1: details.metrics.totalEmployees })} />
          <MoneyStat label={t("platform.metric.sessions")} value={formatNumber(details.metrics.activeSessions)} />
          <MoneyStat label={t("platform.companies.documents")} value={formatNumber(details.metrics.postedDocuments)} hint={t("platform.company.totalHint", { value1: details.metrics.totalDocuments })} />
          <MoneyStat label={t("platform.operations")} value={formatNumber(details.metrics.operations)} />
          <MoneyStat label={t("platform.metric.alerts")} value={formatNumber(details.metrics.securityAlerts)} />
        </div>
        <section className="platform-billing-band"><div><span>{t("platform.billing.billed")}</span><strong>{formatMoney(billing.totals.billed, billing.account?.currencyCode ?? details.baseCurrencyCode)}</strong></div><div><span>{t("platform.billing.paid")}</span><strong>{formatMoney(billing.totals.paid, billing.account?.currencyCode ?? details.baseCurrencyCode)}</strong></div><div><span>{t("platform.billing.balance")}</span><strong>{formatMoney(billing.totals.balance, billing.account?.currencyCode ?? details.baseCurrencyCode)}</strong></div><div className={isPositiveDecimal(billing.totals.overdue) ? "attention" : ""}><span>{t("platform.billing.overdue")}</span><strong>{formatMoney(billing.totals.overdue, billing.account?.currencyCode ?? details.baseCurrencyCode)}</strong></div></section>
        <div className="platform-company-columns">
          <section><h3>{t("platform.company.moduleUsage")}</h3><div className="platform-compact-list">{details.modules.map((module) => <div key={module.code}><span>{t(moduleLabels[module.code])}</span><strong>{formatNumber(module.recent)}</strong><small>{formatNumber(module.total)}</small></div>)}</div></section>
          <section><h3>{t("platform.company.documentTypes")}</h3>{details.documentsByType.length ? <div className="platform-compact-list">{details.documentsByType.slice(0, 9).map((document) => <div key={document.type}><span dir="ltr">{document.type}</span><strong>{formatNumber(document.posted)}</strong><small>{formatNumber(document.total)}</small></div>)}</div> : <EmptyState title={t("platform.noActivity")} description={t("platform.noActivityDescription")} />}</section>
        </div>
        <section className="platform-invoice-section"><div className="subsection-heading"><div><h3>{t("platform.invoice.history")}</h3><p>{t("platform.invoice.historyDescription")}</p></div></div>{billing.invoices.length ? <div className="platform-invoice-list">{billing.invoices.map((invoice) => <article key={invoice.id} className={`platform-invoice-card ${invoice.status.toLowerCase()}`}><button type="button" onClick={() => setExpandedInvoice(expandedInvoice === invoice.id ? null : invoice.id)}><div><strong dir="ltr">{invoice.invoiceNumber}</strong><span>{invoice.periodStart} — {invoice.periodEnd}</span></div><StatusBadge status={invoice.status}>{t(invoiceStatusLabels[invoice.status])}</StatusBadge><div><strong>{formatMoney(invoice.totalAmount, invoice.currencyCode)}</strong><span>{t("platform.invoice.balanceValue", { value1: formatMoney(invoice.balance, invoice.currencyCode) })}</span></div></button>{expandedInvoice === invoice.id && <div className="platform-invoice-detail"><div className="platform-detail-metrics compact"><MoneyStat label={t("platform.invoice.users")} value={formatNumber(invoice.usage.users)} /><MoneyStat label={t("platform.invoice.employees")} value={formatNumber(invoice.usage.employees)} /><MoneyStat label={t("platform.invoice.documents")} value={formatNumber(invoice.usage.postedDocuments)} /><MoneyStat label={t("platform.operations")} value={formatNumber(invoice.usage.operations)} /></div><Table><thead><tr><th>{t("platform.invoice.line")}</th><th>{t("platform.invoice.quantity")}</th><th>{t("platform.invoice.unitPrice")}</th><th>{t("platform.invoice.amount")}</th></tr></thead><tbody>{invoice.lines.map((line) => <tr key={line.id}><td>{line.lineType === "ADJUSTMENT" ? line.description : t(lineTypeLabels[line.lineType])}</td><td>{formatNumber(line.quantity)}</td><td>{formatMoney(line.unitPrice, invoice.currencyCode)}</td><td>{formatMoney(line.amount, invoice.currencyCode)}</td></tr>)}</tbody></Table><div className="platform-invoice-actions"><span>{t("platform.invoice.dueDate", { value1: invoice.dueDate })}</span>{invoice.state === "ISSUED" && isPositiveDecimal(invoice.balance) && <Button variant="secondary" onClick={() => setPaymentInvoice(invoice)}>{t("platform.payment.record")}</Button>}{invoice.state === "ISSUED" && invoice.paymentCount === 0 && <Button variant="danger" onClick={() => void voidInvoice(invoice)}>{t("platform.invoice.void")}</Button>}</div>{invoice.paymentCount > 0 && <div className="platform-payment-list"><h4>{t("platform.payment.history")} ({formatNumber(invoice.payments.length)} / {formatNumber(invoice.paymentCount)})</h4>{invoice.payments.map((payment) => <div key={payment.id}><span>{payment.paymentDate} · {t(`platform.payment.method.${payment.method}`)}</span><strong>{formatMoney(payment.amount, invoice.currencyCode)}</strong><small>{payment.reference ?? "—"}</small></div>)}</div>}</div>}</article>)}</div> : <EmptyState title={t("platform.invoice.empty")} description={t("platform.invoice.emptyDescription")} />}{billing.meta.totalPages > 1 && <div className="platform-pagination"><Button variant="ghost" disabled={billing.meta.page <= 1} onClick={() => { setExpandedInvoice(null); setInvoicePage((value) => Math.max(1, value - 1)); }}>{t("common.previous")}</Button><span>{formatNumber(billing.meta.page)} / {formatNumber(billing.meta.totalPages)}</span><Button variant="ghost" disabled={billing.meta.page >= billing.meta.totalPages} onClick={() => { setExpandedInvoice(null); setInvoicePage((value) => value + 1); }}>{t("common.next")}</Button></div>}</section>
      </div>}
    </Modal>
    {accountEditor && billing && <AccountForm companyId={company.id} account={billing.account} defaultCurrency={details?.baseCurrencyCode ?? "SAR"} onClose={() => setAccountEditor(false)} onSaved={async () => { setAccountEditor(false); await changed(); }} />}
    {invoiceEditor && <InvoiceForm companyId={company.id} onClose={() => setInvoiceEditor(false)} onSaved={async () => { setInvoiceEditor(false); await changed(); }} />}
    {paymentInvoice && <PaymentForm invoice={paymentInvoice} onClose={() => setPaymentInvoice(null)} onSaved={async () => { setPaymentInvoice(null); await changed(); }} />}
  </>;
}

function AccountForm({ companyId, account, defaultCurrency, onClose, onSaved }: { companyId: string; account: PlatformBillingAccount | null; defaultCurrency: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [value, setValue] = useState({
    status: account?.status ?? "ACTIVE", planName: account?.planName ?? "", billingCycle: account?.billingCycle ?? "MONTHLY",
    currencyCode: account?.currencyCode ?? defaultCurrency, recurringFee: account?.recurringFee ?? "0",
    includedUsers: String(account?.includedUsers ?? 0), pricePerAdditionalUser: account?.pricePerAdditionalUser ?? "0",
    includedEmployees: String(account?.includedEmployees ?? 0), pricePerAdditionalEmployee: account?.pricePerAdditionalEmployee ?? "0",
    includedPostedDocuments: String(account?.includedPostedDocuments ?? 0), pricePerAdditionalPostedDocument: account?.pricePerAdditionalPostedDocument ?? "0",
    taxRate: account?.taxRate ?? "0", paymentTermsDays: String(account?.paymentTermsDays ?? 30),
    nextBillingDate: account?.nextBillingDate ?? "", notes: account?.notes ?? "",
  });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const set = (key: keyof typeof value, next: string) => setValue((current) => ({ ...current, [key]: next }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await api(`/platform/companies/${companyId}/billing-account`, {
        method: "PUT", idempotencyKey: idempotencyKey("platform-billing-account", companyId),
        body: JSON.stringify({ ...value, currencyCode: value.currencyCode.toUpperCase(), includedUsers: Number(value.includedUsers), includedEmployees: Number(value.includedEmployees), includedPostedDocuments: Number(value.includedPostedDocuments), paymentTermsDays: Number(value.paymentTermsDays), nextBillingDate: value.nextBillingDate || null, notes: value.notes.trim() || null, version: account?.version ?? 0 }),
      });
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platform.billing.saveError")); }
    finally { setSaving(false); }
  };
  return <Modal wide title={account ? t("platform.billing.editAccount") : t("platform.billing.createAccount")} description={t("platform.billing.accountDescription")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid platform-account-form">
    <Field label={t("platform.billing.plan")}><input aria-label={t("platform.billing.plan")} value={value.planName} onChange={(event) => set("planName", event.target.value)} maxLength={160} required /></Field>
    <Field label={t("platform.billing.accountStatus")}><select aria-label={t("platform.billing.accountStatus")} value={value.status} onChange={(event) => set("status", event.target.value)}>{Object.keys(accountStatusLabels).map((status) => <option key={status} value={status}>{t(accountStatusLabels[status as PlatformBillingAccount["status"]])}</option>)}</select></Field>
    <Field label={t("platform.billing.cycle")}><select aria-label={t("platform.billing.cycle")} value={value.billingCycle} onChange={(event) => set("billingCycle", event.target.value)}><option value="MONTHLY">{t("platform.billing.cycle.MONTHLY")}</option><option value="QUARTERLY">{t("platform.billing.cycle.QUARTERLY")}</option><option value="ANNUAL">{t("platform.billing.cycle.ANNUAL")}</option></select></Field>
    <Field label={t("platform.billing.currency")}><input aria-label={t("platform.billing.currency")} dir="ltr" value={value.currencyCode} onChange={(event) => set("currencyCode", event.target.value.toUpperCase())} pattern="[A-Z]{3}" maxLength={3} required /></Field>
    <Field label={t("platform.billing.recurringFee")}><MoneyInput ariaLabel={t("platform.billing.recurringFee")} value={value.recurringFee} onChange={(next) => set("recurringFee", next)} /></Field>
    <Field label={t("platform.billing.taxRate")}><MoneyInput ariaLabel={t("platform.billing.taxRate")} value={value.taxRate} onChange={(next) => set("taxRate", next)} /></Field>
    <Field label={t("platform.billing.includedUsers")}><NumberInput ariaLabel={t("platform.billing.includedUsers")} value={value.includedUsers} onChange={(next) => set("includedUsers", next)} /></Field>
    <Field label={t("platform.billing.extraUserPrice")}><MoneyInput ariaLabel={t("platform.billing.extraUserPrice")} value={value.pricePerAdditionalUser} onChange={(next) => set("pricePerAdditionalUser", next)} /></Field>
    <Field label={t("platform.billing.includedEmployees")}><NumberInput ariaLabel={t("platform.billing.includedEmployees")} value={value.includedEmployees} onChange={(next) => set("includedEmployees", next)} /></Field>
    <Field label={t("platform.billing.extraEmployeePrice")}><MoneyInput ariaLabel={t("platform.billing.extraEmployeePrice")} value={value.pricePerAdditionalEmployee} onChange={(next) => set("pricePerAdditionalEmployee", next)} /></Field>
    <Field label={t("platform.billing.includedDocuments")}><NumberInput ariaLabel={t("platform.billing.includedDocuments")} value={value.includedPostedDocuments} onChange={(next) => set("includedPostedDocuments", next)} /></Field>
    <Field label={t("platform.billing.extraDocumentPrice")}><MoneyInput ariaLabel={t("platform.billing.extraDocumentPrice")} value={value.pricePerAdditionalPostedDocument} onChange={(next) => set("pricePerAdditionalPostedDocument", next)} /></Field>
    <Field label={t("platform.billing.paymentTerms")}><NumberInput ariaLabel={t("platform.billing.paymentTerms")} value={value.paymentTermsDays} onChange={(next) => set("paymentTermsDays", next)} max={365} /></Field>
    <Field label={t("platform.billing.nextDate")}><input aria-label={t("platform.billing.nextDate")} type="date" value={value.nextBillingDate} onChange={(event) => set("nextBillingDate", event.target.value)} /></Field>
    <Field label={t("platform.billing.notes")} full><textarea aria-label={t("platform.billing.notes")} rows={3} value={value.notes} onChange={(event) => set("notes", event.target.value)} maxLength={1000} /></Field>
  </div><FormActions saving={saving} onClose={onClose} /></form></Modal>;
}

function InvoiceForm({ companyId, onClose, onSaved }: { companyId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n(); const range = useMemo(monthRange, []);
  const [periodStart, setPeriodStart] = useState(range.start); const [periodEnd, setPeriodEnd] = useState(range.end);
  const [issueDate, setIssueDate] = useState(isoDate()); const [notes, setNotes] = useState("");
  const [adjustments, setAdjustments] = useState<Array<{ description: string; amount: string }>>([]);
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await api(`/platform/companies/${companyId}/invoices`, { method: "POST", idempotencyKey: idempotencyKey("platform-invoice", companyId), body: JSON.stringify({ periodStart, periodEnd, issueDate, notes: notes.trim() || null, adjustments: adjustments.filter((item) => item.description.trim() && !isZeroDecimal(item.amount)) }) });
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platform.invoice.issueError")); }
    finally { setSaving(false); }
  };
  return <Modal wide title={t("platform.invoice.issue")} description={t("platform.invoice.issueDescription")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="inline-notice neutral">{t("platform.invoice.snapshotNotice")}</div><div className="form-grid"><Field label={t("platform.invoice.periodStart")}><input aria-label={t("platform.invoice.periodStart")} type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} required /></Field><Field label={t("platform.invoice.periodEnd")}><input aria-label={t("platform.invoice.periodEnd")} type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} required /></Field><Field label={t("platform.invoice.issueDate")}><input aria-label={t("platform.invoice.issueDate")} type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required /></Field><Field label={t("platform.billing.notes")} full><textarea aria-label={t("platform.billing.notes")} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} /></Field></div><div className="subsection-heading"><h3>{t("platform.invoice.adjustments")}</h3><Button type="button" variant="secondary" icon="plus" disabled={adjustments.length >= 20} onClick={() => setAdjustments((items) => [...items, { description: "", amount: "0" }])}>{t("platform.invoice.addAdjustment")}</Button></div>{adjustments.map((adjustment, index) => <div className="platform-adjustment-row" key={index}><input aria-label={t("platform.invoice.adjustmentDescription")} value={adjustment.description} onChange={(event) => setAdjustments((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} maxLength={255} required /><input aria-label={t("platform.invoice.amount")} dir="ltr" inputMode="decimal" value={adjustment.amount} onChange={(event) => setAdjustments((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} pattern="-?[0-9]+([.][0-9]{1,4})?" required /><Button type="button" variant="ghost" icon="trash" aria-label={t("platform.invoice.removeAdjustment")} onClick={() => setAdjustments((items) => items.filter((_, itemIndex) => itemIndex !== index))} /></div>)}<FormActions saving={saving} onClose={onClose} /></form></Modal>;
}

function PaymentForm({ invoice, onClose, onSaved }: { invoice: PlatformBillingInvoice; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n(); const [paymentDate, setPaymentDate] = useState(isoDate()); const [amount, setAmount] = useState(invoice.balance);
  const [method, setMethod] = useState("BANK_TRANSFER"); const [reference, setReference] = useState(""); const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await api(`/platform/invoices/${invoice.id}/payments`, { method: "POST", idempotencyKey: idempotencyKey("platform-payment", invoice.id), body: JSON.stringify({ invoiceVersion: invoice.version, paymentDate, amount, method, reference: reference.trim() || null, notes: notes.trim() || null }) });
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platform.payment.saveError")); }
    finally { setSaving(false); }
  };
  return <Modal title={t("platform.payment.record")} description={`${invoice.invoiceNumber} · ${formatMoney(invoice.balance, invoice.currencyCode)}`} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><Field label={t("platform.payment.date")}><input aria-label={t("platform.payment.date")} type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></Field><Field label={t("platform.payment.amount")}><MoneyInput ariaLabel={t("platform.payment.amount")} value={amount} onChange={setAmount} /></Field><Field label={t("platform.payment.method")}><select aria-label={t("platform.payment.method")} value={method} onChange={(event) => setMethod(event.target.value)}><option value="BANK_TRANSFER">{t("platform.payment.method.BANK_TRANSFER")}</option><option value="CARD">{t("platform.payment.method.CARD")}</option><option value="CASH">{t("platform.payment.method.CASH")}</option><option value="OTHER">{t("platform.payment.method.OTHER")}</option></select></Field><Field label={t("platform.payment.reference")}><input aria-label={t("platform.payment.reference")} dir="ltr" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={160} /></Field><Field label={t("platform.billing.notes")} full><textarea aria-label={t("platform.billing.notes")} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} /></Field></div><FormActions saving={saving} onClose={onClose} /></form></Modal>;
}

function formatMoney(value: string, currency: string) {
  return formatCurrencyDecimal(value, currency, activeIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function Table({ children }: { children: ReactNode }) { const { t } = useI18n(); return <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table">{children}</table></div>; }
function Health({ label, value, good }: { label: string; value: string; good: boolean }) { return <div><span className={good ? "health-dot good" : "health-dot attention"} /><span>{label}</span><strong>{value}</strong></div>; }
function Metric({ icon, label, value, hint, tone }: { icon: "building" | "check" | "audit"; label: string; value: string; hint: string; tone?: string }) { return <article className={`platform-metric ${tone ?? ""}`}><span className="platform-metric-icon"><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong><span>{hint}</span></div></article>; }
function MoneyStat({ label, value, hint }: { label: string; value: string; hint?: string }) { return <div className="platform-money-stat"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>; }
function StatusBadge({ status, children }: { status: string; children: ReactNode }) { return <span className={`platform-status ${status.toLowerCase()}`}>{children}</span>; }
function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) { return <label className={full ? "full" : undefined}><span>{label}</span>{children}</label>; }
function MoneyInput({ ariaLabel, value, onChange }: { ariaLabel: string; value: string; onChange: (value: string) => void }) { return <input aria-label={ariaLabel} dir="ltr" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} pattern="[0-9]+([.][0-9]{1,4})?" required />; }
function NumberInput({ ariaLabel, value, onChange, max = 100000000 }: { ariaLabel: string; value: string; onChange: (value: string) => void; max?: number }) { return <input aria-label={ariaLabel} dir="ltr" type="number" min="0" max={max} value={value} onChange={(event) => onChange(event.target.value)} required />; }
function FormActions({ saving, onClose }: { saving: boolean; onClose: () => void }) { const { t } = useI18n(); return <div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={saving}>{saving ? t("platform.saving") : t("platform.save")}</Button></div>; }
function ErrorPanel({ error, onRetry }: { error: string; onRetry: () => void | Promise<void> }) { const { t } = useI18n(); return <div className="error-panel" role="alert"><h3>{t("platform.errorTitle")}</h3><p>{error}</p><Button onClick={() => void onRetry()}>{t("common.retry")}</Button></div>; }
