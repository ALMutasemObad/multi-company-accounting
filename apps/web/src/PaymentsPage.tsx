import {
  localizedReferenceName,
  activeIntlLocale,
  translate as t } from "./i18n";
import { FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import { api,
  ApiError,
  downloadPdf,
  idempotencyKey } from "./api";
import { actionPermissionPolicies } from "./action-permissions";
import { allows,
  firstRequestFailure,
  requestIfAllowed,
  requestValue } from "./authorization";
import { Can, useAuthorization } from "./authorization-context";
import { endpointPermissionPolicies } from "./endpoint-permissions";
import { exchangeRateForDocumentDate,
  missingDatedRateMessage } from "./currency-rates";
import {
  allocationsTotal,
  exchangeRateForCurrency,
  formatMoney,
  statusLabel,
  toMoney,
  toRate,
  validatePaymentDraft,
  } from "./domain";
import type {
  Account,
  PaymentAllocation,
  CashBankAccount,
  Currency,
  FiscalPeriod,
  ListResponse,
  Payment,
  PaymentMethod,
  PurchaseInvoice,
  Supplier,
  } from "./types";
import {
  Button,
  EmptyState,
  Icon,
  Modal,
  Pagination,
  Spinner,
  PageHeader,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type References = {
  suppliers: Supplier[];
  accounts: Account[];
  periods: FiscalPeriod[];
  cashBanks: CashBankAccount[];
  methods: PaymentMethod[];
  currencies: Currency[];
  purchaseInvoices: PurchaseInvoice[];
};
const emptyReferences: References = {
  suppliers: [],
  accounts: [],
  periods: [],
  cashBanks: [],
  methods: [],
  currencies: [],
  purchaseInvoices: [],
};

export function PaymentsPage({ notify }: { notify: Notice }) {
  const { permissionSet } = useAuthorization();
  const permissions = actionPermissionPolicies.payments;
  const [items, setItems] = useState<Payment[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Payment | null>(null);
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const [references, setReferences] = useState<References>(emptyReferences);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "10",
        ...(status ? { status } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(submittedSearch ? { search: submittedSearch } : {}),
      });
      const result = await api<ListResponse<Payment>>(`/payments?${query}`);
      setItems(result.data);
      setMeta(result.meta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("pages.payments.001"));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, page, status, submittedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const results = await Promise.all([
        requestIfAllowed(permissionSet, endpointPermissionPolicies.suppliers, () =>
          api<ListResponse<Supplier>>("/suppliers?page=1&pageSize=100&active=true")),
        requestIfAllowed(permissionSet, endpointPermissionPolicies.accounts, () =>
          api<ListResponse<Account>>("/accounts?page=1&pageSize=100&active=true")),
        requestIfAllowed(permissionSet, endpointPermissionPolicies.fiscalPeriods, () =>
          api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100")),
        requestIfAllowed(permissionSet, endpointPermissionPolicies.cashBankAccounts, () =>
          api<ListResponse<CashBankAccount>>("/cash-bank-accounts?page=1&pageSize=100")),
        requestIfAllowed(permissionSet, endpointPermissionPolicies.paymentMethods, () =>
          api<{ data: PaymentMethod[] }>("/payment-methods")),
        requestIfAllowed(permissionSet, endpointPermissionPolicies.currencies, () =>
          api<{ data: Currency[] }>("/currencies")),
        requestIfAllowed(permissionSet, endpointPermissionPolicies.purchaseInvoices, () =>
          api<ListResponse<PurchaseInvoice>>("/purchase-invoices?page=1&pageSize=100&documentType=PURCHASE_INVOICE&status=POSTED&outstandingOnly=true")),
      ]);
      const suppliers = requestValue(results[0]);
      const accounts = requestValue(results[1]);
      const periods = requestValue(results[2]);
      const cashBanks = requestValue(results[3]);
      const methods = requestValue(results[4]);
      const currencies = requestValue(results[5]);
      const purchaseInvoices = requestValue(results[6]);
      setReferences({
        suppliers: suppliers?.data.filter((item) => item.isActive) ?? [],
        accounts: accounts?.data.filter((item) => item.isActive && item.allowsPosting) ?? [],
        periods: periods?.data.filter((item) => item.status !== "CLOSED") ?? [],
        cashBanks: cashBanks?.data.filter((item) => item.isActive) ?? [],
        methods: methods?.data ?? [],
        currencies: currencies?.data ?? [],
        purchaseInvoices: purchaseInvoices?.data ?? [],
      });
      const cause = firstRequestFailure(results);
      if (cause) notify(cause instanceof Error ? cause.message : t("pages.manual-journals.002"), "error");
    })();
  }, [notify, permissionSet]);

  async function openDetails(id: string) {
    try {
      setSelected(await api<Payment>(`/payments/${id}`));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("pages.payments.003"), "error");
    }
  }

  async function command(
    operation: "post" | "cancel" | "reverse",
    payment: Payment,
  ) {
    if (!allows(permissionSet, permissions[operation])) return;
    const labels = { post: t("pages.manual-journals.004"), cancel: t("pages.accounts.065"), reverse: t("pages.manual-journals.006") };
    if (!window.confirm(t("pages.payments.007", { value1: labels[operation], value2: payment.document.documentNumber })))
      return;
    const reason =
      operation === "post"
        ? ""
        : window.prompt(
            operation === "cancel"
              ? t("pages.payments.008")
              : t("pages.payments.009"),
          );
    if (operation !== "post" && (!reason || reason.trim().length < 3)) return;
    const reversalDate =
      operation === "reverse"
        ? window.prompt(t("pages.manual-journals.009"), new Date().toISOString().slice(0, 10))
        : "";
    if (operation === "reverse" && !reversalDate) return;
    try {
      await api(`/payments/${payment.id}/${operation}`, {
        method: "POST",
        idempotencyKey:
          operation === "cancel"
            ? undefined
            : idempotencyKey(operation, payment.id),
        body: JSON.stringify({
          version: payment.document.version,
          ...(reason ? { reason: reason.trim() } : {}),
          ...(reversalDate ? { reversalDate } : {}),
        }),
      });
      notify(t("pages.payments.011", { value1: labels[operation] }));
      setSelected(null);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("pages.fiscal.008"), "error");
      await openDetails(payment.id);
    }
  }

  return (
    <section className="workspace-page">
      <PageHeader kicker={t("pages.payments.013")} title={t("pages.payments.014")} description={t("pages.payments.015")} actions={<Can policy={permissions.create}><Button icon="plus" onClick={() => setForm("create")}>{t("pages.payments.016")}</Button></Can>} />

      <div className="toolbar payment-filters">
        <form
          className="search-box"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSubmittedSearch(search.trim());
          }}
        >
          <Icon name="search" size={18} />
          <input
            aria-label={t("pages.payments.017")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("pages.payments.018")}
          />
          <button type="submit">{t("pages.accounts.026")}</button>
        </form>
        <select aria-label={t("pages.payments.020")} value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
          <option value="">{t("pages.accounts.027")}</option>
          <option value="DRAFT">{t("pages.dashboard.044")}</option>
          <option value="POSTED">{t("pages.dashboard.045")}</option>
          <option value="CANCELLED">{t("pages.dashboard.046")}</option>
          <option value="REVERSED">{t("pages.dashboard.047")}</option>
        </select>
        <label className="date-filter"><span>{t("pages.dashboard.013")}</span><input type="date" value={dateFrom} onChange={(event) => { setPage(1); setDateFrom(event.target.value); }} /></label>
        <label className="date-filter"><span>{t("pages.dashboard.014")}</span><input type="date" value={dateTo} onChange={(event) => { setPage(1); setDateTo(event.target.value); }} /></label>
      </div>

      {error ? (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => void load()}>{t("pages.accounts.030")}</Button>
        </div>
      ) : loading ? (
        <Spinner label={t("pages.payments.029")} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("pages.payments.030")}
          description={t("pages.payments.031")}
          action={<Can policy={permissions.create}><Button icon="plus" onClick={() => setForm("create")}>{t("pages.payments.032")}</Button></Can>}
        />
      ) : (
        <>
          <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}>
            <table className="data-table payments-table">
              <thead><tr><th>{t("pages.payments.033")}</th><th>{t("pages.dashboard.037")}</th><th>{t("pages.dashboard.036")}</th><th>{t("pages.manual-journals.032")}</th><th>{t("pages.dashboard.039")}</th><th>{t("pages.accounts.043")}</th><th><span className="sr-only">{t("pages.customers.032")}</span></th></tr></thead>
              <tbody>
                {items.map((payment) => (
                  <tr key={payment.id}>
                    <td><button className="text-link strong" dir="ltr" onClick={() => void openDetails(payment.id)}>{payment.document.documentNumber}</button></td>
                    <td>{new Date(payment.document.documentDate).toLocaleDateString(activeIntlLocale())}</td>
                    <td>{payment.counterpartyNameSnapshot}</td>
                    <td className="description-cell">{payment.document.description}</td>
                    <td className="money-cell">{formatMoney(payment.amount)}</td>
                    <td><span className={`status-chip ${payment.document.status.toLowerCase()}`}>{statusLabel(payment.document.status)}</span></td>
                    <td><Button variant="ghost" onClick={() => void openDetails(payment.id)}>{t("pages.payments.040")}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...meta} page={page} onChange={setPage} />
        </>
      )}

      {form && allows(permissionSet, form === "edit" ? permissions.update : permissions.create) && (
        <PaymentForm
          payment={form === "edit" ? selected : null}
          references={references}
          onClose={() => setForm(null)}
          onSaved={async (payment) => {
            setForm(null);
            setSelected(payment);
            notify(form === "create" ? t("pages.payments.041") : t("pages.payments.042"));
            await load();
          }}
        />
      )}
      {selected && !form && (
        <PaymentDetails
          payment={selected}
          references={references}
          onClose={() => setSelected(null)}
          onEdit={() => { if (allows(permissionSet, permissions.update)) setForm("edit"); }}
          onCommand={(operation) => void command(operation, selected)}
          onPrint={() => { if (allows(permissionSet, permissions.print)) void downloadPdf(`/payments/${selected.id}/pdf`).catch((cause) => notify(cause instanceof Error ? cause.message : t("pages.payments.043"), "error")); }}
        />
      )}
    </section>
  );
}

