import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, downloadPdf, idempotencyKey } from "./api";
import { exchangeRateForDocumentDate, missingDatedRateMessage } from "./currency-rates";
import {
  allocationsTotal,
  exchangeRateForCurrency,
  formatMoney,
  statusLabels,
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
      setError(cause instanceof Error ? cause.message : "تعذر تحميل سندات القبض.");
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
        notify(cause instanceof Error ? cause.message : "تعذر تحميل البيانات المرجعية.", "error"),
      );
  }, [notify]);

  async function openDetails(id: string) {
    try {
      setSelected(await api<Receipt>(`/receipts/${id}`));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "تعذر عرض السند.", "error");
    }
  }

  async function command(
    operation: "post" | "cancel" | "reverse",
    receipt: Receipt,
  ) {
    const labels = { post: "ترحيل", cancel: "إلغاء", reverse: "عكس" };
    if (!window.confirm(`تأكيد ${labels[operation]} السند ${receipt.document.documentNumber}؟`))
      return;
    const reason =
      operation === "post"
        ? ""
        : window.prompt(
            operation === "cancel"
              ? "اكتب سبب الإلغاء (3 أحرف على الأقل):"
              : "اكتب سبب العكس (3 أحرف على الأقل):",
          );
    if (operation !== "post" && (!reason || reason.trim().length < 3)) return;
    const reversalDate =
      operation === "reverse"
        ? window.prompt("تاريخ العكس بصيغة YYYY-MM-DD:", new Date().toISOString().slice(0, 10))
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
      notify(`تم ${labels[operation]} السند بنجاح.`);
      setSelected(null);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "تعذر تنفيذ الإجراء.", "error");
      await openDetails(receipt.id);
    }
  }

  return (
    <section className="workspace-page">
      <header className="page-heading">
        <div>
          <span className="section-kicker">الخزينة والمقبوضات</span>
          <h1>سندات القبض</h1>
          <p>إنشاء السندات ومتابعة حالتها وتوزيعها وترحيلها المحاسبي.</p>
        </div>
        <Button icon="plus" onClick={() => setForm("create")}>
          سند قبض جديد
        </Button>
      </header>

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
            aria-label="البحث في سندات القبض"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="رقم السند أو الوصف"
          />
          <button type="submit">بحث</button>
        </form>
        <select aria-label="حالة السند" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
          <option value="">كل الحالات</option>
          <option value="DRAFT">مسودة</option>
          <option value="POSTED">مرحّل</option>
          <option value="CANCELLED">ملغي</option>
          <option value="REVERSED">معكوس</option>
        </select>
        <label className="date-filter"><span>من</span><input type="date" value={dateFrom} onChange={(event) => { setPage(1); setDateFrom(event.target.value); }} /></label>
        <label className="date-filter"><span>إلى</span><input type="date" value={dateTo} onChange={(event) => { setPage(1); setDateTo(event.target.value); }} /></label>
      </div>

      {error ? (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => void load()}>إعادة المحاولة</Button>
        </div>
      ) : loading ? (
        <Spinner label="جارٍ تحميل سندات القبض" />
      ) : items.length === 0 ? (
        <EmptyState
          title="لا توجد سندات قبض"
          description="أنشئ سندًا جديدًا لتسجيل تحصيل من عميل أو قبض مباشر على حساب."
          action={<Button icon="plus" onClick={() => setForm("create")}>إنشاء سند</Button>}
        />
      ) : (
        <>
          <div className="data-table-wrap">
            <table className="data-table receipts-table">
              <thead><tr><th>رقم السند</th><th>التاريخ</th><th>الطرف</th><th>البيان</th><th>المبلغ</th><th>الحالة</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
              <tbody>
                {items.map((receipt) => (
                  <tr key={receipt.id}>
                    <td><button className="text-link strong" dir="ltr" onClick={() => void openDetails(receipt.id)}>{receipt.document.documentNumber}</button></td>
                    <td>{new Date(receipt.document.documentDate).toLocaleDateString("ar-SA")}</td>
                    <td>{receipt.counterpartyNameSnapshot}</td>
                    <td className="description-cell">{receipt.document.description}</td>
                    <td className="money-cell">{formatMoney(receipt.amount)}</td>
                    <td><span className={`status-chip ${receipt.document.status.toLowerCase()}`}>{statusLabels[receipt.document.status]}</span></td>
                    <td><Button variant="ghost" onClick={() => void openDetails(receipt.id)}>عرض</Button></td>
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
            notify(form === "create" ? "تم إنشاء مسودة سند القبض." : "تم تحديث مسودة السند.");
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
          onPrint={() => void downloadPdf(`/receipts/${selected.id}/pdf`).catch((cause) => notify(cause instanceof Error ? cause.message : "تعذر تنزيل سند القبض.", "error"))}
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
      setErrors((current) => current.filter((message) => message !== missingDatedRateMessage));
    } catch {
      setExchangeRate("");
      setErrors([missingDatedRateMessage]);
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
        counterpartyName || selectedCustomer?.nameAr || "طرف قبض مباشر",
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
      setErrors([cause instanceof ApiError ? cause.message : "تعذر حفظ سند القبض."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={receipt ? `تعديل ${receipt.document.documentNumber}` : "سند قبض جديد"}
      description="سيُحجز رقم السند عند حفظ المسودة."
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
          <span>الفترة المالية *</span>
          <select name="fiscalPeriodId" defaultValue={receipt?.document.fiscalPeriodId} required>
            <option value="">اختر الفترة</option>
            {references.periods.map((period) => (
              <option key={period.id} value={period.id}>{period.name} — {period.startDate} إلى {period.endDate}</option>
            ))}
          </select>
        </label>
        <label><span>تاريخ السند *</span><input name="documentDate" type="date" value={documentDate} onChange={(event) => changeDocumentDate(event.target.value)} required /></label>
        <label className="full"><span>البيان *</span><input name="description" defaultValue={receipt?.document.description} maxLength={500} required /></label>

        <fieldset className="full segmented-field">
          <legend>الطرف المقابل *</legend>
          <div className="segmented">
            <button type="button" className={counterpartyType === "customer" ? "selected" : ""} onClick={() => { setCounterpartyType("customer"); setCounterAccountId(""); setCounterpartyName(""); }}>عميل</button>
            <button type="button" className={counterpartyType === "account" ? "selected" : ""} onClick={() => { setCounterpartyType("account"); setCustomerId(""); setCounterpartyName(""); }}>حساب مباشر</button>
          </div>
        </fieldset>
        {counterpartyType === "customer" ? (
          <label className="full">
            <span>العميل *</span>
            <select
              value={customerId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextCustomer = references.customers.find(
                  (item) => item.id === nextId,
                );
                setCustomerId(nextId);
                setCounterpartyName(nextCustomer?.nameAr ?? "");
              }}
              required
            >
              <option value="">اختر العميل</option>
              {references.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} — {customer.nameAr}</option>)}
            </select>
          </label>
        ) : (
          <label className="full">
            <span>الحساب المقابل *</span>
            <select value={counterAccountId} onChange={(event) => setCounterAccountId(event.target.value)} required>
              <option value="">اختر الحساب</option>
              {references.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.nameAr}</option>)}
            </select>
          </label>
        )}
        <label><span>الصندوق أو البنك *</span><select name="cashBankAccountId" defaultValue={receipt?.cashBankAccountId} required><option value="">اختر الحساب</option>{references.cashBanks.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.nameAr} ({item.accountType === "BANK" ? "بنك" : "صندوق"})</option>)}</select></label>
        <label><span>طريقة الدفع *</span><select value={methodId} onChange={(event) => setMethodId(event.target.value)} required><option value="">اختر الطريقة</option>{references.methods.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>
        <label><span>العملة *</span><select value={currencyId} onChange={(event) => void selectCurrency(event.target.value)} required><option value="">اختر العملة</option>{references.currencies.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.nameAr}</option>)}</select></label>
        <label><span>سعر الصرف *</span><input value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} inputMode="decimal" dir="ltr" placeholder="1.00000000" required /></label>
        <label><span>المبلغ *</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" dir="ltr" placeholder="0.0000" required /></label>
        <label><span>الرقم المرجعي {selectedMethod?.requiresReference && "*"}</span><input name="referenceNumber" defaultValue={receipt?.referenceNumber ?? ""} maxLength={100} required={selectedMethod?.requiresReference} /></label>
        <label><span>اسم الطرف الظاهر *</span><input name="counterpartyName" value={counterpartyName} onChange={(event) => setCounterpartyName(event.target.value)} maxLength={200} required /></label>
        <label><span>الرقم الضريبي للطرف</span><input name="counterpartyTaxNumber" dir="ltr" maxLength={64} placeholder={receipt?.counterpartyTaxMasked ?? ""} /></label>
        <label className="full"><span>عنوان الطرف</span><input name="counterpartyAddress" defaultValue={receipt?.counterpartyAddressSnapshot ?? ""} maxLength={500} /></label>
        <label className="full"><span>ملاحظات</span><textarea name="notes" defaultValue={receipt?.notes ?? ""} maxLength={1000} rows={3} /></label>

        <fieldset className="full allocations-field">
          <legend>توزيع المقبوض على الفواتير</legend>
          <div className="allocation-heading">
            <p>اختر فاتورة مفتوحة للعميل وبنفس عملة السند؛ يُقترح مبلغ التوزيع تلقائياً ويمكن تعديله.</p>
            <Button type="button" variant="secondary" icon="plus" onClick={addAllocation}>إضافة توزيع</Button>
          </div>
          {allocations.length === 0 ? (
            <div className="compact-empty">السند غير موزع على فاتورة محددة.</div>
          ) : (
            <div className="allocation-list">
              {allocations.map((allocation, index) => (
                <div className="allocation-row" key={allocation.id ?? index}>
                  <label><span>الفاتورة المفتوحة</span><select value={allocation.targetJournalLineId} onChange={(event) => selectInvoice(index, event.target.value)} required><option value="">اختر الفاتورة</option>{allocation.targetJournalLineId && !eligibleInvoices.some((invoice) => invoice.arJournalLineId === allocation.targetJournalLineId) && <option value={allocation.targetJournalLineId}>التوزيع الحالي — سطر #{allocation.targetJournalLineId}</option>}{eligibleInvoices.filter((invoice) => !allocations.some((item, itemIndex) => itemIndex !== index && item.targetJournalLineId === invoice.arJournalLineId)).map((invoice) => <option key={invoice.id} value={invoice.arJournalLineId ?? ""}>{invoice.document.documentNumber} — مستحق {formatMoney(invoice.outstandingAmount)} — {invoice.dueDate}</option>)}</select></label>
                  <label><span>المبلغ</span><input dir="ltr" inputMode="decimal" value={allocation.allocatedAmount} onChange={(event) => setAllocations((current) => current.map((item, i) => i === index ? { ...item, allocatedAmount: event.target.value } : item))} required /></label>
                  <button type="button" className="icon-button danger-text" aria-label="حذف التوزيع" onClick={() => setAllocations((current) => current.filter((_, i) => i !== index))}><Icon name="trash" size={18} /></button>
                </div>
              ))}
            </div>
          )}
          <div className={`allocation-total ${allocations.length && Math.abs(allocationTotal - Number(amount || 0)) > 0.00005 ? "mismatch" : ""}`}>
            <span>مجموع التوزيعات</span>
            <strong>{formatMoney(allocationTotal)}</strong>
          </div>
        </fieldset>
        <div className="modal-actions full">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ المسودة"}</Button>
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
          <Button variant="secondary" icon="print" onClick={onPrint}>طباعة PDF</Button>
        )}
        {receipt.document.status === "DRAFT" && (
          <>
            <Button variant="secondary" icon="edit" onClick={onEdit}>تعديل</Button>
            <Button icon="check" onClick={() => onCommand("post")}>ترحيل</Button>
            <Button variant="danger" icon="ban" onClick={() => onCommand("cancel")}>إلغاء</Button>
          </>
        )}
        {receipt.document.status === "POSTED" && (
          <Button variant="danger" icon="reverse" onClick={() => onCommand("reverse")}>عكس السند</Button>
        )}
      </div>
      <div className="document-summary">
        <div><span>الحالة</span><strong className={`status-chip ${receipt.document.status.toLowerCase()}`}>{statusLabels[receipt.document.status]}</strong></div>
        <div><span>التاريخ</span><strong>{new Date(receipt.document.documentDate).toLocaleDateString("ar-SA")}</strong></div>
        <div><span>المبلغ</span><strong>{formatMoney(receipt.amount)} {currency?.code}</strong></div>
      </div>
      <dl className="detail-grid">
        <div><dt>الطرف</dt><dd>{customer?.nameAr ?? receipt.counterpartyNameSnapshot}</dd></div>
        <div><dt>الصندوق/البنك</dt><dd>{cash ? `${cash.code} — ${cash.nameAr}` : receipt.cashBankAccountId}</dd></div>
        <div><dt>طريقة الدفع</dt><dd>{method?.nameAr ?? receipt.paymentMethodId}</dd></div>
        <div><dt>المرجع</dt><dd>{receipt.referenceNumber || "غير مسجل"}</dd></div>
        <div><dt>سعر الصرف</dt><dd dir="ltr">{receipt.exchangeRate}</dd></div>
        <div><dt>مبلغ العملة الأساسية</dt><dd>{formatMoney(receipt.baseAmount)}</dd></div>
        {receipt.notes && <div className="full"><dt>ملاحظات</dt><dd>{receipt.notes}</dd></div>}
      </dl>
      <div className="subsection-heading"><div><h3>التوزيعات</h3><p>{receipt.allocations.length} توزيع</p></div></div>
      {receipt.allocations.length === 0 ? (
        <div className="compact-empty">لا توجد توزيعات مرتبطة بالسند.</div>
      ) : (
        <div className="allocation-detail-list">
          {receipt.allocations.map((allocation) => (
            <div key={allocation.id ?? allocation.targetJournalLineId}>
              <span>سطر قيد #{allocation.targetJournalLineId}</span>
              <strong>{formatMoney(allocation.allocatedAmount)}</strong>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
