import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, idempotencyKey } from "./api";
import { exchangeRateForDocumentDate, missingDatedRateMessage } from "./currency-rates";
import { exchangeRateForCurrency, formatMoney, statusLabels, toMoney, toRate } from "./domain";
import type { Account, AccountType, CostCenter, Currency, Customer, FiscalPeriod, ListResponse, ReceivablesAgingReport, SalesInvoice, SalesInvoiceLine, TaxRate } from "./types";
import { Button, EmptyState, Modal, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Section = "invoices" | "aging" | "taxes";
type InvoiceType = "SALES_INVOICE" | "SALES_CREDIT_NOTE";
type References = { customers: Customer[]; accounts: Account[]; accountTypes: AccountType[]; periods: FiscalPeriod[]; costCenters: CostCenter[]; currencies: Currency[]; taxRates: TaxRate[]; sourceInvoices: SalesInvoice[] };
const emptyReferences: References = { customers: [], accounts: [], accountTypes: [], periods: [], costCenters: [], currencies: [], taxRates: [], sourceInvoices: [] };

export function SalesInvoicesPage({ notify }: { notify: Notice }) {
  const [section, setSection] = useState<Section>("invoices");
  const [items, setItems] = useState<SalesInvoice[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SalesInvoice | null>(null);
  const [form, setForm] = useState<{ type: InvoiceType; invoice: SalesInvoice | null } | null>(null);
  const [references, setReferences] = useState<References>(emptyReferences);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "10", ...(status ? { status } : {}), ...(documentType ? { documentType } : {}), ...(submittedSearch ? { search: submittedSearch } : {}) });
      const result = await api<ListResponse<SalesInvoice>>(`/sales-invoices?${query}`);
      setItems(result.data); setMeta(result.meta);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل فواتير المبيعات."); }
    finally { setLoading(false); }
  }, [documentType, page, status, submittedSearch]);

  const loadReferences = useCallback(async () => {
    try {
      const [customers, accounts, accountTypes, periods, centers, currencies, taxRates, sources] = await Promise.all([
        api<ListResponse<Customer>>("/customers?page=1&pageSize=100&active=true"),
        api<ListResponse<Account>>("/accounts?page=1&pageSize=100&active=true"),
        api<{ data: AccountType[] }>("/account-types"),
        api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100"),
        api<ListResponse<CostCenter>>("/cost-centers?page=1&pageSize=100&active=true"),
        api<{ data: Currency[] }>("/currencies"),
        api<{ data: TaxRate[] }>("/tax-rates?activeOnly=false"),
        api<ListResponse<SalesInvoice>>("/sales-invoices?page=1&pageSize=100&documentType=SALES_INVOICE&status=POSTED"),
      ]);
      setReferences({ customers: customers.data.filter((item) => item.isActive), accounts: accounts.data.filter((item) => item.isActive && item.allowsPosting), accountTypes: accountTypes.data, periods: periods.data.filter((item) => item.status !== "CLOSED"), costCenters: centers.data.filter((item) => item.isActive), currencies: currencies.data, taxRates: taxRates.data, sourceInvoices: sources.data });
    } catch (cause) { notify(cause instanceof Error ? cause.message : "تعذر تحميل مراجع الفواتير.", "error"); }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadReferences(); }, [loadReferences]);

  async function openDetails(id: string) {
    try { setSelected(await api<SalesInvoice>(`/sales-invoices/${id}`)); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "تعذر عرض الفاتورة.", "error"); }
  }

  async function command(operation: "post" | "cancel" | "reverse", invoice: SalesInvoice) {
    const action = { post: "ترحيل", cancel: "إلغاء", reverse: "عكس" }[operation];
    if (!window.confirm(`تأكيد ${action} المستند ${invoice.document.documentNumber}؟`)) return;
    const reason = operation === "post" ? "" : window.prompt(`سبب ${action} المستند (3 أحرف على الأقل):`);
    if (operation !== "post" && (!reason || reason.trim().length < 3)) return;
    const reversalDate = operation === "reverse" ? window.prompt("تاريخ العكس:", new Date().toISOString().slice(0, 10)) : "";
    if (operation === "reverse" && !reversalDate) return;
    try {
      await api(`/sales-invoices/${invoice.id}/${operation}`, { method: "POST", idempotencyKey: operation === "cancel" ? undefined : idempotencyKey(operation, invoice.id), body: JSON.stringify({ version: invoice.document.version, ...(reason ? { reason: reason.trim() } : {}), ...(reversalDate ? { reversalDate } : {}) }) });
      notify(`تم ${action} المستند بنجاح.`); setSelected(null); await Promise.all([load(), loadReferences()]);
    } catch (cause) { notify(cause instanceof Error ? cause.message : "تعذر تنفيذ الإجراء.", "error"); await openDetails(invoice.id); }
  }

  return <section className="workspace-page sales-workspace">
    <header className="page-heading"><div><span className="section-kicker">المبيعات والذمم المدينة</span><h1>فواتير المبيعات</h1><p>إصدار الفواتير والإشعارات الدائنة، التحصيل، ومراقبة أعمار الديون.</p></div>{section === "invoices" && <div className="page-actions"><Button variant="secondary" icon="reverse" onClick={() => setForm({ type: "SALES_CREDIT_NOTE", invoice: null })}>إشعار دائن</Button><Button icon="plus" onClick={() => setForm({ type: "SALES_INVOICE", invoice: null })}>فاتورة جديدة</Button></div>}</header>
    <div className="section-tabs sales-tabs" role="tablist">
      <button className={section === "invoices" ? "active" : ""} onClick={() => setSection("invoices")}>الفواتير والإشعارات</button>
      <button className={section === "aging" ? "active" : ""} onClick={() => setSection("aging")}>أعمار الديون</button>
      <button className={section === "taxes" ? "active" : ""} onClick={() => setSection("taxes")}>نسب الضريبة</button>
    </div>
    {section === "invoices" && <>
      <div className="toolbar sales-filters"><form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedSearch(search.trim()); }}><input aria-label="البحث في الفواتير" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="رقم المستند أو العميل أو البيان" /><button>بحث</button></form><select aria-label="نوع المستند" value={documentType} onChange={(event) => { setPage(1); setDocumentType(event.target.value); }}><option value="">كل المستندات</option><option value="SALES_INVOICE">فاتورة مبيعات</option><option value="SALES_CREDIT_NOTE">إشعار دائن</option></select><select aria-label="حالة المستند" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="POSTED">مرحّل</option><option value="CANCELLED">ملغي</option><option value="REVERSED">معكوس</option></select></div>
      {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>إعادة المحاولة</Button></div> : loading ? <Spinner label="جارٍ تحميل الفواتير" /> : !items.length ? <EmptyState title="لا توجد فواتير" description="أنشئ فاتورة مبيعات لتبدأ دورة الذمم والتحصيل." action={<Button icon="plus" onClick={() => setForm({ type: "SALES_INVOICE", invoice: null })}>إنشاء فاتورة</Button>} /> : <><div className="data-table-wrap"><table className="data-table sales-invoices-table"><thead><tr><th>المستند</th><th>النوع</th><th>العميل</th><th>التاريخ والاستحقاق</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody>{items.map((invoice) => <tr key={invoice.id}><td><button className="text-link strong" dir="ltr" onClick={() => void openDetails(invoice.id)}>{invoice.document.documentNumber}</button></td><td>{invoice.document.documentType === "SALES_INVOICE" ? "فاتورة" : "إشعار دائن"}</td><td>{invoice.customerNameSnapshot}</td><td>{invoice.document.documentDate}<small>الاستحقاق: {invoice.dueDate}</small></td><td className="money-cell">{formatMoney(invoice.total)}</td><td className="money-cell">{invoice.document.documentType === "SALES_INVOICE" ? formatMoney(invoice.outstandingAmount) : "—"}</td><td><span className={`status-chip ${invoice.document.status.toLowerCase()}`}>{statusLabels[invoice.document.status]}</span>{invoice.document.status === "POSTED" && invoice.document.documentType === "SALES_INVOICE" && <small>{settlementLabel(invoice.settlementStatus)}</small>}</td><td><Button variant="ghost" onClick={() => void openDetails(invoice.id)}>عرض</Button></td></tr>)}</tbody></table></div><Pagination {...meta} page={page} onChange={setPage} /></>}
    </>}
    {section === "aging" && <AgingReport customers={references.customers} />}
    {section === "taxes" && <TaxRatesPanel references={references} notify={notify} onChanged={loadReferences} />}
    {form && <InvoiceForm type={form.type} invoice={form.invoice} references={references} onClose={() => setForm(null)} onSaved={async (invoice) => { setForm(null); setSelected(invoice); notify(form.invoice ? "تم تحديث المسودة." : form.type === "SALES_INVOICE" ? "تم إنشاء مسودة الفاتورة." : "تم إنشاء مسودة الإشعار الدائن."); await Promise.all([load(), loadReferences()]); }} />}
    {selected && !form && <InvoiceDetails invoice={selected} onClose={() => setSelected(null)} onEdit={() => setForm({ type: selected.document.documentType as InvoiceType, invoice: selected })} onCommand={(operation) => void command(operation, selected)} />}
  </section>;
}

