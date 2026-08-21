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
  validatePaymentDraft,
} from "./domain";
import type {
  Account,
  Allocation,
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
      setError(cause instanceof Error ? cause.message : "تعذر تحميل سندات الصرف.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, page, status, submittedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void Promise.all([
      api<ListResponse<Supplier>>("/suppliers?page=1&pageSize=100&active=true"),
      api<ListResponse<Account>>("/accounts?page=1&pageSize=100&active=true"),
      api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100"),
      api<ListResponse<CashBankAccount>>("/cash-bank-accounts?page=1&pageSize=100"),
      api<{ data: PaymentMethod[] }>("/payment-methods"),
      api<{ data: Currency[] }>("/currencies"),
      api<ListResponse<PurchaseInvoice>>("/purchase-invoices?page=1&pageSize=100&documentType=PURCHASE_INVOICE&status=POSTED&outstandingOnly=true"),
    ])
      .then(([suppliers, accounts, periods, cashBanks, methods, currencies, purchaseInvoices]) =>
        setReferences({
          suppliers: suppliers.data.filter((item) => item.isActive),
          accounts: accounts.data.filter((item) => item.isActive && item.allowsPosting),
          periods: periods.data.filter((item) => item.status !== "CLOSED"),
          cashBanks: cashBanks.data.filter((item) => item.isActive),
          methods: methods.data,
          currencies: currencies.data,
          purchaseInvoices: purchaseInvoices.data,
        }),
      )
      .catch((cause) =>
        notify(cause instanceof Error ? cause.message : "تعذر تحميل البيانات المرجعية.", "error"),
      );
  }, [notify]);

  async function openDetails(id: string) {
    try {
      setSelected(await api<Payment>(`/payments/${id}`));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "تعذر عرض السند.", "error");
    }
  }

  async function command(
    operation: "post" | "cancel" | "reverse",
    payment: Payment,
  ) {
    const labels = { post: "ترحيل", cancel: "إلغاء", reverse: "عكس" };
    if (!window.confirm(`تأكيد ${labels[operation]} السند ${payment.document.documentNumber}؟`))
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
      notify(`تم ${labels[operation]} السند بنجاح.`);
      setSelected(null);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "تعذر تنفيذ الإجراء.", "error");
      await openDetails(payment.id);
    }
  }

  return (
    <section className="workspace-page">
      <header className="page-heading">
        <div>
          <span className="section-kicker">الخزينة والمدفوعات</span>
          <h1>سندات الصرف</h1>
          <p>إنشاء السندات ومتابعة حالتها وتوزيعها وترحيلها المحاسبي.</p>
        </div>
        <Button icon="plus" onClick={() => setForm("create")}>
          سند صرف جديد
        </Button>
      </header>

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
            aria-label="البحث في سندات الصرف"
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
        <Spinner label="جارٍ تحميل سندات الصرف" />
      ) : items.length === 0 ? (
        <EmptyState
          title="لا توجد سندات صرف"
          description="أنشئ سندًا جديدًا لتسجيل دفعة لمورد أو صرف مباشر على حساب."
          action={<Button icon="plus" onClick={() => setForm("create")}>إنشاء سند</Button>}
        />
      ) : (
        <>
          <div className="data-table-wrap">
            <table className="data-table payments-table">
              <thead><tr><th>رقم السند</th><th>التاريخ</th><th>الطرف</th><th>البيان</th><th>المبلغ</th><th>الحالة</th><th><span className="sr-only">إجراءات</span></th></tr></thead>
              <tbody>
                {items.map((payment) => (
                  <tr key={payment.id}>
                    <td><button className="text-link strong" dir="ltr" onClick={() => void openDetails(payment.id)}>{payment.document.documentNumber}</button></td>
                    <td>{new Date(payment.document.documentDate).toLocaleDateString("ar-SA")}</td>
                    <td>{payment.counterpartyNameSnapshot}</td>
                    <td className="description-cell">{payment.document.description}</td>
                    <td className="money-cell">{formatMoney(payment.amount)}</td>
                    <td><span className={`status-chip ${payment.document.status.toLowerCase()}`}>{statusLabels[payment.document.status]}</span></td>
                    <td><Button variant="ghost" onClick={() => void openDetails(payment.id)}>عرض</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...meta} page={page} onChange={setPage} />
        </>
      )}

      {form && (
        <PaymentForm
          payment={form === "edit" ? selected : null}
          references={references}
          onClose={() => setForm(null)}
          onSaved={async (payment) => {
            setForm(null);
            setSelected(payment);
            notify(form === "create" ? "تم إنشاء مسودة سند الصرف." : "تم تحديث مسودة السند.");
            await load();
          }}
        />
      )}
      {selected && !form && (
        <PaymentDetails
          payment={selected}
          references={references}
          onClose={() => setSelected(null)}
          onEdit={() => setForm("edit")}
          onCommand={(operation) => void command(operation, selected)}
          onPrint={() => void downloadPdf(`/payments/${selected.id}/pdf`).catch((cause) => notify(cause instanceof Error ? cause.message : "تعذر تنزيل سند الصرف.", "error"))}
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
  const [allocations, setAllocations] = useState<Allocation[]>(payment?.allocations ?? []);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        counterpartyName || selectedSupplier?.nameAr || "طرف صرف مباشر",
      ...(value("counterpartyTaxNumber")
        ? { counterpartyTaxNumber: value("counterpartyTaxNumber") }
        : payment
          ? {}
          : { counterpartyTaxNumber: null }),
      counterpartyAddress: value("counterpartyAddress") || null,
      notes: value("notes") || null,
      allocations: allocations.map((allocation) => ({
        targetJournalLineId: allocation.targetJournalLineId,
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
      setErrors([cause instanceof ApiError ? cause.message : "تعذر حفظ سند الصرف."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={payment ? `تعديل ${payment.document.documentNumber}` : "سند صرف جديد"}
      description="سيُحجز رقم السند عند حفظ المسودة."
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
          <span>الفترة المالية *</span>
          <select name="fiscalPeriodId" defaultValue={payment?.document.fiscalPeriodId} required>
            <option value="">اختر الفترة</option>
            {references.periods.map((period) => (
              <option key={period.id} value={period.id}>{period.name} — {period.startDate} إلى {period.endDate}</option>
            ))}
          </select>
        </label>
        <label><span>تاريخ السند *</span><input name="documentDate" type="date" value={documentDate} onChange={(event) => changeDocumentDate(event.target.value)} required /></label>
        <label className="full"><span>البيان *</span><input name="description" defaultValue={payment?.document.description} maxLength={500} required /></label>

        <fieldset className="full segmented-field">
          <legend>الطرف المقابل *</legend>
          <div className="segmented">
            <button type="button" className={counterpartyType === "supplier" ? "selected" : ""} onClick={() => { setCounterpartyType("supplier"); setCounterAccountId(""); setCounterpartyName(""); }}>مورد</button>
            <button type="button" className={counterpartyType === "account" ? "selected" : ""} onClick={() => { setCounterpartyType("account"); setSupplierId(""); setCounterpartyName(""); }}>حساب مباشر</button>
          </div>
        </fieldset>
        {counterpartyType === "supplier" ? (
          <label className="full">
            <span>المورد *</span>
            <select
              value={supplierId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextSupplier = references.suppliers.find(
                  (item) => item.id === nextId,
                );
                setSupplierId(nextId);
                setCounterpartyName(nextSupplier?.nameAr ?? "");
              }}
              required
            >
              <option value="">اختر المورد</option>
              {references.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.nameAr}</option>)}
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
        <label><span>الصندوق أو البنك *</span><select name="cashBankAccountId" defaultValue={payment?.cashBankAccountId} required><option value="">اختر الحساب</option>{references.cashBanks.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.nameAr} ({item.accountType === "BANK" ? "بنك" : "صندوق"})</option>)}</select></label>
        <label><span>طريقة الدفع *</span><select value={methodId} onChange={(event) => setMethodId(event.target.value)} required><option value="">اختر الطريقة</option>{references.methods.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>
        <label><span>العملة *</span><select value={currencyId} onChange={(event) => void selectCurrency(event.target.value)} required><option value="">اختر العملة</option>{references.currencies.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.nameAr}</option>)}</select></label>
        <label><span>سعر الصرف *</span><input value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} inputMode="decimal" dir="ltr" placeholder="1.00000000" required /></label>
        <label><span>المبلغ *</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" dir="ltr" placeholder="0.0000" required /></label>
        <label><span>الرقم المرجعي {selectedMethod?.requiresReference && "*"}</span><input name="referenceNumber" defaultValue={payment?.referenceNumber ?? ""} maxLength={100} required={selectedMethod?.requiresReference} /></label>
        <label><span>اسم الطرف الظاهر *</span><input name="counterpartyName" value={counterpartyName} onChange={(event) => setCounterpartyName(event.target.value)} maxLength={200} required /></label>
        <label><span>الرقم الضريبي للطرف</span><input name="counterpartyTaxNumber" dir="ltr" maxLength={64} placeholder={payment?.counterpartyTaxMasked ?? ""} /></label>
        <label className="full"><span>عنوان الطرف</span><input name="counterpartyAddress" defaultValue={payment?.counterpartyAddressSnapshot ?? ""} maxLength={500} /></label>
        <label className="full"><span>ملاحظات</span><textarea name="notes" defaultValue={payment?.notes ?? ""} maxLength={1000} rows={3} /></label>

        <fieldset className="full allocations-field">
          <legend>توزيع الدفعة على الالتزامات</legend>
          <div className="allocation-heading">
            <p>اختر فواتير المورد المفتوحة. يجب أن يساوي مجموع التوزيعات مبلغ السند.</p>
            <Button type="button" variant="secondary" icon="plus" onClick={addAllocation}>إضافة توزيع</Button>
          </div>
          {allocations.length === 0 ? (
            <div className="compact-empty">السند غير موزع على التزام محدد.</div>
          ) : (
            <div className="allocation-list">
              {allocations.map((allocation, index) => (
                <div className="allocation-row" key={allocation.id ?? index}>
                  <label><span>فاتورة المورد</span><select value={allocation.targetJournalLineId} onChange={(event) => { const selectedInvoice = openInvoices.find((invoice) => invoice.apJournalLineId === event.target.value); setAllocations((current) => current.map((item, i) => i === index ? { ...item, targetJournalLineId: event.target.value, allocatedAmount: selectedInvoice ? selectedInvoice.outstandingAmount : item.allocatedAmount } : item)); }}><option value="">اختر الفاتورة المفتوحة</option>{openInvoices.map((invoice) => <option key={invoice.id} value={invoice.apJournalLineId ?? ""}>{invoice.document.documentNumber}{invoice.supplierInvoiceNumber ? ` — مرجع ${invoice.supplierInvoiceNumber}` : ""} — متبقٍ {formatMoney(invoice.outstandingAmount)}</option>)}</select></label>
                  <label><span>المبلغ</span><input dir="ltr" inputMode="decimal" value={allocation.allocatedAmount} onChange={(event) => setAllocations((current) => current.map((item, i) => i === index ? { ...item, allocatedAmount: event.target.value } : item))} /></label>
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
  const supplier = references.suppliers.find((item) => item.id === payment.supplierId);
  const cash = references.cashBanks.find((item) => item.id === payment.cashBankAccountId);
  const method = references.methods.find((item) => item.id === payment.paymentMethodId);
  const currency = references.currencies.find((item) => item.id === payment.currencyId);
  return (
    <Modal title={payment.document.documentNumber} description={payment.document.description} onClose={onClose} wide>
      <div className="detail-actions">
        {(payment.document.status === "POSTED" || payment.document.status === "REVERSED") && (
          <Button variant="secondary" icon="print" onClick={onPrint}>طباعة PDF</Button>
        )}
        {payment.document.status === "DRAFT" && (
          <>
            <Button variant="secondary" icon="edit" onClick={onEdit}>تعديل</Button>
            <Button icon="check" onClick={() => onCommand("post")}>ترحيل</Button>
            <Button variant="danger" icon="ban" onClick={() => onCommand("cancel")}>إلغاء</Button>
          </>
        )}
        {payment.document.status === "POSTED" && (
          <Button variant="danger" icon="reverse" onClick={() => onCommand("reverse")}>عكس السند</Button>
        )}
      </div>
      <div className="document-summary">
        <div><span>الحالة</span><strong className={`status-chip ${payment.document.status.toLowerCase()}`}>{statusLabels[payment.document.status]}</strong></div>
        <div><span>التاريخ</span><strong>{new Date(payment.document.documentDate).toLocaleDateString("ar-SA")}</strong></div>
        <div><span>المبلغ</span><strong>{formatMoney(payment.amount)} {currency?.code}</strong></div>
      </div>
      <dl className="detail-grid">
        <div><dt>الطرف</dt><dd>{supplier?.nameAr ?? payment.counterpartyNameSnapshot}</dd></div>
        <div><dt>الصندوق/البنك</dt><dd>{cash ? `${cash.code} — ${cash.nameAr}` : payment.cashBankAccountId}</dd></div>
        <div><dt>طريقة الدفع</dt><dd>{method?.nameAr ?? payment.paymentMethodId}</dd></div>
        <div><dt>المرجع</dt><dd>{payment.referenceNumber || "غير مسجل"}</dd></div>
        <div><dt>سعر الصرف</dt><dd dir="ltr">{payment.exchangeRate}</dd></div>
        <div><dt>مبلغ العملة الأساسية</dt><dd>{formatMoney(payment.baseAmount)}</dd></div>
        {payment.notes && <div className="full"><dt>ملاحظات</dt><dd>{payment.notes}</dd></div>}
      </dl>
      <div className="subsection-heading"><div><h3>التوزيعات</h3><p>{payment.allocations.length} توزيع</p></div></div>
      {payment.allocations.length === 0 ? (
        <div className="compact-empty">لا توجد توزيعات مرتبطة بالسند.</div>
      ) : (
        <div className="allocation-detail-list">
          {payment.allocations.map((allocation) => (
            <div key={allocation.id ?? allocation.targetJournalLineId}>
              <span>{references.purchaseInvoices.find((invoice) => invoice.apJournalLineId === allocation.targetJournalLineId)?.document.documentNumber ?? `سطر قيد #${allocation.targetJournalLineId}`}</span>
              <strong>{formatMoney(allocation.allocatedAmount)}</strong>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
