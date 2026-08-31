import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, idempotencyKey } from "./api";
import { Can } from "./authorization-context";
import { formatCurrencyDecimal, isPositiveDecimal, isZeroDecimal } from "./decimal-format";
import {
  electronicPaymentStates,
  isNavigableCheckoutUrl,
  ownerPaymentActions,
  paymentFromCommandResult,
  type BillingPage,
  type BillingPageMeta,
  type ElectronicPayment,
  type ElectronicPaymentState,
  type SubscriptionBillingInvoice,
} from "./electronic-payments";
import { useI18n } from "./i18n";
import type { SubscriptionCatalog, SubscriptionPlanVersion, SubscriptionSnapshot } from "./types";
import { Button, PageHeader, Spinner } from "./ui";
import { clearSubscriptionPlanPreference, preferredSubscriptionPlan } from "./public-plans";
import { CompanySubscriptionUsagePanel } from "./CompanySubscriptionUsagePanel";
import { resolveSubscriptionPlanSelection } from "./subscription-usage";

type Notice = (message: string, tone?: "success" | "error") => void;

const moneyText = (value: string | null, currency: string, fallback: string) =>
  value === null ? fallback : `${value} ${currency}`;

export function CompanySubscriptionPage({ notify }: { notify: Notice }) {
  const { formatDateTime, t } = useI18n();
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(null);
  const [catalog, setCatalog] = useState<SubscriptionCatalog>({ plans: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [optionalIds, setOptionalIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectionMissing, setSelectionMissing] = useState(false);
  const selectionInitialized = useRef(false);
  const selectionRef = useRef("");
  const catalogPageRef = useRef(1);
  const catalogRequest = useRef(0);

  const applyCatalog = useCallback((nextCatalog: SubscriptionCatalog) => {
    const candidate = selectionInitialized.current ? selectionRef.current : preferredSubscriptionPlan() ?? "";
    const resolved = resolveSubscriptionPlanSelection(nextCatalog.plans.map((plan) => plan.id), candidate, !selectionInitialized.current);
    if (resolved.selectedId !== selectionRef.current || resolved.missing) setOptionalIds([]);
    if (resolved.missing) setSelectionMissing(true);
    // Once a choice is missing, another page never selects a replacement (or restores it) implicitly.
    selectionInitialized.current = true;
    selectionRef.current = resolved.selectedId;
    setSelectedPlanId(resolved.selectedId);
    setCatalog(nextCatalog);
    catalogPageRef.current = nextCatalog.meta.page;
  }, []);

  const load = useCallback(async () => {
    const requestId = ++catalogRequest.current;
    setCatalogLoading(true);
    setError("");
    try {
      const [nextSnapshot, nextCatalog] = await Promise.all([
        api<SubscriptionSnapshot>("/subscription?page=1&pageSize=20"),
        api<SubscriptionCatalog>(`/subscription/catalog?page=${catalogPageRef.current}&pageSize=100`),
      ]);
      if (requestId !== catalogRequest.current) return;
      setSnapshot(nextSnapshot);
      applyCatalog(nextCatalog);
    } catch (cause) {
      if (requestId === catalogRequest.current) setError(cause instanceof Error ? cause.message : t("subscription.loadError"));
    } finally {
      if (requestId === catalogRequest.current) { setLoading(false); setCatalogLoading(false); }
    }
  }, [applyCatalog, t]);

  async function pageCatalog(page: number) {
    const requestId = ++catalogRequest.current;
    setCatalogLoading(true); setError("");
    try {
      const result = await api<SubscriptionCatalog>(`/subscription/catalog?page=${page}&pageSize=100`);
      if (requestId === catalogRequest.current) applyCatalog(result);
    } catch (cause) {
      if (requestId === catalogRequest.current) setError(cause instanceof Error ? cause.message : t("subscription.loadError"));
    } finally {
      if (requestId === catalogRequest.current) setCatalogLoading(false);
    }
  }

  useEffect(() => { void load(); }, [load]);

  const selectedPlan = useMemo(
    () => catalog.plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [catalog.plans, selectedPlanId],
  );
  const optionalModules = selectedPlan?.modules.filter((module) => module.selectionMode === "OPTIONAL" && module.active) ?? [];

  function selectPlan(id: string) {
    selectionRef.current = id;
    setSelectionMissing(false);
    setSelectedPlanId(id);
    setOptionalIds([]);
  }

  function toggleOptional(id: string) {
    if (!selectedPlan) return;
    setOptionalIds((current) => {
      const selected = new Set(current);
      if (!selected.has(id)) {
        const byId = new Map(selectedPlan.modules.map((module) => [module.id, module]));
        const visit = (moduleId: string) => {
          const module = byId.get(moduleId);
          if (!module?.active || module.selectionMode !== "OPTIONAL" || selected.has(moduleId)) return;
          selected.add(moduleId);
          module.dependencyIds.forEach((dependencyId) => {
            if (byId.get(dependencyId)?.selectionMode === "OPTIONAL") visit(dependencyId);
          });
        };
        visit(id);
      } else {
        const removed = new Set([id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const module of selectedPlan.modules) {
            if (module.selectionMode === "OPTIONAL" && selected.has(module.id) && !removed.has(module.id)
              && module.dependencyIds.some((dependencyId) => removed.has(dependencyId))) {
              removed.add(module.id); changed = true;
            }
          }
        }
        removed.forEach((moduleId) => selected.delete(moduleId));
      }
      return [...selected];
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !selectedPlan || catalogLoading || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ change: { state: string }; paymentCollected: false }>("/subscription/change-requests", {
        method: "POST",
        idempotencyKey: idempotencyKey("subscription-change", selectedPlan.id),
        body: JSON.stringify({
          targetPlanVersionId: selectedPlan.id,
          optionalModuleIds: optionalIds,
          subscriptionVersion: snapshot.subscription.version,
        }),
      });
      notify(result.change.state === "PENDING_APPROVAL"
        ? t("subscription.requestPending") : t("subscription.changeApplied"));
      clearSubscriptionPlanPreference();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("subscription.changeError"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label={t("subscription.loading")} />;
  if (!snapshot) return (
    <section className="workspace-page subscription-page">
      <PageHeader kicker={t("subscription.kicker")} title={t("subscription.title")} description={t("subscription.description")} />
      <div className="error-panel" role="alert"><h3>{t("subscription.errorTitle")}</h3><p>{error || t("subscription.loadError")}</p><Button onClick={() => void load()}>{t("common.retry")}</Button></div>
      <CompanySubscriptionUsagePanel />
    </section>
  );

  const current = snapshot.current;
  return (
    <section className="workspace-page subscription-page">
      <PageHeader
        kicker={t("subscription.kicker")}
        title={t("subscription.title")}
        description={t("subscription.description")}
        actions={<Button variant="secondary" onClick={() => void load()}>{t("common.refresh")}</Button>}
      />
      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="subscription-summary-grid">
        <article className="metric-card"><span>{t("subscription.currentPlan")}</span><strong>{current.plan.displayName}</strong><small>{current.plan.planCode} · {t("subscription.versionLabel", { value1: current.plan.versionNumber })}</small></article>
        <article className="metric-card"><span>{t("subscription.status")}</span><strong>{t(`subscription.status.${snapshot.subscription.status}`)}</strong><small>{snapshot.subscription.trialEndsAt ? t("subscription.trialUntil", { value1: formatDateTime(snapshot.subscription.trialEndsAt) }) : t("subscription.noTrial")}</small></article>
        <article className="metric-card"><span>{t("subscription.recurringFee")}</span><strong>{moneyText(current.quote.totalRecurringFee, current.quote.currencyCode, t("subscription.unpriced"))}</strong><small>{t(`subscription.cycle.${current.plan.billingCycle}`)}</small></article>
      </div>

      <CompanySubscriptionUsagePanel key={current.plan.id} />
        <section className="panel subscription-panel">
          <header><div><h2>{t("subscription.modules")}</h2><p>{t("subscription.modulesDescription")}</p></div></header>
          {snapshot.effectiveModules.length ? <ul className="subscription-module-list">{snapshot.effectiveModules.map((module) => <li key={module.id}><strong>{module.displayName}</strong><small>{module.code}</small></li>)}</ul>
            : <div className="empty-state"><h3>{t("subscription.noModules")}</h3><p>{t("subscription.noModulesDescription")}</p></div>}
        </section>

      {(snapshot.scheduled || snapshot.pending) && <section className="panel subscription-panel subscription-attention">
        <header><div><h2>{snapshot.pending ? t("subscription.pendingChange") : t("subscription.scheduledChange")}</h2><p>{snapshot.pending ? t("subscription.pendingPaymentSafe") : t("subscription.effectiveOn", { value1: formatDateTime(snapshot.scheduled!.effectiveAt!) })}</p></div></header>
        <div className="subscription-change-card">
          <strong>{(snapshot.pending ?? snapshot.scheduled)!.plan.displayName}</strong>
          <span>{moneyText((snapshot.pending ?? snapshot.scheduled)!.quote.totalRecurringFee, (snapshot.pending ?? snapshot.scheduled)!.quote.currencyCode, t("subscription.unpriced"))}</span>
        </div>
      </section>}

      <Can policy={{ permission: "subscriptions.manage" }}>
        <form className="panel subscription-panel subscription-change-form" onSubmit={submit}>
          <header><div><h2>{t("subscription.choosePlan")}</h2><p>{t("subscription.choosePlanDescription")}</p></div></header>
          {selectionMissing && <p className="subscription-catalog-notice" role="status">{t("subscriptionUsage.selectionMissing")}</p>}
          {catalog.plans.length ? <div className="subscription-form-body">
            <label><span>{t("subscription.plan")}</span><select disabled={catalogLoading || saving} value={selectedPlanId} onChange={(event) => selectPlan(event.target.value)}><option value="">{t("subscriptionUsage.selectPlan")}</option>{catalog.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.displayName} — {moneyText(plan.recurringFee, plan.currencyCode, t("subscription.unpriced"))}</option>)}</select></label>
            {selectedPlan && <PlanPreview plan={selectedPlan} t={t} />}
            {optionalModules.length > 0 && <fieldset><legend>{t("subscription.optionalModules")}</legend><div className="subscription-option-grid">{optionalModules.map((module) => <label key={module.id}><input type="checkbox" checked={optionalIds.includes(module.id)} onChange={() => toggleOptional(module.id)} /><span><strong>{module.displayName}</strong><small>{moneyText(module.additionalRecurringFee, selectedPlan!.currencyCode, t("subscription.free"))}</small></span></label>)}</div></fieldset>}
            <div className="subscription-safe-note">{t("subscription.paymentSafety")}</div>
            <Button type="submit" disabled={!selectedPlan || saving || catalogLoading}>{saving ? t("common.saving") : t("subscription.submitChange")}</Button>
          </div> : <div className="empty-state"><h3>{t("subscription.noPlans")}</h3><p>{t("subscription.noPlansDescription")}</p></div>}
          {catalog.meta.totalPages > 1 && <div className="pagination subscription-catalog-pagination">
            <Button type="button" variant="ghost" disabled={catalogLoading || saving || catalog.meta.page <= 1} onClick={() => void pageCatalog(catalog.meta.page - 1)}>{t("common.previous")}</Button>
            <span>{t("subscriptionUsage.catalogPage", { value1: catalog.meta.page, value2: catalog.meta.totalPages })}</span>
            <Button type="button" variant="ghost" disabled={catalogLoading || saving || catalog.meta.page >= catalog.meta.totalPages} onClick={() => void pageCatalog(catalog.meta.page + 1)}>{t("common.next")}</Button>
          </div>}
        </form>
      </Can>

      <SubscriptionBillingCenter notify={notify} />

      <section className="panel subscription-panel">
        <header><div><h2>{t("subscription.history")}</h2><p>{t("subscription.historyDescription")}</p></div></header>
        {snapshot.history.length ? <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("subscription.plan")}</th><th>{t("subscription.changeState")}</th><th>{t("subscription.requestedAt")}</th><th>{t("subscription.effectiveAt")}</th></tr></thead><tbody>{snapshot.history.map((item, index) => <tr key={item.id ?? `${item.requestedAt}-${index}`}><td>{item.plan.displayName}<small>{item.plan.planCode} · {t("subscription.versionLabel", { value1: item.plan.versionNumber })}</small></td><td>{t(`subscription.changeState.${item.state}`)}</td><td>{formatDateTime(item.requestedAt)}</td><td>{item.effectiveAt ? formatDateTime(item.effectiveAt) : "—"}</td></tr>)}</tbody></table></div>
          : <div className="empty-state"><h3>{t("subscription.noHistory")}</h3><p>{t("subscription.noHistoryDescription")}</p></div>}
      </section>
    </section>
  );
}

function PlanPreview({ plan, t }: { plan: SubscriptionPlanVersion; t: ReturnType<typeof useI18n>["t"] }) {
  return <div className="subscription-plan-preview"><strong>{plan.displayName}</strong><span>{plan.description || t("subscription.noDescription")}</span><small>{t(`subscription.policy.${plan.selfServicePolicy}`)}</small></div>;
}

const emptyBillingMeta: BillingPageMeta = { page: 1, pageSize: 10, total: 0, totalPages: 0 };
const invoiceStatuses = ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
type BillingInvoiceFilter = "ALL" | typeof invoiceStatuses[number];

function SubscriptionBillingCenter({ notify }: { notify: Notice }) {
  const { formatDateTime, intlLocale, t } = useI18n();
  const [invoices, setInvoices] = useState<SubscriptionBillingInvoice[]>([]);
  const [invoiceMeta, setInvoiceMeta] = useState(emptyBillingMeta);
  const [payments, setPayments] = useState<ElectronicPayment[]>([]);
  const [paymentMeta, setPaymentMeta] = useState(emptyBillingMeta);
  const [providerAvailable, setProviderAvailable] = useState(false);
  const [invoiceStatus, setInvoiceStatus] = useState<BillingInvoiceFilter>("ALL");
  const [appliedInvoiceStatus, setAppliedInvoiceStatus] = useState<BillingInvoiceFilter>("ALL");
  const [paymentState, setPaymentState] = useState<"ALL" | ElectronicPaymentState>("ALL");
  const [appliedPaymentState, setAppliedPaymentState] = useState<"ALL" | ElectronicPaymentState>("ALL");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const loadInvoices = useCallback(async (page = 1, status: BillingInvoiceFilter = appliedInvoiceStatus) => {
    const query = new URLSearchParams({ page: String(page), pageSize: "10", status });
    const result = await api<BillingPage<SubscriptionBillingInvoice>>(`/subscription/billing/invoices?${query}`);
    setProviderAvailable(result.provider.available);
    setInvoices(result.items);
    setInvoiceMeta(result.meta);
  }, [appliedInvoiceStatus]);

  const loadPayments = useCallback(async (page = 1, state: "ALL" | ElectronicPaymentState = appliedPaymentState) => {
    const query = new URLSearchParams({ page: String(page), pageSize: "10", state });
    const result = await api<BillingPage<ElectronicPayment>>(`/subscription/billing/payments?${query}`);
    setPayments(result.items);
    setPaymentMeta(result.meta);
  }, [appliedPaymentState]);

  const refresh = useCallback(async () => {
    setError("");
    try {
      await Promise.all([
        loadInvoices(invoiceMeta.page || 1),
        loadPayments(paymentMeta.page || 1),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("subscriptionBilling.loadError"));
    } finally {
      setLoading(false);
    }
  }, [invoiceMeta.page, loadInvoices, loadPayments, paymentMeta.page, t]);

  useEffect(() => { void refresh(); }, []); // The filter forms own subsequent reloads.

  async function applyInvoiceFilter(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    setAppliedInvoiceStatus(invoiceStatus);
    try { await loadInvoices(1, invoiceStatus); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("subscriptionBilling.loadError")); }
    finally { setLoading(false); }
  }

  async function applyPaymentFilter(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    setAppliedPaymentState(paymentState);
    try { await loadPayments(1, paymentState); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("subscriptionBilling.loadError")); }
    finally { setLoading(false); }
  }

  async function reloadAfterCommand() {
    await Promise.all([loadInvoices(invoiceMeta.page), loadPayments(paymentMeta.page)]);
  }

  async function pageInvoices(page: number) {
    setLoading(true); setError("");
    try { await loadInvoices(page); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("subscriptionBilling.loadError")); }
    finally { setLoading(false); }
  }

  async function pagePayments(page: number) {
    setLoading(true); setError("");
    try { await loadPayments(page); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("subscriptionBilling.loadError")); }
    finally { setLoading(false); }
  }

  async function checkout(invoice: SubscriptionBillingInvoice) {
    setBusyId(invoice.id); setError("");
    try {
      const result = await api<ElectronicPayment | { payment: ElectronicPayment }>(`/subscription/billing/invoices/${invoice.id}/checkout`, {
        method: "POST",
        idempotencyKey: idempotencyKey("subscription-checkout", invoice.id),
        body: JSON.stringify({ invoiceVersion: invoice.version }),
      });
      const payment = paymentFromCommandResult(result);
      notify(t("subscriptionBilling.checkoutCreated"));
      await reloadAfterCommand();
      if (isNavigableCheckoutUrl(payment.checkoutUrl)) window.location.assign(payment.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("subscriptionBilling.commandError"));
    } finally { setBusyId(""); }
  }

  async function paymentCommand(payment: ElectronicPayment, command: "cancel" | "retry") {
    setBusyId(payment.id); setError("");
    try {
      const result = await api<ElectronicPayment | { payment: ElectronicPayment }>(`/subscription/billing/payments/${payment.id}/${command}`, {
        method: "POST",
        idempotencyKey: idempotencyKey(`subscription-payment-${command}`, payment.id),
        body: JSON.stringify({ version: payment.version }),
      });
      const saved = paymentFromCommandResult(result);
      notify(t(command === "cancel" ? "subscriptionBilling.cancelled" : "subscriptionBilling.retried"));
      await reloadAfterCommand();
      if (command === "retry" && isNavigableCheckoutUrl(saved.checkoutUrl)) window.location.assign(saved.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("subscriptionBilling.commandError"));
    } finally { setBusyId(""); }
  }

  const money = (value: string, currency: string) => formatCurrencyDecimal(value, currency, intlLocale);
  return <section className="subscription-billing-center" aria-labelledby="subscription-billing-title">
    <header className="subscription-section-heading"><div><h2 id="subscription-billing-title">{t("subscriptionBilling.title")}</h2><p>{t("subscriptionBilling.description")}</p></div><Button variant="secondary" onClick={() => { setLoading(true); void refresh(); }}>{t("common.refresh")}</Button></header>
    {error && <div className="form-error" role="alert">{error}</div>}
    {!loading && !providerAvailable && <div className="subscription-safe-note">{t("subscriptionBilling.providerUnavailable")}</div>}
    {loading ? <Spinner label={t("subscriptionBilling.loading")} /> : <div className="subscription-billing-grid">
      <section className="panel subscription-panel">
        <header><div><h3>{t("subscriptionBilling.invoices")}</h3><p>{t("subscriptionBilling.invoicesDescription")}</p></div><span>{invoiceMeta.total}</span></header>
        <form className="subscription-payment-filter" onSubmit={applyInvoiceFilter}><label><span>{t("subscriptionBilling.invoiceStatus")}</span><select value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value as BillingInvoiceFilter)}><option value="ALL">{t("subscriptionBilling.all")}</option>{invoiceStatuses.map((status) => <option key={status} value={status}>{t(`subscriptionBilling.invoiceStatus.${status}`)}</option>)}</select></label><Button type="submit" variant="secondary">{t("subscriptionBilling.apply")}</Button></form>
        {invoices.length ? <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("subscriptionBilling.invoice")}</th><th>{t("subscriptionBilling.amounts")}</th><th>{t("subscriptionBilling.invoiceStatus")}</th><th>{t("subscriptionBilling.actions")}</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><strong dir="ltr">{invoice.invoiceNumber}</strong><small>{formatDateTime(invoice.issueDate)} · {t("subscriptionBilling.due", { value1: formatDateTime(invoice.dueDate) })}</small></td><td><strong dir="ltr">{money(invoice.totalAmount, invoice.currencyCode)}</strong><small>{t("subscriptionBilling.balance", { value1: money(invoice.balance, invoice.currencyCode) })}{!isZeroDecimal(invoice.refundedAmount) ? ` · ${t("subscriptionBilling.refunded", { value1: money(invoice.refundedAmount, invoice.currencyCode) })}` : ""}</small></td><td><span className={`platform-status ${invoice.status.toLowerCase()}`}>{t(`subscriptionBilling.invoiceStatus.${invoice.status}`)}</span>{invoice.latestPaymentState && <small><PaymentState state={invoice.latestPaymentState} /></small>}</td><td><Can policy={{ permission: "subscriptions.manage" }}>{providerAvailable && isPositiveDecimal(invoice.balance) && invoice.status !== "VOID" && <Button disabled={busyId === invoice.id} onClick={() => void checkout(invoice)}>{t("subscriptionBilling.checkout")}</Button>}</Can></td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>{t("subscriptionBilling.noInvoices")}</h3><p>{t("subscriptionBilling.noInvoicesDescription")}</p></div>}
        <BillingPager meta={invoiceMeta} onPage={(page) => void pageInvoices(page)} />
      </section>

      <section className="panel subscription-panel">
        <header><div><h3>{t("subscriptionBilling.payments")}</h3><p>{t("subscriptionBilling.paymentsDescription")}</p></div><span>{paymentMeta.total}</span></header>
        <form className="subscription-payment-filter" onSubmit={applyPaymentFilter}><label><span>{t("subscriptionBilling.paymentState")}</span><select value={paymentState} onChange={(event) => setPaymentState(event.target.value as "ALL" | ElectronicPaymentState)}><option value="ALL">{t("subscriptionBilling.all")}</option>{electronicPaymentStates.map((state) => <option key={state} value={state}>{t(`subscriptionBilling.paymentState.${state}`)}</option>)}</select></label><Button type="submit" variant="secondary">{t("subscriptionBilling.apply")}</Button></form>
        {payments.length ? <div className="subscription-payment-list">{payments.map((payment) => <article key={payment.id}><div><strong dir="ltr">{payment.invoiceNumber}</strong><span dir="ltr">{money(payment.amount, payment.currencyCode)}</span><small>{payment.provider} · {payment.environment}</small></div><div><PaymentState state={payment.state} />{payment.lastFailureCode && <small dir="ltr">{payment.lastFailureCode}</small>}<small>{formatDateTime(payment.updatedAt)}</small></div><Can policy={{ permission: "subscriptions.manage" }}><div className="row-actions">{ownerPaymentActions(payment).map((action) => action === "OPEN_CHECKOUT" ? <Button key={action} variant="secondary" onClick={() => { if (isNavigableCheckoutUrl(payment.checkoutUrl)) window.location.assign(payment.checkoutUrl); }}>{t("subscriptionBilling.continueCheckout")}</Button> : <Button key={action} variant={action === "CANCEL" ? "danger" : "primary"} disabled={busyId === payment.id} onClick={() => void paymentCommand(payment, action === "CANCEL" ? "cancel" : "retry")}>{t(action === "CANCEL" ? "subscriptionBilling.cancel" : "subscriptionBilling.retry")}</Button>)}</div></Can></article>)}</div> : <div className="empty-state"><h3>{t("subscriptionBilling.noPayments")}</h3><p>{t("subscriptionBilling.noPaymentsDescription")}</p></div>}
        <BillingPager meta={paymentMeta} onPage={(page) => void pagePayments(page)} />
      </section>
    </div>}
  </section>;
}

function PaymentState({ state }: { state: ElectronicPaymentState }) {
  const { t } = useI18n();
  return <span className={`payment-state ${state.toLowerCase()}`}>{t(`subscriptionBilling.paymentState.${state}`)}</span>;
}

function BillingPager({ meta, onPage }: { meta: BillingPageMeta; onPage: (page: number) => void }) {
  const { t } = useI18n();
  if (!meta.total) return null;
  return <div className="pagination"><Button variant="ghost" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>{t("common.previous")}</Button><span>{meta.page} / {Math.max(meta.totalPages, 1)}</span><Button variant="ghost" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>{t("common.next")}</Button></div>;
}