type DraftLine = { description: string; quantity: string; unitPrice: string; discountAmount: string; revenueAccountId: string; costCenterId: string; taxRateId: string };
const blankLine = (): DraftLine => ({ description: "", quantity: "1.0000", unitPrice: "", discountAmount: "0.0000", revenueAccountId: "", costCenterId: "", taxRateId: "" });

function InvoiceForm({ type, invoice, references, onClose, onSaved }: { type: InvoiceType; invoice: SalesInvoice | null; references: References; onClose: () => void; onSaved: (value: SalesInvoice) => void }) {
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? "");
  const [currencyId, setCurrencyId] = useState(invoice?.currencyId ?? references.currencies[0]?.id ?? "");
  const [exchangeRate, setExchangeRate] = useState(invoice?.exchangeRate ?? exchangeRateForCurrency(references.currencies[0]));
  const [documentDate, setDocumentDate] = useState(invoice?.document.documentDate ?? new Date().toISOString().slice(0, 10));
  const [sourceInvoiceId, setSourceInvoiceId] = useState(invoice?.sourceInvoiceId ?? "");
  const [lines, setLines] = useState<DraftLine[]>(invoice?.lines.map(lineDraft) ?? [blankLine()]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const revenueType = references.accountTypes.find((item) => item.code === "REVENUE");
  const revenueAccounts = references.accounts.filter((account) => account.accountTypeId === revenueType?.id);
  const sources = references.sourceInvoices.filter((item) => item.customerId === customerId && Number(item.total) > Number(item.creditedAmount));
  const totals = useMemo(() => lines.reduce((value, line) => { const gross = Number(line.quantity || 0) * Number(line.unitPrice || 0); const discount = Number(line.discountAmount || 0); const net = Math.max(0, gross - discount); const tax = net * Number(references.taxRates.find((item) => item.id === line.taxRateId)?.rate ?? 0) / 100; return { subtotal: value.subtotal + gross, discount: value.discount + discount, tax: value.tax + tax, total: value.total + net + tax }; }, { subtotal: 0, discount: 0, tax: 0, total: 0 }), [lines, references.taxRates]);

  useEffect(() => { if (!currencyId && references.currencies[0]) { setCurrencyId(references.currencies[0].id); setExchangeRate(exchangeRateForCurrency(references.currencies[0])); } }, [currencyId, references.currencies]);
  async function selectCurrency(id: string, date = documentDate) { const selected = references.currencies.find((currency) => currency.id === id); setCurrencyId(id); try { setExchangeRate(await exchangeRateForDocumentDate(selected, date)); setErrors((current) => current.filter((message) => message !== missingDatedRateMessage)); } catch { setExchangeRate(""); setErrors([missingDatedRateMessage]); } }
  function changeDocumentDate(value: string) { setDocumentDate(value); if (currencyId) void selectCurrency(currencyId, value); }
  function setLine(index: number, patch: Partial<DraftLine>) { setLines((current) => current.map((line, position) => position === index ? { ...line, ...patch } : line)); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget); const value = (name: string) => String(data.get(name) ?? "").trim();
    const validation: string[] = [];
    if (!customerId) validation.push("اختر العميل.");
    if (type === "SALES_CREDIT_NOTE" && !sourceInvoiceId) validation.push("اختر الفاتورة الأصلية.");
    if (!lines.length || lines.some((line) => !line.description.trim() || !line.revenueAccountId || Number(line.quantity) <= 0 || Number(line.unitPrice) < 0 || Number(line.discountAmount) < 0 || Number(line.discountAmount) > Number(line.quantity) * Number(line.unitPrice))) validation.push("راجع وصف وحساب وكميات وأسعار وخصومات جميع البنود.");
    if (totals.total <= 0) validation.push("يجب أن يكون إجمالي المستند أكبر من صفر.");
    if (validation.length) { setErrors(validation); return; }
    setSaving(true); setErrors([]);
    try {
      const result = await api<SalesInvoice>(invoice ? `/sales-invoices/${invoice.id}` : "/sales-invoices", { method: invoice ? "PATCH" : "POST", body: JSON.stringify({ documentType: type, fiscalPeriodId: value("fiscalPeriodId"), documentDate: value("documentDate"), dueDate: value("dueDate"), description: value("description"), customerId, sourceInvoiceId: type === "SALES_CREDIT_NOTE" ? sourceInvoiceId : null, currencyId, exchangeRate: toRate(exchangeRate), customerAddress: value("customerAddress") || null, notes: value("notes") || null, lines: lines.map((line) => ({ description: line.description.trim(), quantity: toMoney(line.quantity), unitPrice: toMoney(line.unitPrice), discountAmount: toMoney(line.discountAmount), revenueAccountId: line.revenueAccountId, costCenterId: line.costCenterId || null, taxRateId: line.taxRateId || null })), ...(invoice ? { version: invoice.document.version } : {}) }) });
      onSaved(result);
    } catch (cause) { setErrors([cause instanceof ApiError ? cause.message : "تعذر حفظ المستند."]); }
    finally { setSaving(false); }
  }

  return <Modal title={invoice ? `تعديل ${invoice.document.documentNumber}` : type === "SALES_INVOICE" ? "فاتورة مبيعات جديدة" : "إشعار دائن جديد"} description="تُحسب الخصومات والضريبة آليًا وتُثبت قيمها عند الترحيل." onClose={onClose} wide><form className="form-grid sales-invoice-form" onSubmit={submit}>{errors.length > 0 && <div className="form-error full" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    <label><span>الفترة المالية *</span><select name="fiscalPeriodId" defaultValue={invoice?.document.fiscalPeriodId} required><option value="">اختر الفترة</option>{references.periods.map((period) => <option key={period.id} value={period.id}>{period.name} — {period.startDate} إلى {period.endDate}</option>)}</select></label>
    <label><span>تاريخ المستند *</span><input name="documentDate" type="date" value={documentDate} onChange={(event) => changeDocumentDate(event.target.value)} required /></label>
    <label><span>تاريخ الاستحقاق *</span><input name="dueDate" type="date" defaultValue={invoice?.dueDate ?? new Date().toISOString().slice(0, 10)} required /></label>
    <label><span>العميل *</span><select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setSourceInvoiceId(""); }} required><option value="">اختر العميل</option>{references.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} — {customer.nameAr}</option>)}</select></label>
    {type === "SALES_CREDIT_NOTE" && <label className="full"><span>الفاتورة الأصلية *</span><select value={sourceInvoiceId} onChange={(event) => setSourceInvoiceId(event.target.value)} required><option value="">اختر الفاتورة</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.document.documentNumber} — إجمالي {formatMoney(source.total)} — متبقٍ {formatMoney(source.outstandingAmount)}</option>)}</select></label>}
    <label className="full"><span>البيان *</span><input name="description" defaultValue={invoice?.document.description} maxLength={500} required /></label>
    <label><span>العملة *</span><select value={currencyId} onChange={(event) => void selectCurrency(event.target.value)} required>{references.currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} — {currency.nameAr}</option>)}</select></label>
    <label><span>سعر الصرف *</span><input dir="ltr" inputMode="decimal" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} required /></label>
    <label className="full"><span>عنوان الفوترة الظاهر</span><input name="customerAddress" defaultValue={invoice?.customerAddressSnapshot ?? ""} maxLength={500} placeholder="يُستخدم عنوان العميل الأساسي تلقائيًا عند تركه فارغًا" /></label>
    <fieldset className="full invoice-lines-field"><legend>بنود المستند *</legend><div className="invoice-line-list">{lines.map((line, index) => <div className="invoice-line-editor" key={index}><span className="line-index">{index + 1}</span><label className="line-description"><span>الوصف</span><input value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} required /></label><label><span>الكمية</span><input dir="ltr" inputMode="decimal" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} required /></label><label><span>سعر الوحدة</span><input dir="ltr" inputMode="decimal" value={line.unitPrice} onChange={(event) => setLine(index, { unitPrice: event.target.value })} required /></label><label><span>الخصم</span><input dir="ltr" inputMode="decimal" value={line.discountAmount} onChange={(event) => setLine(index, { discountAmount: event.target.value })} required /></label><label><span>حساب الإيراد</span><select value={line.revenueAccountId} onChange={(event) => setLine(index, { revenueAccountId: event.target.value })} required><option value="">اختر</option>{revenueAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.nameAr}</option>)}</select></label><label><span>الضريبة</span><select value={line.taxRateId} onChange={(event) => setLine(index, { taxRateId: event.target.value })}><option value="">بدون ضريبة</option>{references.taxRates.filter((tax) => tax.isActive).map((tax) => <option key={tax.id} value={tax.id}>{tax.nameAr} ({Number(tax.rate)}%)</option>)}</select></label><label><span>مركز التكلفة</span><select value={line.costCenterId} onChange={(event) => setLine(index, { costCenterId: event.target.value })}><option value="">بدون</option>{references.costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}</select></label><Button type="button" variant="ghost" icon="trash" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>حذف</Button></div>)}</div><Button type="button" variant="secondary" icon="plus" onClick={() => setLines((current) => [...current, blankLine()])}>إضافة بند</Button></fieldset>
    <div className="invoice-live-summary full"><span>قبل الخصم <strong>{formatMoney(totals.subtotal)}</strong></span><span>الخصم <strong>{formatMoney(totals.discount)}</strong></span><span>الضريبة <strong>{formatMoney(totals.tax)}</strong></span><span className="grand-total">الإجمالي <strong>{formatMoney(totals.total)}</strong></span></div>
    <label className="full"><span>ملاحظات</span><textarea name="notes" defaultValue={invoice?.notes ?? ""} maxLength={1000} rows={3} /></label>
    <div className="form-actions full"><Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ المسودة"}</Button></div>
  </form></Modal>;
}

