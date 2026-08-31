import { useEffect, useRef, useState } from "react";
import { Can, useAuthorization } from "./authorization-context";
import { useBillingRecovery } from "./billing-recovery-controller";
import { formatCurrencyDecimal, isPositiveDecimal, isZeroDecimal } from "./decimal-format";
import {
  electronicPaymentStates,
  isNavigableCheckoutUrl,
  ownerPaymentActions,
  type BillingPageMeta,
  type ElectronicPayment,
  type ElectronicPaymentState,
  type SubscriptionBillingInvoice,
} from "./electronic-payments";
import { useI18n } from "./i18n";
import { Button, Spinner } from "./ui";
import "./billing-recovery-styles.css";

type Notice = (message: string, tone?: "success" | "error") => void;

const emptyBillingMeta: BillingPageMeta = { page: 1, pageSize: 10, total: 0, totalPages: 0 };
const invoiceStatuses = ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
type BillingInvoiceFilter = "ALL" | typeof invoiceStatuses[number];

export function SubscriptionBillingCenter({ notify }: { notify: Notice }) {
  const { formatDateTime, intlLocale, t } = useI18n();
  const { user, selectedCompany, permissionSet } = useAuthorization();
  const recovery = useBillingRecovery(user.id, selectedCompany?.id, permissionSet.has("subscriptions.view"), permissionSet.has("subscriptions.manage"));
  const [invoiceStatus, setInvoiceStatus] = useState<BillingInvoiceFilter>("ALL");
  const [paymentState, setPaymentState] = useState<"ALL" | ElectronicPaymentState>("ALL");
  const { loading, pending, snapshot, attempt } = recovery;
  const invoices = snapshot?.invoices.items ?? [];
  const payments = snapshot?.payments.items ?? [];
  const invoiceMeta = snapshot?.invoices.meta ?? emptyBillingMeta;
  const paymentMeta = snapshot?.payments.meta ?? emptyBillingMeta;
  const providerAvailable = snapshot?.invoices.provider.available ?? false;
  const lastConfirmed = useRef(false);
  useEffect(() => {
    if (recovery.confirmed && !lastConfirmed.current) notify(t("billingRecovery.confirmed"));
    lastConfirmed.current = recovery.confirmed;
  }, [recovery.confirmed, notify, t]);
  const checkout = (invoice: SubscriptionBillingInvoice) => recovery.command({ command: "checkout", resourceId: invoice.id, invoiceId: invoice.id, version: invoice.version });
  const paymentCommand = (payment: ElectronicPayment, command: "cancel" | "retry") => recovery.command({ command, resourceId: payment.id, invoiceId: payment.invoiceId, version: payment.version });

  const money = (value: string, currency: string) => formatCurrencyDecimal(value, currency, intlLocale);
  if (!selectedCompany || !permissionSet.has("subscriptions.view")) return null;
  return <section className="subscription-billing-center" aria-labelledby="subscription-billing-title" aria-busy={loading || pending}>
    <header className="subscription-section-heading"><div><h2 id="subscription-billing-title">{t("subscriptionBilling.title")}</h2><p>{t("subscriptionBilling.description")}</p></div><Button variant="secondary" disabled={loading || pending} onClick={recovery.refresh}>{t("billingRecovery.readCurrent")}</Button></header>
    {(recovery.confirmed || attempt?.outcome === "confirmed") && <div className="billing-recovery-notice" role="status">{t("billingRecovery.confirmed")}</div>}
    {pending && <div className="billing-recovery-notice" role="status"><p>{t("billingRecovery.waiting")}</p><Button variant="secondary" onClick={recovery.stopWaiting}>{t("billingRecovery.stopWaiting")}</Button><p>{t("billingRecovery.stopWarning")}</p></div>}
    {!pending && !recovery.confirmed && attempt && attempt.outcome !== "confirmed" && <div className="billing-recovery-notice form-error" role="alert">
      <p>{t(`billingRecovery.${attempt.issue}`)}</p>
      {attempt.outcome === "unknown" && <p>{t("billingRecovery.unresolved")}</p>}
      {attempt.outcome === "rejected" && recovery.reviewReady && <Button variant="secondary" onClick={recovery.acknowledgeRejection}>{t("billingRecovery.reviewed")}</Button>}
    </div>}
    {recovery.storageBlocked && <div className="form-error" role="alert">{t("billingRecovery.storageUnavailable")}</div>}
    {recovery.navigationError && <div className="form-error" role="alert">{t("billingRecovery.checkoutOpenError")}</div>}
    {recovery.error && <div className="form-error" role="alert">{t(`billingRecovery.${recovery.error}`)}</div>}
    {loading && <Button variant="secondary" onClick={recovery.stopReading}>{t("billingRecovery.stopReading")}</Button>}
    {!loading && snapshot && !providerAvailable && <div className="subscription-safe-note">{t("subscriptionBilling.providerUnavailable")}</div>}
    {loading ? <Spinner label={t("subscriptionBilling.loading")} /> : snapshot && <div className="subscription-billing-grid">
      <section className="panel subscription-panel">
        <header><div><h3>{t("subscriptionBilling.invoices")}</h3><p>{t("subscriptionBilling.invoicesDescription")}</p></div><span>{invoiceMeta.total}</span></header>
        <form className="subscription-payment-filter" onSubmit={(event) => { event.preventDefault(); recovery.setQuery({ ...recovery.query, invoicePage: 1, invoiceStatus }); }}><label><span>{t("subscriptionBilling.invoiceStatus")}</span><select disabled={pending} value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value as BillingInvoiceFilter)}><option value="ALL">{t("subscriptionBilling.all")}</option>{invoiceStatuses.map((status) => <option key={status} value={status}>{t(`subscriptionBilling.invoiceStatus.${status}`)}</option>)}</select></label><Button type="submit" variant="secondary" disabled={pending}>{t("subscriptionBilling.apply")}</Button></form>
        {invoices.length ? <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("subscriptionBilling.invoice")}</th><th>{t("subscriptionBilling.amounts")}</th><th>{t("subscriptionBilling.invoiceStatus")}</th><th>{t("subscriptionBilling.actions")}</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><strong dir="ltr">{invoice.invoiceNumber}</strong><small>{formatDateTime(invoice.issueDate)} · {t("subscriptionBilling.due", { value1: formatDateTime(invoice.dueDate) })}</small></td><td><strong dir="ltr">{money(invoice.totalAmount, invoice.currencyCode)}</strong><small>{t("subscriptionBilling.balance", { value1: money(invoice.balance, invoice.currencyCode) })}{!isZeroDecimal(invoice.refundedAmount) ? ` · ${t("subscriptionBilling.refunded", { value1: money(invoice.refundedAmount, invoice.currencyCode) })}` : ""}</small></td><td><span className={`platform-status ${invoice.status.toLowerCase()}`}>{t(`subscriptionBilling.invoiceStatus.${invoice.status}`)}</span>{invoice.latestPaymentState && <small><PaymentState state={invoice.latestPaymentState} /></small>}</td><td><Can policy={{ permission: "subscriptions.manage" }}>{providerAvailable && isPositiveDecimal(invoice.balance) && invoice.status !== "VOID" && <Button disabled={recovery.blocked} onClick={() => void checkout(invoice)}>{t("subscriptionBilling.checkout")}</Button>}</Can></td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>{t("subscriptionBilling.noInvoices")}</h3><p>{t("subscriptionBilling.noInvoicesDescription")}</p></div>}
        <BillingPager disabled={pending} meta={invoiceMeta} onPage={(page) => recovery.setQuery({ ...recovery.query, invoicePage: page })} />
      </section>

      <section className="panel subscription-panel">
        <header><div><h3>{t("subscriptionBilling.payments")}</h3><p>{t("subscriptionBilling.paymentsDescription")}</p></div><span>{paymentMeta.total}</span></header>
        <form className="subscription-payment-filter" onSubmit={(event) => { event.preventDefault(); recovery.setQuery({ ...recovery.query, paymentPage: 1, paymentState }); }}><label><span>{t("subscriptionBilling.paymentState")}</span><select disabled={pending} value={paymentState} onChange={(event) => setPaymentState(event.target.value as "ALL" | ElectronicPaymentState)}><option value="ALL">{t("subscriptionBilling.all")}</option>{electronicPaymentStates.map((state) => <option key={state} value={state}>{t(`subscriptionBilling.paymentState.${state}`)}</option>)}</select></label><Button type="submit" variant="secondary" disabled={pending}>{t("subscriptionBilling.apply")}</Button></form>
        {payments.length ? <div className="subscription-payment-list">{payments.map((payment) => <article key={payment.id}><div><strong dir="ltr">{payment.invoiceNumber}</strong><span dir="ltr">{money(payment.amount, payment.currencyCode)}</span><small>{payment.provider} · {payment.environment}</small></div><div><PaymentState state={payment.state} />{payment.lastFailureCode && <small dir="ltr">{payment.lastFailureCode}</small>}<small>{formatDateTime(payment.updatedAt)}</small></div><Can policy={{ permission: "subscriptions.manage" }}><div className="row-actions">{ownerPaymentActions(payment).map((action) => action === "OPEN_CHECKOUT" ? <Button key={action} variant="secondary" disabled={recovery.blocked} onClick={() => { if (isNavigableCheckoutUrl(payment.checkoutUrl)) window.location.assign(payment.checkoutUrl); }}>{t("subscriptionBilling.continueCheckout")}</Button> : <Button key={action} variant={action === "CANCEL" ? "danger" : "primary"} disabled={recovery.blocked} onClick={() => void paymentCommand(payment, action === "CANCEL" ? "cancel" : "retry")}>{t(action === "CANCEL" ? "subscriptionBilling.cancel" : "subscriptionBilling.retry")}</Button>)}</div></Can></article>)}</div> : <div className="empty-state"><h3>{t("subscriptionBilling.noPayments")}</h3><p>{t("subscriptionBilling.noPaymentsDescription")}</p></div>}
        <BillingPager disabled={pending} meta={paymentMeta} onPage={(page) => recovery.setQuery({ ...recovery.query, paymentPage: page })} />
      </section>
    </div>}
  </section>;
}

function PaymentState({ state }: { state: ElectronicPaymentState }) {
  const { t } = useI18n();
  return <span className={`payment-state ${state.toLowerCase()}`}>{t(`subscriptionBilling.paymentState.${state}`)}</span>;
}

function BillingPager({ meta, onPage, disabled }: { meta: BillingPageMeta; onPage: (page: number) => void; disabled: boolean }) {
  const { t } = useI18n();
  if (!meta.total) return null;
  return <div className="pagination"><Button variant="ghost" disabled={disabled || meta.page <= 1} onClick={() => onPage(meta.page - 1)}>{t("common.previous")}</Button><span>{meta.page} / {Math.max(meta.totalPages, 1)}</span><Button variant="ghost" disabled={disabled || meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>{t("common.next")}</Button></div>;
}
