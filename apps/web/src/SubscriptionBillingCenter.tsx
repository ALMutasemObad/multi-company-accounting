import { FormEvent, useCallback, useEffect, useState } from "react";
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
import { Button, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;

const emptyBillingMeta: BillingPageMeta = { page: 1, pageSize: 10, total: 0, totalPages: 0 };
const invoiceStatuses = ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
type BillingInvoiceFilter = "ALL" | typeof invoiceStatuses[number];

export function SubscriptionBillingCenter({ notify }: { notify: Notice }) {
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