function lineDraft(line: SalesInvoiceLine): DraftLine { return { description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount, revenueAccountId: line.revenueAccountId, costCenterId: line.costCenterId ?? "", taxRateId: line.taxRateId ?? "" }; }

function InvoiceDetails({ invoice, onClose, onEdit, onCommand }: { invoice: SalesInvoice; onClose: () => void; onEdit: () => void; onCommand: (operation: "post" | "cancel" | "reverse") => void }) {
  return <Modal title={`${invoice.document.documentType === "SALES_INVOICE" ? "فاتورة" : "إشعار دائن"} ${invoice.document.documentNumber}`} description={`${invoice.customerNameSnapshot} — ${statusLabels[invoice.document.status]}`} onClose={onClose} wide><div className="detail-actions">{invoice.document.status === "DRAFT" && <><Button icon="edit" variant="secondary" onClick={onEdit}>تعديل</Button><Button icon="check" onClick={() => onCommand("post")}>ترحيل</Button><Button icon="ban" variant="danger" onClick={() => onCommand("cancel")}>إلغاء</Button></>}{invoice.document.status === "POSTED" && <Button icon="reverse" variant="danger" onClick={() => onCommand("reverse")}>عكس</Button>}</div><div className="document-summary invoice-summary"><div><span>تاريخ المستند</span><strong>{invoice.document.documentDate}</strong></div><div><span>الاستحقاق</span><strong>{invoice.dueDate}</strong></div><div><span>العملة</span><strong>{invoice.currency?.code}</strong></div><div><span>قبل الخصم</span><strong>{formatMoney(invoice.subtotal)}</strong></div><div><span>الخصم</span><strong>{formatMoney(invoice.discountTotal)}</strong></div><div><span>الضريبة</span><strong>{formatMoney(invoice.taxTotal)}</strong></div><div><span>الإجمالي</span><strong>{formatMoney(invoice.total)}</strong></div>{invoice.document.documentType === "SALES_INVOICE" && <><div><span>المحصّل</span><strong>{formatMoney(invoice.paidAmount)}</strong></div><div><span>الإشعارات الدائنة</span><strong>{formatMoney(invoice.creditedAmount)}</strong></div><div><span>المتبقي</span><strong>{formatMoney(invoice.outstandingAmount)}</strong></div></>}</div>{invoice.sourceInvoiceNumber && <div className="inline-notice neutral">مرجع الفاتورة الأصلية: <strong dir="ltr">{invoice.sourceInvoiceNumber}</strong></div>}<div className="data-table-wrap flat"><table className="data-table"><thead><tr><th>#</th><th>الوصف</th><th>الحساب</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الضريبة</th><th>الإجمالي</th></tr></thead><tbody>{invoice.lines.map((line) => <tr key={line.id}><td>{line.lineNumber}</td><td>{line.description}</td><td>{line.revenueAccount?.code} — {line.revenueAccount?.nameAr}</td><td>{formatMoney(line.quantity)}</td><td>{formatMoney(line.unitPrice)}</td><td>{formatMoney(line.discountAmount)}</td><td>{formatMoney(line.taxAmount)}<small>{Number(line.taxRateSnapshot)}%</small></td><td className="money-cell">{formatMoney(line.totalAmount)}</td></tr>)}</tbody></table></div>{invoice.notes && <div className="notes-panel"><strong>ملاحظات</strong><p>{invoice.notes}</p></div>}</Modal>;
}

