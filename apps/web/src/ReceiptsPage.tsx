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
import { exchangeRateForDocumentDate,
  missingDatedRateMessage } from "./currency-rates";
import {
  allocationsTotal,
  exchangeRateForCurrency,
  formatMoney,
  statusLabel,
  toMoney,
  toRate,
  validateReceiptDraft,
  } from "./domain";
import type {
  Account,
  Allocation,
  CashBankAccount,
  Currency,
  FiscalPeriod,
  ListResponse,
  Receipt,
  PaymentMethod,
  Customer,
  SalesInvoice,
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
  customers: Customer[];
  accounts: Account[];
  periods: FiscalPeriod[];
  cashBanks: CashBankAccount[];
  methods: PaymentMethod[];
  currencies: Currency[];
  openInvoices: SalesInvoice[];
};
const emptyReferences: References = {
  customers: [],
  accounts: [],
  periods: [],
  cashBanks: [],
  methods: [],
  currencies: [],
  openInvoices: [],
};

export function ReceiptsPage({ notify }: { notify: Notice }) {
  const [items, setItems] = useState<Receipt[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Receipt | null>(null);
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
      const result = await api<ListResponse<Receipt>>(`/receipts?${query}`);
      setItems(result.data);
      setMeta(result.meta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("pages.receipts.001"));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, page, status, submittedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void Promise.all([
      api<ListResponse<Customer>>("/customers?page=1&pageSize=100&active=true"),
      api<ListResponse<Account>>("/accounts?page=1&pageSize=100&active=true"),
      api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100"),
      api<ListResponse<CashBankAccount>>("/cash-bank-accounts?page=1&pageSize=100"),
      api<{ data: PaymentMethod[] }>("/payment-methods"),
      api<{ data: Currency[] }>("/currencies"),
      api<ListResponse<SalesInvoice>>("/sales-invoices?page=1&pageSize=100&documentType=SALES_INVOICE&status=POSTED&outstandingOnly=true"),
    ])
      .then(([customers, accounts, periods, cashBanks, methods, currencies, openInvoices]) =>
        setReferences({
          customers: customers.data.filter((item) => item.isActive),
          accounts: accounts.data.filter((item) => item.isActive && item.allowsPosting),
          periods: periods.data.filter((item) => item.status !== "CLOSED"),
          cashBanks: cashBanks.data.filter((item) => item.isActive),
          methods: methods.data,
          currencies: currencies.data,
          openInvoices: openInvoices.data,
        }),
      )
      .catch((cause) =>
        notify(cause instanceof Error ? cause.message : t("pages.manual-journals.002"), "error"),
      );
  }, [notify]);

  async function openDetails(id: string) {
    try {
      setSelected(await api<Receipt>(`/receipts/${id}`));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("pages.payments.003"), "error");
    }
  }

  async function command(
    operation: "post" | "cancel" | "reverse",
    receipt: Receipt,
  ) {
    const labels = { post: t("pages.manual-journals.004"), cancel: t("pages.accounts.065"), reverse: t("pages.manual-journals.006") };
    if (!window.confirm(t("pages.payments.007", { value1: labels[operation], value2: receipt.document.documentNumber })))
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
      await api(`/receipts/${receipt.id}/${operation}`, {
        method: "POST",
        idempotencyKey:
          operation === "cancel"
            ? undefined
            : idempotencyKey(operation, receipt.id),
        body: JSON.stringify({
          version: receipt.document.version,
          ...(reason ? { reason: reason.trim() } : {}),
          ...(reversalDate ? { reversalDate } : {}),
        }),
      });
      notify(t("pages.payments.011", { value1: labels[operation] }));
      setSelected(null);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("pages.fiscal.008"), "error");
      await openDetails(receipt.id);
    }
  }

  return (
    <section className="workspace-page">
      <PageHeader kicker={t("pages.receipts.013")} title={t("pages.receipts.014")} description={t("pages.payments.015")} actions={<Button icon="plus" onClick={() => setForm("create")}>{t("pages.receipts.016")}</Button>} />

      <div className="toolbar receipt-filters">
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
            aria-label={t("pages.receipts.017")}
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
        <Spinner label={t("pages.receipts.029")} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("pages.receipts.030")}
          description={t("pages.receipts.031")}
          action={<Button icon="plus" onClick={() => setForm("create")}>{t("pages.payments.032")}</Button>}
        />
      ) : (
        <>
          <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}>
            <table className="data-table receipts-table">
              <thead><tr><th>{t("pages.payments.033")}</th><th>{t("pages.dashboard.037")}</th><th>{t("pages.dashboard.036")}</th><th>{t("pages.manual-journals.032")}</th><th>{t("pages.dashboard.039")}</th><th>{t("pages.accounts.043")}</th><th><span className="sr-only">{t("pages.customers.032")}</span></th></tr></thead>
              <tbody>
                {items.map((receipt) => (
                  <tr key={receipt.id}>
                    <td><button className="text-link strong" dir="ltr" onClick={() => void openDetails(receipt.id)}>{receipt.document.documentNumber}</button></td>
                    <td>{new Date(receipt.document.documentDate).toLocaleDateString(activeIntlLocale())}</td>
                    <td>{receipt.counterpartyNameSnapshot}</td>
                    <td className="description-cell">{receipt.document.description}</td>
                    <td className="money-cell">{formatMoney(receipt.amount)}</td>
                    <td><span className={`status-chip ${receipt.document.status.toLowerCase()}`}>{statusLabel(receipt.document.status)}</span></td>
                    <td><Button variant="ghost" onClick={() => void openDetails(receipt.id)}>{t("pages.payments.040")}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...meta} page={page} onChange={setPage} />
        </>
      )}

      {form && (
        <ReceiptForm
          receipt={form === "edit" ? selected : null}
          references={references}
          onClose={() => setForm(null)}
          onSaved={async (receipt) => {
            setForm(null);
            setSelected(receipt);
            notify(form === "create" ? t("pages.receipts.041") : t("pages.payments.042"));
            await load();
          }}
        />
      )}
      {selected && !form && (
        <ReceiptDetails
          receipt={selected}
          references={references}
          onClose={() => setSelected(null)}
          onEdit={() => setForm("edit")}
          onCommand={(operation) => void command(operation, selected)}
          onPrint={() => void downloadPdf(`/receipts/${selected.id}/pdf`).catch((cause) => notify(cause instanceof Error ? cause.message : t("pages.receipts.043"), "error"))}
        />
      )}
    </section>
  );
}