function PaymentForm({
  payment,
  references,
  onClose,
  onSaved,
}: {
  payment: Payment | null;
  references: References;
  onClose: () => void;
  onSaved: (payment: Payment) => void;
}) {
  const { permissionSet } = useAuthorization();
  const [counterpartyType, setCounterpartyType] = useState<"supplier" | "account">(
    payment?.counterAccountId ? "account" : "supplier",
  );
  const [supplierId, setSupplierId] = useState(payment?.supplierId ?? "");
  const [counterAccountId, setCounterAccountId] = useState(payment?.counterAccountId ?? "");
  const [amount, setAmount] = useState(payment?.amount ?? "");
  const [exchangeRate, setExchangeRate] = useState(payment?.exchangeRate ?? "1.00000000");
  const [methodId, setMethodId] = useState(payment?.paymentMethodId ?? "");
  const [currencyId, setCurrencyId] = useState(payment?.currencyId ?? "");
  const [documentDate, setDocumentDate] = useState(payment?.document.documentDate ?? new Date().toISOString().slice(0, 10));
  const [counterpartyName, setCounterpartyName] = useState(
    payment?.counterpartyNameSnapshot ?? "",
  );
  const [allocations, setAllocations] = useState<PaymentAllocation[]>(payment?.allocations ?? []);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const selectedSupplier = references.suppliers.find((item) => item.id === supplierId);
  const selectedMethod = references.methods.find((item) => item.id === methodId);
  const allocationTotal = useMemo(() => allocationsTotal(allocations), [allocations]);
  const openInvoices = references.purchaseInvoices.filter((invoice) => invoice.supplierId === supplierId && invoice.currencyId === currencyId);

  useEffect(() => {
    if (!currencyId && references.currencies[0]) {
      setCurrencyId(references.currencies[0].id);
      setExchangeRate(exchangeRateForCurrency(references.currencies[0]));
    }
  }, [currencyId, references.currencies]);

  async function selectCurrency(id: string, date = documentDate) {
    const selected = references.currencies.find((item) => item.id === id);
    setCurrencyId(id);
    try {
      setExchangeRate(await exchangeRateForDocumentDate(selected, date));
      setErrors((current) => current.filter((message) => message !== missingDatedRateMessage()));
    } catch {
      setExchangeRate("");
      setErrors([missingDatedRateMessage()]);
    }
  }

  function changeDocumentDate(value: string) {
    setDocumentDate(value);
    if (currencyId) void selectCurrency(currencyId, value);
  }

  function addAllocation() {
    setAllocations((current) => [
      ...current,
      { payableItemId: "", allocatedAmount: "" },
    ]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allows(permissionSet, payment ? actionPermissionPolicies.payments.update : actionPermissionPolicies.payments.create)) return;
    const clientErrors = validatePaymentDraft({
      supplierId: counterpartyType === "supplier" ? supplierId : "",
      counterAccountId: counterpartyType === "account" ? counterAccountId : "",
      amount,
      exchangeRate,
      allocations,
    });
    if (clientErrors.length) {
      setErrors(clientErrors);
      return;
    }
    setSaving(true);
    setErrors([]);
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const payload = {
      fiscalPeriodId: value("fiscalPeriodId"),
      documentDate: value("documentDate"),
      description: value("description"),
      supplierId: counterpartyType === "supplier" ? supplierId : null,
      counterAccountId: counterpartyType === "account" ? counterAccountId : null,
      cashBankAccountId: value("cashBankAccountId"),
      paymentMethodId: methodId,
      currencyId,
      exchangeRate: toRate(exchangeRate),
      amount: toMoney(amount),
      referenceNumber: value("referenceNumber") || null,
      counterpartyName:
        counterpartyName || localizedReferenceName(selectedSupplier) || t("pages.payments.044"),
      ...(value("counterpartyTaxNumber")
        ? { counterpartyTaxNumber: value("counterpartyTaxNumber") }
        : payment
          ? {}
          : { counterpartyTaxNumber: null }),
      counterpartyAddress: value("counterpartyAddress") || null,
      notes: value("notes") || null,
      allocations: allocations.map((allocation) => ({
        payableItemId: allocation.payableItemId,
        allocatedAmount: toMoney(allocation.allocatedAmount),
      })),
      ...(payment ? { version: payment.document.version } : {}),
    };
    try {
      const result = await api<Payment>(
        payment ? `/payments/${payment.id}` : "/payments",
        { method: payment ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      onSaved(result);
    } catch (cause) {
      setErrors([cause instanceof ApiError ? cause.message : t("pages.payments.045")]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={payment ? t("pages.payments.046", { value1: payment.document.documentNumber }) : t("pages.payments.047")}
      description={t("pages.payments.048")}
      onClose={onClose}
      wide
    >
      <form className="form-grid payment-form" onSubmit={submit}>
        {errors.length > 0 && (
          <div className="form-error full" role="alert">
            {errors.map((error) => <p key={error}>{error}</p>)}
          </div>
        )}
        <label>
          <span>{t("pages.payments.049")}</span>
          <select name="fiscalPeriodId" defaultValue={payment?.document.fiscalPeriodId} required>
            <option value="">{t("pages.manual-journals.047")}</option>
            {references.periods.map((period) => (
              <option key={period.id} value={period.id}>{period.name} — {period.startDate}{t("pages.payments.051")}{period.endDate}</option>
            ))}
          </select>
        </label>
        <label><span>{t("pages.payments.052")}</span><input name="documentDate" type="date" value={documentDate} onChange={(event) => changeDocumentDate(event.target.value)} required /></label>
        <label className="full"><span>{t("pages.payments.053")}</span><input name="description" defaultValue={payment?.document.description} maxLength={500} required /></label>

        <fieldset className="full segmented-field">
          <legend>{t("pages.payments.054")}</legend>
          <div className="segmented">
            <button type="button" className={counterpartyType === "supplier" ? "selected" : ""} onClick={() => { setCounterpartyType("supplier"); setCounterAccountId(""); setCounterpartyName(""); }}>{t("pages.payments.055")}</button>
            <button type="button" className={counterpartyType === "account" ? "selected" : ""} onClick={() => { setCounterpartyType("account"); setSupplierId(""); setCounterpartyName(""); setAllocations([]); }}>{t("pages.payments.056")}</button>
          </div>
        </fieldset>
        {counterpartyType === "supplier" ? (
          <label className="full">
            <span>{t("pages.payments.057")}</span>
            <select
              value={supplierId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextSupplier = references.suppliers.find(
                  (item) => item.id === nextId,
                );
                setSupplierId(nextId);
                setCounterpartyName(localizedReferenceName(nextSupplier) ?? "");
              }}
              required
            >
              <option value="">{t("pages.payments.058")}</option>
              {references.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {localizedReferenceName(supplier)}</option>)}
            </select>
          </label>
        ) : (
          <label className="full">
            <span>{t("pages.payments.059")}</span>
            <select value={counterAccountId} onChange={(event) => setCounterAccountId(event.target.value)} required>
              <option value="">{t("pages.customers.044")}</option>
              {references.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {localizedReferenceName(account)}</option>)}
            </select>
          </label>
        )}
        <label><span>{t("pages.payments.061")}</span><select name="cashBankAccountId" defaultValue={payment?.cashBankAccountId} required><option value="">{t("pages.customers.044")}</option>{references.cashBanks.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)} ({item.accountType === "BANK" ? t("pages.payments.062") : t("pages.payments.063")})</option>)}</select></label>
        <label><span>{t("pages.payments.064")}</span><select value={methodId} onChange={(event) => setMethodId(event.target.value)} required><option value="">{t("pages.payments.065")}</option>{references.methods.map((item) => <option key={item.id} value={item.id}>{localizedReferenceName(item)}</option>)}</select></label>
        <label><span>{t("pages.payments.066")}</span><select value={currencyId} onChange={(event) => void selectCurrency(event.target.value)} required><option value="">{t("pages.payments.067")}</option>{references.currencies.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)}</option>)}</select></label>
        <label><span>{t("pages.payments.068")}</span><input value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} inputMode="decimal" dir="ltr" placeholder="1.00000000" required /></label>
        <label><span>{t("pages.payments.069")}</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" dir="ltr" placeholder="0.0000" required /></label>
        <label><span>{t("pages.payments.070")}{selectedMethod?.requiresReference && "*"}</span><input name="referenceNumber" defaultValue={payment?.referenceNumber ?? ""} maxLength={100} required={selectedMethod?.requiresReference} /></label>
        <label><span>{t("pages.payments.071")}</span><input name="counterpartyName" value={counterpartyName} onChange={(event) => setCounterpartyName(event.target.value)} maxLength={200} required /></label>
        <label><span>{t("pages.payments.072")}</span><input name="counterpartyTaxNumber" dir="ltr" maxLength={64} placeholder={payment?.counterpartyTaxMasked ?? ""} /></label>
        <label className="full"><span>{t("pages.payments.073")}</span><input name="counterpartyAddress" defaultValue={payment?.counterpartyAddressSnapshot ?? ""} maxLength={500} /></label>
        <label className="full"><span>{t("pages.payments.074")}</span><textarea name="notes" defaultValue={payment?.notes ?? ""} maxLength={1000} rows={3} /></label>

        <fieldset className="full allocations-field" hidden={counterpartyType !== "supplier"}>
          <legend>{t("pages.payments.075")}</legend>
          <div className="allocation-heading">
            <p>{t("pages.payments.076")}</p>
            <Button type="button" variant="secondary" icon="plus" onClick={addAllocation}>{t("pages.payments.077")}</Button>
          </div>
          {allocations.length === 0 ? (
            <div className="compact-empty">{t("validation.payment.allocationsRequired")}</div>
          ) : (
            <div className="allocation-list">
              {allocations.map((allocation, index) => (
                <div className="allocation-row" key={allocation.id ?? index}>
                  <label><span>{t("pages.payments.079")}</span><select value={allocation.payableItemId} onChange={(event) => { const selectedInvoice = openInvoices.find((invoice) => invoice.payableItemId === event.target.value); setAllocations((current) => current.map((item, i) => i === index ? { ...item, payableItemId: event.target.value, allocatedAmount: selectedInvoice ? selectedInvoice.outstandingAmount : item.allocatedAmount } : item)); }}><option value="">{t("pages.payments.080")}</option>{openInvoices.map((invoice) => <option key={invoice.id} value={invoice.payableItemId ?? ""}>{invoice.document.documentNumber}{invoice.supplierInvoiceNumber ? t("pages.payments.081", { value1: invoice.supplierInvoiceNumber }) : ""}{t("pages.payments.082")}{formatMoney(invoice.outstandingAmount)}</option>)}</select></label>
                  <label><span>{t("pages.dashboard.039")}</span><input dir="ltr" inputMode="decimal" value={allocation.allocatedAmount} onChange={(event) => setAllocations((current) => current.map((item, i) => i === index ? { ...item, allocatedAmount: event.target.value } : item))} /></label>
                  <button type="button" className="icon-button danger-text" aria-label={t("pages.payments.083")} onClick={() => setAllocations((current) => current.filter((_, i) => i !== index))}><Icon name="trash" size={18} /></button>
                </div>
              ))}
            </div>
          )}
          <div className={`allocation-total ${allocations.length && Math.abs(allocationTotal - Number(amount || 0)) > 0.00005 ? "mismatch" : ""}`}>
            <span>{t("pages.payments.084")}</span>
            <strong>{formatMoney(allocationTotal)}</strong>
          </div>
        </fieldset>
        <div className="modal-actions full">
          <Button type="button" variant="secondary" onClick={onClose}>{t("pages.accounts.065")}</Button>
          <Button type="submit" disabled={saving}>{saving ? t("pages.accounts.066") : t("pages.manual-journals.077")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentDetails({
  payment,
  references,
  onClose,
  onEdit,
  onCommand,
  onPrint,
}: {
  payment: Payment;
  references: References;
  onClose: () => void;
  onEdit: () => void;
  onCommand: (operation: "post" | "cancel" | "reverse") => void;
  onPrint: () => void;
}) {
  const permissions = actionPermissionPolicies.payments;
  const supplier = references.suppliers.find((item) => item.id === payment.supplierId);
  const cash = references.cashBanks.find((item) => item.id === payment.cashBankAccountId);
  const method = references.methods.find((item) => item.id === payment.paymentMethodId);
  const currency = references.currencies.find((item) => item.id === payment.currencyId);
  return (
    <Modal title={payment.document.documentNumber} description={payment.document.description} onClose={onClose} wide>
      <div className="detail-actions">
        {(payment.document.status === "POSTED" || payment.document.status === "REVERSED") && (
          <Can policy={permissions.print}><Button variant="secondary" icon="print" onClick={onPrint}>{t("pages.payments.087")}</Button></Can>
        )}
        {payment.document.status === "DRAFT" && (
          <>
            <Can policy={permissions.update}><Button variant="secondary" icon="edit" onClick={onEdit}>{t("pages.accounts.048")}</Button></Can>
            <Can policy={permissions.post}><Button icon="check" onClick={() => onCommand("post")}>{t("pages.manual-journals.004")}</Button></Can>
            <Can policy={permissions.cancel}><Button variant="danger" icon="ban" onClick={() => onCommand("cancel")}>{t("pages.accounts.065")}</Button></Can>
          </>
        )}
        {payment.document.status === "POSTED" && (
          <Can policy={permissions.reverse}><Button variant="danger" icon="reverse" onClick={() => onCommand("reverse")}>{t("pages.payments.089")}</Button></Can>
        )}
      </div>
      <div className="document-summary">
        <div><span>{t("pages.accounts.043")}</span><strong className={`status-chip ${payment.document.status.toLowerCase()}`}>{statusLabel(payment.document.status)}</strong></div>
        <div><span>{t("pages.dashboard.037")}</span><strong>{new Date(payment.document.documentDate).toLocaleDateString(activeIntlLocale())}</strong></div>
        <div><span>{t("pages.dashboard.039")}</span><strong>{formatMoney(payment.amount)} {currency?.code}</strong></div>
      </div>
      <dl className="detail-grid">
        <div><dt>{t("pages.dashboard.036")}</dt><dd>{localizedReferenceName(supplier) || payment.counterpartyNameSnapshot}</dd></div>
        <div><dt>{t("pages.payments.090")}</dt><dd>{cash ? `${cash.code} — ${localizedReferenceName(cash)}` : payment.cashBankAccountId}</dd></div>
        <div><dt>{t("pages.payments.091")}</dt><dd>{localizedReferenceName(method) || payment.paymentMethodId}</dd></div>
        <div><dt>{t("pages.payments.092")}</dt><dd>{payment.referenceNumber || t("pages.customers.064")}</dd></div>
        <div><dt>{t("pages.manual-journals.067")}</dt><dd dir="ltr">{payment.exchangeRate}</dd></div>
        <div><dt>{t("pages.payments.095")}</dt><dd>{formatMoney(payment.baseAmount)}</dd></div>
        {Number(payment.realizedFxBaseAmount) !== 0 && <div><dt>{t("settlement.fx.realized")}</dt><dd>{Number(payment.realizedFxBaseAmount) > 0 ? t("settlement.fx.gain") : t("settlement.fx.loss")} — {formatMoney(Math.abs(Number(payment.realizedFxBaseAmount)))}</dd></div>}
        {payment.notes && <div className="full"><dt>{t("pages.payments.074")}</dt><dd>{payment.notes}</dd></div>}
      </dl>
      <div className="subsection-heading"><div><h3>{t("pages.payments.096")}</h3><p>{payment.allocations.length}{t("pages.payments.097")}</p></div></div>
      {payment.allocations.length === 0 ? (
        <div className="compact-empty">{t("pages.payments.098")}</div>
      ) : (
        <div className="allocation-detail-list">
          {payment.allocations.map((allocation) => (
            <div key={allocation.id ?? allocation.payableItemId}>
              <span>{references.purchaseInvoices.find((invoice) => invoice.payableItemId === allocation.payableItemId)?.document.documentNumber ?? t("pages.payments.099", { value1: allocation.payableItemId })}{allocation.carryingBaseAmount && allocation.settlementBaseAmount && <small>{t("settlement.fx.carryingBase")}: {formatMoney(allocation.carryingBaseAmount)} · {t("settlement.fx.settlementBase")}: {formatMoney(allocation.settlementBaseAmount)}</small>}</span>
              <strong>{formatMoney(allocation.allocatedAmount)}{allocation.realizedFxBaseAmount && Number(allocation.realizedFxBaseAmount) !== 0 && <small>{Number(allocation.realizedFxBaseAmount) > 0 ? t("settlement.fx.gain") : t("settlement.fx.loss")} {formatMoney(Math.abs(Number(allocation.realizedFxBaseAmount)))}</small>}</strong>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