function AgingReport({ customers }: { customers: Customer[] }) {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10)); const [customerId, setCustomerId] = useState(""); const [report, setReport] = useState<ReceivablesAgingReport | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setReport(await api<ReceivablesAgingReport>(`/reports/receivables-aging?asOf=${asOf}${customerId ? `&customerId=${customerId}` : ""}`)); } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إعداد تقرير الأعمار."); } finally { setLoading(false); } }, [asOf, customerId]);
  useEffect(() => { void load(); }, [load]);
  return <article className="panel aging-panel"><header><div><h2>أعمار ديون العملاء</h2><p>الرصيد المفتوح بعد التحصيلات والإشعارات الدائنة حتى التاريخ المحدد.</p></div></header><div className="report-toolbar aging-toolbar"><label><span>كما في</span><input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label><label><span>العميل</span><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">كل العملاء</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} — {customer.nameAr}</option>)}</select></label><Button onClick={() => void load()}>إعداد التقرير</Button></div>{error ? <div className="inline-notice">{error}</div> : loading ? <Spinner label="جارٍ احتساب أعمار الديون" /> : !report?.data.length ? <EmptyState title="لا توجد ذمم مفتوحة" description="لا توجد فواتير مدينة مفتوحة حتى التاريخ المحدد." /> : <div className="data-table-wrap flat"><table className="data-table aging-table"><thead><tr><th>العميل</th><th>غير مستحق</th><th>1–30 يومًا</th><th>31–60 يومًا</th><th>61–90 يومًا</th><th>أكثر من 90</th><th>الإجمالي</th></tr></thead><tbody>{report.data.map((row) => <tr key={row.customerId}><td><strong>{row.customerName}</strong><small>{row.customerCode} — {row.invoices.length} فاتورة</small></td><td>{formatMoney(row.current)}</td><td>{formatMoney(row.days1To30)}</td><td>{formatMoney(row.days31To60)}</td><td>{formatMoney(row.days61To90)}</td><td>{formatMoney(row.daysOver90)}</td><td className="money-cell">{formatMoney(row.total)}</td></tr>)}</tbody><tfoot><tr><th>الإجمالي</th><th>{formatMoney(report.totals.current)}</th><th>{formatMoney(report.totals.days1To30)}</th><th>{formatMoney(report.totals.days31To60)}</th><th>{formatMoney(report.totals.days61To90)}</th><th>{formatMoney(report.totals.daysOver90)}</th><th>{formatMoney(report.totals.total)}</th></tr></tfoot></table></div>}</article>;
}