function ReceiptForm({
  receipt,
  references,
  onClose,
  onSaved,
}: {
  receipt: Receipt | null;
  references: References;
  onClose: () => void;
  onSaved: (receipt: Receipt) => void;
}) {
  const [counterpartyType, setCounterpartyType] = useState<"customer" | "account">(
    receipt?.counterAccountId ? "account" : "customer",
  );
  const [customerId, setCustomerId] = useState(receipt?.customerId ?? "");
  const [counterAccountId, setCounterAccountId] = useState(receipt?.counterAccountId ?? "");
  const [amount, setAmount] = useState(receipt?.amount ?? "");
  const [exchangeRate, setExchangeRate] = useState(receipt?.exchangeRate ?? "1.00000000");
  const [methodId, setMethodId] = useState(receipt?.paymentMethodId ?? "");
  const [currencyId, setCurrencyId] = useState(receipt?.currencyId ?? "");
  const [documentDate, setDocumentDate] = useState(receipt?.document.documentDate ?? new Date().toISOString().slice(0, 10));
  const [counterpartyName, setCounterpartyName] = useState(
    receipt?.counterpartyNameSnapshot ?? "",
  );
  const [allocations, setAllocations] = useState<Allocation[]>(receipt?.allocations ?? []);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const selectedCustomer = references.customers.find((item) => item.id === customerId);
  const selectedMethod = references.methods.find((item) => item.id === methodId);
  const allocationTotal = useMemo(() => allocationsTotal(allocations), [allocations]);
  const eligibleInvoices = useMemo(
    () => references.openInvoices.filter(
      (invoice) => invoice.customerId === customerId && invoice.currencyId === currencyId && invoice.arJournalLineId,
    ),
    [currencyId, customerId, references.openInvoices],
  );

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
      { targetJournalLineId: "", allocatedAmount: "" },
    ]);
  }

  function selectInvoice(index: number, targetJournalLineId: string) {
    const invoice = eligibleInvoices.find((item) => item.arJournalLineId === targetJournalLineId);
    const otherTotal = allocations.reduce(
      (sum, item, itemIndex) => itemIndex === index ? sum : sum + Number(item.allocatedAmount || 0),
      0,
    );
    const remainingReceipt = Math.max(0, Number(amount || 0) - otherTotal);
    const suggestedAmount = invoice
      ? Math.min(remainingReceipt, Number(invoice.outstandingAmount))
      : 0;
    setAllocations((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, targetJournalLineId, allocatedAmount: targetJournalLineId ? toMoney(String(suggestedAmount)) : "" }
      : item));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clientErrors = validateReceiptDraft({
      customerId: counterpartyType === "customer" ? customerId : "",
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
      customerId: counterpartyType === "customer" ? customerId : null,
      counterAccountId: counterpartyType === "account" ? counterAccountId : null,
      cashBankAccountId: value("cashBankAccountId"),
      paymentMethodId: methodId,
      currencyId,
      exchangeRate: toRate(exchangeRate),
      amount: toMoney(amount),
      referenceNumber: value("referenceNumber") || null,
      counterpartyName:
        counterpartyName || localizedReferenceName(selectedCustomer) || t("pages.receipts.044"),
      ...(value("counterpartyTaxNumber")
        ? { counterpartyTaxNumber: value("counterpartyTaxNumber") }
        : receipt
          ? {}
          : { counterpartyTaxNumber: null }),
      counterpartyAddress: value("counterpartyAddress") || null,
      notes: value("notes") || null,
      allocations: allocations.map((allocation) => ({
        targetJournalLineId: allocation.targetJournalLineId,
        allocatedAmount: toMoney(allocation.allocatedAmount),
      })),
      ...(receipt ? { version: receipt.document.version } : {}),
    };
    try {
      const result = await api<Receipt>(
        receipt ? `/receipts/${receipt.id}` : "/receipts",
        { method: receipt ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      onSaved(result);
    } catch (cause) {
      setErrors([cause instanceof ApiError ? cause.message : t("pages.receipts.045")]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={receipt ? t("pages.payments.046", { value1: receipt.document.documentNumber }) : t("pages.receipts.047")}
      description={t("pages.payments.048")}
      onClose={onClose}
      wide
    >
      <form className="form-grid receipt-form" onSubmit={submit}>
        {errors.length > 0 && (
          <div className="form-error full" role="alert">
            {errors.map((error) => <p key={error}>{error}</p>)}
          </div>
        )}
        <label>
          <span>{t("pages.payments.049")}</span>
          <select name="fiscalPeriodId" defaultValue={receipt?.document.fiscalPeriodId} required>
            <option value="">{t("pages.manual-journals.047")}</option>
            {references.periods.map((period) => (
              <option key={period.id} value={period.id}>{period.name} — {period.startDate}{t("pages.payments.051")}{period.endDate}</option>
            ))}
          </select>
        </label>
        <label><span>{t("pages.payments.052")}</span><input name="documentDate" type="date" value={documentDate} onChange={(event) => changeDocumentDate(event.target.value)} required /></label>
        <label className="full"><span>{t("pages.payments.053")}</span><input name="description" defaultValue={receipt?.document.description} maxLength={500} required /></label>

        <fieldset className="full segmented-field">
          <legend>{t("pages.payments.054")}</legend>
          <div className="segmented">
            <button type="button" className={counterpartyType === "customer" ? "selected" : ""} onClick={() => { setCounterpartyType("customer"); setCounterAccountId(""); setCounterpartyName(""); }}>{t("pages.receipts.055")}</button>
            <button type="button" className={counterpartyType === "account" ? "selected" : ""} onClick={() => { setCounterpartyType("account"); setCustomerId(""); setCounterpartyName(""); }}>{t("pages.payments.056")}</button>
          </div>
        </fieldset>
        {counterpartyType === "customer" ? (
          <label className="full">
            <span>{t("pages.receipts.057")}</span>
            <select
              value={customerId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextCustomer = references.customers.find(
                  (item) => item.id === nextId,
                );
                setCustomerId(nextId);
                setCounterpartyName(localizedReferenceName(nextCustomer) ?? "");
              }}
              required
            >
              <option value="">{t("pages.receipts.058")}</option>
              {references.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} — {localizedReferenceName(customer)}</option>)}
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
        <label><span>{t("pages.payments.061")}</span><select name="cashBankAccountId" defaultValue={receipt?.cashBankAccountId} required><option value="">{t("pages.customers.044")}</option>{references.cashBanks.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)} ({item.accountType === "BANK" ? t("pages.payments.062") : t("pages.payments.063")})</option>)}</select></label>
        <label><span>{t("pages.payments.064")}</span><select value={methodId} onChange={(event) => setMethodId(event.target.value)} required><option value="">{t("pages.payments.065")}</option>{references.methods.map((item) => <option key={item.id} value={item.id}>{localizedReferenceName(item)}</option>)}</select></label>
        <label><span>{t("pages.payments.066")}</span><select value={currencyId} onChange={(event) => void selectCurrency(event.target.value)} required><option value="">{t("pages.payments.067")}</option>{references.currencies.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)}</option>)}</select></label>
        <label><span>{t("pages.payments.068")}</span><input value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} inputMode="decimal" dir="ltr" placeholder="1.00000000" required /></label>
        <label><span>{t("pages.payments.069")}</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" dir="ltr" placeholder="0.0000" required /></label>
        <label><span>{t("pages.payments.070")}{selectedMethod?.requiresReference && "*"}</span><input name="referenceNumber" defaultValue={receipt?.referenceNumber ?? ""} maxLength={100} required={selectedMethod?.requiresReference} /></label>
        <label><span>{t("pages.payments.071")}</span><input name="counterpartyName" value={counterpartyName} onChange={(event) => setCounterpartyName(event.target.value)} maxLength={200} required /></label>
        <label><span>{t("pages.payments.072")}</span><input name="counterpartyTaxNumber" dir="ltr" maxLength={64} placeholder={receipt?.counterpartyTaxMasked ?? ""} /></label>
        <label className="full"><span>{t("pages.payments.073")}</span><input name="counterpartyAddress" defaultValue={receipt?.counterpartyAddressSnapshot ?? ""} maxLength={500} /></label>
        <label className="full"><span>{t("pages.payments.074")}</span><textarea name="notes" defaultValue={receipt?.notes ?? ""} maxLength={1000} rows={3} /></label>

        <fieldset className="full allocations-field">
          <legend>{t("pages.receipts.075")}</legend>
          <div className="allocation-heading">
            <p>{t("pages.receipts.076")}</p>
            <Button type="button" variant="secondary" icon="plus" onClick={addAllocation}>{t("pages.payments.077")}</Button>
          </div>
          {allocations.length === 0 ? (
            <div className="compact-empty">{t("pages.receipts.078")}</div>
          ) : (
            <div className="allocation-list">
              {allocations.map((allocation, index) => (
                <div className="allocation-row" key={allocation.id ?? index}>
                  <label><span>{t("pages.receipts.079")}</span><select value={allocation.targetJournalLineId} onChange={(event) => selectInvoice(index, event.target.value)} required><option value="">{t("pages.purchase-invoices.069")}</option>{allocation.targetJournalLineId && !eligibleInvoices.some((invoice) => invoice.arJournalLineId === allocation.targetJournalLineId) && <option value={allocation.targetJournalLineId}>{t("pages.receipts.081")}{allocation.targetJournalLineId}</option>}{eligibleInvoices.filter((invoice) => !allocations.some((item, itemIndex) => itemIndex !== index && item.targetJournalLineId === invoice.arJournalLineId)).map((invoice) => <option key={invoice.id} value={invoice.arJournalLineId ?? ""}>{invoice.document.documentNumber}{t("pages.receipts.082")}{formatMoney(invoice.outstandingAmount)} — {invoice.dueDate}</option>)}</select></label>
                  <label><span>{t("pages.dashboard.039")}</span><input dir="ltr" inputMode="decimal" value={allocation.allocatedAmount} onChange={(event) => setAllocations((current) => current.map((item, i) => i === index ? { ...item, allocatedAmount: event.target.value } : item))} required /></label>
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

function ReceiptDetails({
  receipt,
  references,
  onClose,
  onEdit,
  onCommand,
  onPrint,
}: {
  receipt: Receipt;
  references: References;
  onClose: () => void;
  onEdit: () => void;
  onCommand: (operation: "post" | "cancel" | "reverse") => void;
  onPrint: () => void;
}) {
  const customer = references.customers.find((item) => item.id === receipt.customerId);
  const cash = references.cashBanks.find((item) => item.id === receipt.cashBankAccountId);
  const method = references.methods.find((item) => item.id === receipt.paymentMethodId);
  const currency = references.currencies.find((item) => item.id === receipt.currencyId);
  return (
    <Modal title={receipt.document.documentNumber} description={receipt.document.description} onClose={onClose} wide>
      <div className="detail-actions">
        {(receipt.document.status === "POSTED" || receipt.document.status === "REVERSED") && (
          <Button variant="secondary" icon="print" onClick={onPrint}>{t("pages.payments.087")}</Button>
        )}
        {receipt.document.status === "DRAFT" && (
          <>
            <Button variant="secondary" icon="edit" onClick={onEdit}>{t("pages.accounts.048")}</Button>
            <Button icon="check" onClick={() => onCommand("post")}>{t("pages.manual-journals.004")}</Button>
            <Button variant="danger" icon="ban" onClick={() => onCommand("cancel")}>{t("pages.accounts.065")}</Button>
          </>
        )}
        {receipt.document.status === "POSTED" && (
          <Button variant="danger" icon="reverse" onClick={() => onCommand("reverse")}>{t("pages.payments.089")}</Button>
        )}
      </div>
      <div className="document-summary">
        <div><span>{t("pages.accounts.043")}</span><strong className={`status-chip ${receipt.document.status.toLowerCase()}`}>{statusLabel(receipt.document.status)}</strong></div>
        <div><span>{t("pages.dashboard.037")}</span><strong>{new Date(receipt.document.documentDate).toLocaleDateString(activeIntlLocale())}</strong></div>
        <div><span>{t("pages.dashboard.039")}</span><strong>{formatMoney(receipt.amount)} {currency?.code}</strong></div>
      </div>
      <dl className="detail-grid">
        <div><dt>{t("pages.dashboard.036")}</dt><dd>{localizedReferenceName(customer) || receipt.counterpartyNameSnapshot}</dd></div>
        <div><dt>{t("pages.payments.090")}</dt><dd>{cash ? `${cash.code} — ${localizedReferenceName(cash)}` : receipt.cashBankAccountId}</dd></div>
        <div><dt>{t("pages.payments.091")}</dt><dd>{localizedReferenceName(method) || receipt.paymentMethodId}</dd></div>
        <div><dt>{t("pages.payments.092")}</dt><dd>{receipt.referenceNumber || t("pages.customers.064")}</dd></div>
        <div><dt>{t("pages.manual-journals.067")}</dt><dd dir="ltr">{receipt.exchangeRate}</dd></div>
        <div><dt>{t("pages.payments.095")}</dt><dd>{formatMoney(receipt.baseAmount)}</dd></div>
        {receipt.notes && <div className="full"><dt>{t("pages.payments.074")}</dt><dd>{receipt.notes}</dd></div>}
      </dl>
      <div className="subsection-heading"><div><h3>{t("pages.payments.096")}</h3><p>{receipt.allocations.length}{t("pages.payments.097")}</p></div></div>
      {receipt.allocations.length === 0 ? (
        <div className="compact-empty">{t("pages.payments.098")}</div>
      ) : (
        <div className="allocation-detail-list">
          {receipt.allocations.map((allocation) => (
            <div key={allocation.id ?? allocation.targetJournalLineId}>
              <span>{t("pages.receipts.099")}{allocation.targetJournalLineId}</span>
              <strong>{formatMoney(allocation.allocatedAmount)}</strong>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