function TaxRatesPanel({ references, notify, onChanged }: { references: References; notify: Notice; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<TaxRate | null | undefined>(undefined);
  return <article className="panel tax-rates-panel"><header><div><h2>نسب ضريبة المبيعات</h2><p>ترتبط كل نسبة موجبة بحساب ضريبة مخرجات من الالتزامات.</p></div><Button icon="plus" onClick={() => setEditing(null)}>نسبة جديدة</Button></header>{!references.taxRates.length ? <EmptyState title="لا توجد نسب ضريبة" description="أضف النسبة المعتمدة وحساب ضريبة المخرجات." /> : <div className="data-table-wrap flat"><table className="data-table"><thead><tr><th>الرمز</th><th>الاسم</th><th>النسبة</th><th>حساب المخرجات</th><th>الحالة</th><th></th></tr></thead><tbody>{references.taxRates.map((tax) => <tr key={tax.id}><td><span className="code-pill">{tax.code}</span></td><td>{tax.nameAr}</td><td>{Number(tax.rate)}%</td><td>{tax.outputTaxAccount ? `${tax.outputTaxAccount.code} — ${tax.outputTaxAccount.nameAr}` : "لا يوجد"}</td><td><span className={`status-chip ${tax.isActive ? "active" : "inactive"}`}>{tax.isActive ? "نشطة" : "معطلة"}</span></td><td><Button variant="ghost" icon="edit" onClick={() => setEditing(tax)}>تعديل</Button></td></tr>)}</tbody></table></div>}{editing !== undefined && <TaxRateForm taxRate={editing} references={references} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); notify("تم حفظ نسبة الضريبة."); await onChanged(); }} />}</article>;
}

function TaxRateForm({ taxRate, references, onClose, onSaved }: { taxRate: TaxRate | null; references: References; onClose: () => void; onSaved: () => void }) {
  const [rate, setRate] = useState(taxRate?.rate ?? "15.0000"); const [accountId, setAccountId] = useState(taxRate?.outputTaxAccountId ?? ""); const [active, setActive] = useState(taxRate?.isActive ?? true); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const liabilityType = references.accountTypes.find((type) => type.code === "LIABILITY"); const liabilityAccounts = references.accounts.filter((account) => account.accountTypeId === liabilityType?.id);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(""); const data = new FormData(event.currentTarget); try { await api(taxRate ? `/tax-rates/${taxRate.id}` : "/tax-rates", { method: taxRate ? "PATCH" : "POST", body: JSON.stringify({ code: String(data.get("code") ?? "").trim(), nameAr: String(data.get("nameAr") ?? "").trim(), rate: toMoney(rate), outputTaxAccountId: Number(rate) > 0 ? accountId || null : null, ...(taxRate ? { isActive: active } : {}) }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ نسبة الضريبة."); } finally { setSaving(false); } }
  return <Modal title={taxRate ? "تعديل نسبة الضريبة" : "نسبة ضريبة جديدة"} description="تُثبت النسبة على بند الفاتورة وقت الحفظ والترحيل." onClose={onClose}><form className="form-grid" onSubmit={submit}>{error && <div className="form-error full">{error}</div>}<label><span>الرمز *</span><input name="code" defaultValue={taxRate?.code} required /></label><label><span>الاسم العربي *</span><input name="nameAr" defaultValue={taxRate?.nameAr} required /></label><label><span>النسبة % *</span><input dir="ltr" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} required /></label><label><span>حساب ضريبة المخرجات {Number(rate) > 0 && "*"}</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)} required={Number(rate) > 0}><option value="">اختر الحساب</option>{liabilityAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.nameAr}</option>)}</select></label>{taxRate && <label className="check-field full"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span>النسبة نشطة</span></label>}<div className="form-actions full"><Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button></div></form></Modal>;
}

const settlementLabel = (status: SalesInvoice["settlementStatus"]) => ({ OPEN: "غير محصلة", PARTIAL: "تحصيل جزئي", PAID: "مسددة" })[status];
