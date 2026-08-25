import {
  localizedReferenceName,
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
import { exchangeRateForCurrency,
  formatMoney,
  statusLabel,
  taxReadinessLabel,
  toMoney,
  toQuantity,
  toRate } from "./domain";
import type { Account,
  AccountType,
  CostCenter,
  Currency,
  FiscalPeriod,
  InventoryItem,
  ListResponse,
  PayablesAgingReport,
  PurchaseInvoice,
  PurchaseInvoiceLine,
  Supplier,
  TaxRate,
  Warehouse } from "./types";
import { Button,
  EmptyState,
  Modal,
  Pagination,
  Spinner,
  PageHeader,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Section = "invoices" | "aging" | "taxes";
type InvoiceType = "PURCHASE_INVOICE" | "PURCHASE_DEBIT_NOTE";
type References = { suppliers: Supplier[]; accounts: Account[]; accountTypes: AccountType[]; periods: FiscalPeriod[]; costCenters: CostCenter[]; currencies: Currency[]; taxRates: TaxRate[]; sourceInvoices: PurchaseInvoice[]; warehouses: Warehouse[]; inventoryItems: InventoryItem[] };
const emptyReferences: References = { suppliers: [], accounts: [], accountTypes: [], periods: [], costCenters: [], currencies: [], taxRates: [], sourceInvoices: [], warehouses: [], inventoryItems: [] };

export function PurchaseInvoicesPage({ notify }: { notify: Notice }) {
  const [section, setSection] = useState<Section>("invoices");
  const [items, setItems] = useState<PurchaseInvoice[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PurchaseInvoice | null>(null);
  const [form, setForm] = useState<{ type: InvoiceType; invoice: PurchaseInvoice | null } | null>(null);
  const [references, setReferences] = useState<References>(emptyReferences);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "10", ...(status ? { status } : {}), ...(documentType ? { documentType } : {}), ...(submittedSearch ? { search: submittedSearch } : {}) });
      const result = await api<ListResponse<PurchaseInvoice>>(`/purchase-invoices?${query}`);
      setItems(result.data); setMeta(result.meta);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.purchase-invoices.001")); }
    finally { setLoading(false); }
  }, [documentType, page, status, submittedSearch]);

  const loadReferences = useCallback(async () => {
    try {
      const [suppliers, accounts, accountTypes, periods, centers, currencies, taxRates, sources] = await Promise.all([
        api<ListResponse<Supplier>>("/suppliers?page=1&pageSize=100&active=true"),
        api<ListResponse<Account>>("/accounts?page=1&pageSize=100&active=true"),
        api<{ data: AccountType[] }>("/account-types"),
        api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100"),
        api<ListResponse<CostCenter>>("/cost-centers?page=1&pageSize=100&active=true"),
        api<{ data: Currency[] }>("/currencies"),
        api<{ data: TaxRate[] }>("/purchase-tax-rates?activeOnly=false"),
        api<ListResponse<PurchaseInvoice>>("/purchase-invoices?page=1&pageSize=100&documentType=PURCHASE_INVOICE&status=POSTED"),
      ]);
      const [warehouses, inventoryItems] = await Promise.all([
        api<ListResponse<Warehouse>>("/warehouses?page=1&pageSize=100&active=true").catch(() => null),
        api<ListResponse<InventoryItem>>("/inventory-items?page=1&pageSize=100&active=true").catch(() => null),
      ]);
      setReferences({ suppliers: suppliers.data.filter((item) => item.isActive), accounts: accounts.data.filter((item) => item.isActive && item.allowsPosting), accountTypes: accountTypes.data, periods: periods.data.filter((item) => item.status !== "CLOSED"), costCenters: centers.data.filter((item) => item.isActive), currencies: currencies.data, taxRates: taxRates.data, sourceInvoices: sources.data, warehouses: warehouses?.data.filter((item) => item.isActive) ?? [], inventoryItems: inventoryItems?.data.filter((item) => item.isActive && item.unitOfMeasure.isActive) ?? [] });
    } catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.purchase-invoices.002"), "error"); }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadReferences(); }, [loadReferences]);

  async function openDetails(id: string) {
    try { setSelected(await api<PurchaseInvoice>(`/purchase-invoices/${id}`)); }
    catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.purchase-invoices.003"), "error"); }
  }

  async function command(operation: "post" | "cancel" | "reverse", invoice: PurchaseInvoice) {
    const action = { post: t("pages.manual-journals.004"), cancel: t("pages.accounts.065"), reverse: t("pages.manual-journals.006") }[operation];
    if (!window.confirm(t("pages.purchase-invoices.007", { value1: action, value2: invoice.document.documentNumber }))) return;
    const reason = operation === "post" ? "" : window.prompt(t("pages.purchase-invoices.008", { value1: action }));
    if (operation !== "post" && (!reason || reason.trim().length < 3)) return;
    const reversalDate = operation === "reverse" ? window.prompt(t("pages.purchase-invoices.009"), new Date().toISOString().slice(0, 10)) : "";
    if (operation === "reverse" && !reversalDate) return;
    try {
      await api(`/purchase-invoices/${invoice.id}/${operation}`, { method: "POST", idempotencyKey: operation === "cancel" ? undefined : idempotencyKey(operation, invoice.id), body: JSON.stringify({ version: invoice.document.version, ...(reason ? { reason: reason.trim() } : {}), ...(reversalDate ? { reversalDate } : {}) }) });
      notify(t("pages.purchase-invoices.010", { value1: action })); setSelected(null); await Promise.all([load(), loadReferences()]);
    } catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.fiscal.008"), "error"); await openDetails(invoice.id); }
  }

  return <section className="workspace-page sales-workspace">
    <PageHeader kicker={t("pages.purchase-invoices.012")} title={t("pages.purchase-invoices.013")} description={t("pages.purchase-invoices.014")} actions={section === "invoices" && <div className="page-actions"><Button variant="secondary" icon="reverse" onClick={() => setForm({ type: "PURCHASE_DEBIT_NOTE", invoice: null })}>{t("pages.purchase-invoices.015")}</Button><Button icon="plus" onClick={() => setForm({ type: "PURCHASE_INVOICE", invoice: null })}>{t("pages.purchase-invoices.016")}</Button></div>} />
    <div className="section-tabs sales-tabs" role="tablist">
      <button className={section === "invoices" ? "active" : ""} onClick={() => setSection("invoices")}>{t("pages.purchase-invoices.017")}</button>
      <button className={section === "aging" ? "active" : ""} onClick={() => setSection("aging")}>{t("pages.purchase-invoices.018")}</button>
      <button className={section === "taxes" ? "active" : ""} onClick={() => setSection("taxes")}>{t("pages.purchase-invoices.019")}</button>
    </div>
    {section === "invoices" && <>
      <div className="toolbar sales-filters"><form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedSearch(search.trim()); }}><input aria-label={t("pages.purchase-invoices.020")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("pages.purchase-invoices.021")} /><button type="submit">{t("pages.accounts.026")}</button></form><select aria-label={t("pages.purchase-invoices.023")} value={documentType} onChange={(event) => { setPage(1); setDocumentType(event.target.value); }}><option value="">{t("pages.purchase-invoices.024")}</option><option value="PURCHASE_INVOICE">{t("pages.purchase-invoices.025")}</option><option value="PURCHASE_DEBIT_NOTE">{t("pages.purchase-invoices.015")}</option></select><select aria-label={t("pages.purchase-invoices.026")} value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">{t("pages.accounts.027")}</option><option value="DRAFT">{t("pages.dashboard.044")}</option><option value="POSTED">{t("pages.dashboard.045")}</option><option value="CANCELLED">{t("pages.dashboard.046")}</option><option value="REVERSED">{t("pages.dashboard.047")}</option></select></div>
      {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{t("pages.accounts.030")}</Button></div> : loading ? <Spinner label={t("pages.purchase-invoices.033")} /> : !items.length ? <EmptyState title={t("pages.purchase-invoices.034")} description={t("pages.purchase-invoices.035")} action={<Button icon="plus" onClick={() => setForm({ type: "PURCHASE_INVOICE", invoice: null })}>{t("pages.purchase-invoices.036")}</Button>} /> : <><div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table sales-invoices-table"><thead><tr><th>{t("pages.purchase-invoices.037")}</th><th>{t("pages.accounts.040")}</th><th>{t("pages.purchase-invoices.039")}</th><th>{t("pages.purchase-invoices.040")}</th><th>{t("pages.purchase-invoices.041")}</th><th>{t("pages.purchase-invoices.042")}</th><th>{t("pages.accounts.043")}</th><th></th></tr></thead><tbody>{items.map((invoice) => <tr key={invoice.id}><td><button className="text-link strong" dir="ltr" onClick={() => void openDetails(invoice.id)}>{invoice.document.documentNumber}</button></td><td>{invoice.document.documentType === "PURCHASE_INVOICE" ? t("pages.purchase-invoices.044") : t("pages.purchase-invoices.015")}</td><td>{invoice.supplierNameSnapshot}</td><td>{invoice.document.documentDate}<small>{t("pages.purchase-invoices.045")}{invoice.dueDate}</small></td><td className="money-cell">{formatMoney(invoice.total)}</td><td className="money-cell">{invoice.document.documentType === "PURCHASE_INVOICE" ? formatMoney(invoice.outstandingAmount) : "—"}</td><td><span className={`status-chip ${invoice.document.status.toLowerCase()}`}>{statusLabel(invoice.document.status)}</span>{invoice.document.status === "POSTED" && invoice.document.documentType === "PURCHASE_INVOICE" && <small>{settlementLabel(invoice.settlementStatus)}</small>}</td><td><Button variant="ghost" onClick={() => void openDetails(invoice.id)}>{t("pages.payments.040")}</Button></td></tr>)}</tbody></table></div><Pagination {...meta} page={page} onChange={setPage} /></>}
    </>}
    {section === "aging" && <AgingReport suppliers={references.suppliers} />}
    {section === "taxes" && <TaxRatesPanel references={references} notify={notify} onChanged={loadReferences} />}
    {form && <InvoiceForm type={form.type} invoice={form.invoice} references={references} onClose={() => setForm(null)} onSaved={async (invoice) => { setForm(null); setSelected(invoice); notify(form.invoice ? t("pages.purchase-invoices.047") : form.type === "PURCHASE_INVOICE" ? t("pages.purchase-invoices.048") : t("pages.purchase-invoices.049")); await Promise.all([load(), loadReferences()]); }} />}
    {selected && !form && <InvoiceDetails invoice={selected} onClose={() => setSelected(null)} onEdit={() => setForm({ type: selected.document.documentType as InvoiceType, invoice: selected })} onCommand={(operation) => void command(operation, selected)} onPrint={() => void downloadPdf(`/purchase-invoices/${selected.id}/pdf`).catch((cause) => notify(cause instanceof Error ? cause.message : t("pages.purchase-invoices.050"), "error"))} />}
  </section>;
}

type DraftLine = { inventoryItemId: string; inventoryItemLabel: string; description: string; quantity: string; unitPrice: string; discountAmount: string; debitAccountId: string; costCenterId: string; taxRateId: string };
const blankLine = (): DraftLine => ({ inventoryItemId: "", inventoryItemLabel: "", description: "", quantity: "1", unitPrice: "", discountAmount: "0.0000", debitAccountId: "", costCenterId: "", taxRateId: "" });

function InvoiceForm({ type, invoice, references, onClose, onSaved }: { type: InvoiceType; invoice: PurchaseInvoice | null; references: References; onClose: () => void; onSaved: (value: PurchaseInvoice) => void }) {
  const [supplierId, setSupplierId] = useState(invoice?.supplierId ?? "");
  const [warehouseId, setWarehouseId] = useState(invoice?.warehouseId ?? "");
  const [currencyId, setCurrencyId] = useState(invoice?.currencyId ?? references.currencies[0]?.id ?? "");
  const [exchangeRate, setExchangeRate] = useState(invoice?.exchangeRate ?? exchangeRateForCurrency(references.currencies[0]));
  const [documentDate, setDocumentDate] = useState(invoice?.document.documentDate ?? new Date().toISOString().slice(0, 10));
  const [sourceInvoiceId, setSourceInvoiceId] = useState(invoice?.sourceInvoiceId ?? "");
  const [lines, setLines] = useState<DraftLine[]>(invoice?.lines.map(lineDraft) ?? [blankLine()]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const debitTypeIds = references.accountTypes.filter((item) => ["ASSET", "EXPENSE"].includes(item.code)).map((item) => item.id);
  const debitAccounts = references.accounts.filter((account) => debitTypeIds.includes(account.accountTypeId));
  const sources = references.sourceInvoices.filter((item) => item.supplierId === supplierId && Number(item.outstandingAmount) > 0);
  const totals = useMemo(() => lines.reduce((value, line) => { const gross = Number(line.quantity || 0) * Number(line.unitPrice || 0); const discount = Number(line.discountAmount || 0); const net = Math.max(0, gross - discount); const tax = net * Number(references.taxRates.find((item) => item.id === line.taxRateId)?.rate ?? 0) / 100; return { subtotal: value.subtotal + gross, discount: value.discount + discount, tax: value.tax + tax, total: value.total + net + tax }; }, { subtotal: 0, discount: 0, tax: 0, total: 0 }), [lines, references.taxRates]);

  useEffect(() => { if (!currencyId && references.currencies[0]) { setCurrencyId(references.currencies[0].id); setExchangeRate(exchangeRateForCurrency(references.currencies[0])); } }, [currencyId, references.currencies]);
  async function selectCurrency(id: string, date = documentDate) { const selected = references.currencies.find((currency) => currency.id === id); setCurrencyId(id); try { setExchangeRate(await exchangeRateForDocumentDate(selected, date)); setErrors((current) => current.filter((message) => message !== missingDatedRateMessage())); } catch { setExchangeRate(""); setErrors([missingDatedRateMessage()]); } }
  function changeDocumentDate(value: string) { setDocumentDate(value); if (currencyId) void selectCurrency(currencyId, value); }
  function setLine(index: number, patch: Partial<DraftLine>) { setLines((current) => current.map((line, position) => position === index ? { ...line, ...patch } : line)); }
  function selectInventoryItem(index: number, inventoryItemId: string) {
    const item = references.inventoryItems.find((candidate) => candidate.id === inventoryItemId);
    setLine(index, {
      inventoryItemId,
      inventoryItemLabel: item ? `${item.code} — ${localizedReferenceName(item)} (${item.unitOfMeasure.code})` : "",
      ...(item ? { description: item.description || localizedReferenceName(item) } : {}),
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget); const value = (name: string) => String(data.get(name) ?? "").trim();
    const validation: string[] = [];
    if (!supplierId) validation.push(t("pages.purchase-invoices.051"));
    if (type === "PURCHASE_DEBIT_NOTE" && !sourceInvoiceId) validation.push(t("pages.purchase-invoices.052"));
    if (lines.some((line) => line.inventoryItemId) && !warehouseId) validation.push(t("invoiceInventory.warehouseRequired"));
    if (!lines.length || lines.some((line) => !line.description.trim() || !line.debitAccountId || Number(line.quantity) <= 0 || Number(line.unitPrice) < 0 || Number(line.discountAmount) < 0 || Number(line.discountAmount) > Number(line.quantity) * Number(line.unitPrice))) validation.push(t("pages.purchase-invoices.053"));
    if (totals.total <= 0) validation.push(t("pages.purchase-invoices.054"));
    if (validation.length) { setErrors(validation); return; }
    setSaving(true); setErrors([]);
    try {
      const result = await api<PurchaseInvoice>(invoice ? `/purchase-invoices/${invoice.id}` : "/purchase-invoices", { method: invoice ? "PATCH" : "POST", body: JSON.stringify({ documentType: type, fiscalPeriodId: value("fiscalPeriodId"), documentDate: value("documentDate"), dueDate: value("dueDate"), description: value("description"), supplierId, warehouseId: warehouseId || null, supplierInvoiceNumber: value("supplierInvoiceNumber") || null, sourceInvoiceId: type === "PURCHASE_DEBIT_NOTE" ? sourceInvoiceId : null, currencyId, exchangeRate: toRate(exchangeRate), supplierAddress: value("supplierAddress") || null, notes: value("notes") || null, lines: lines.map((line) => ({ inventoryItemId: line.inventoryItemId || null, description: line.description.trim(), quantity: toQuantity(line.quantity), unitPrice: toMoney(line.unitPrice), discountAmount: toMoney(line.discountAmount), debitAccountId: line.debitAccountId, costCenterId: line.costCenterId || null, taxRateId: line.taxRateId || null })), ...(invoice ? { version: invoice.document.version } : {}) }) });
      onSaved(result);
    } catch (cause) { setErrors([cause instanceof ApiError ? cause.message : t("pages.purchase-invoices.055")]); }
    finally { setSaving(false); }
  }

  return <Modal title={invoice ? t("pages.payments.046", { value1: invoice.document.documentNumber }) : type === "PURCHASE_INVOICE" ? t("pages.purchase-invoices.057") : t("pages.purchase-invoices.058")} description={t("pages.purchase-invoices.059")} onClose={onClose} wide><form className="form-grid sales-invoice-form" onSubmit={submit}>{errors.length > 0 && <div className="form-error full" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    <label><span>{t("pages.payments.049")}</span><select name="fiscalPeriodId" defaultValue={invoice?.document.fiscalPeriodId} required><option value="">{t("pages.manual-journals.047")}</option>{references.periods.map((period) => <option key={period.id} value={period.id}>{period.name} — {period.startDate}{t("pages.payments.051")}{period.endDate}</option>)}</select></label>
    <label><span>{t("pages.purchase-invoices.063")}</span><input name="documentDate" type="date" value={documentDate} onChange={(event) => changeDocumentDate(event.target.value)} required /></label>
    <label><span>{t("pages.purchase-invoices.064")}</span><input name="dueDate" type="date" defaultValue={invoice?.dueDate ?? new Date().toISOString().slice(0, 10)} required /></label>
    <label><span>{t("pages.payments.057")}</span><select value={supplierId} onChange={(event) => { setSupplierId(event.target.value); setSourceInvoiceId(""); }} required><option value="">{t("pages.payments.058")}</option>{references.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {localizedReferenceName(supplier)}</option>)}</select></label>
    <label><span>{t("pages.purchase-invoices.067")}</span><input name="supplierInvoiceNumber" defaultValue={invoice?.supplierInvoiceNumber ?? ""} maxLength={100} dir="ltr" /></label>
    {type === "PURCHASE_DEBIT_NOTE" && <label className="full"><span>{t("pages.purchase-invoices.068")}</span><select value={sourceInvoiceId} onChange={(event) => setSourceInvoiceId(event.target.value)} required><option value="">{t("pages.purchase-invoices.069")}</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.document.documentNumber}{t("pages.purchase-invoices.070")}{formatMoney(source.total)}{t("pages.payments.082")}{formatMoney(source.outstandingAmount)}</option>)}</select></label>}
    <label className="full"><span>{t("pages.payments.053")}</span><input name="description" defaultValue={invoice?.document.description} maxLength={500} required /></label>
    <label><span>{t("pages.payments.066")}</span><select value={currencyId} onChange={(event) => void selectCurrency(event.target.value)} required>{references.currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} — {localizedReferenceName(currency)}</option>)}</select></label>
    <label><span>{t("pages.payments.068")}</span><input dir="ltr" inputMode="decimal" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} required /></label>
    <label className="full"><span>{t("invoiceInventory.warehouse")}</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">{t("invoiceInventory.noWarehouse")}</option>{warehouseId && !references.warehouses.some((warehouse) => warehouse.id === warehouseId) && <option value={warehouseId}>{invoice?.warehouseCodeSnapshot} — {invoice?.warehouseNameSnapshot}</option>}{references.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {localizedReferenceName(warehouse)}</option>)}</select><small>{t("invoiceInventory.warehouseHint")}</small></label>
    <label className="full"><span>{t("pages.purchase-invoices.075")}</span><input name="supplierAddress" defaultValue={invoice?.supplierAddressSnapshot ?? ""} maxLength={500} placeholder={t("pages.purchase-invoices.076")} /></label>
    <fieldset className="full invoice-lines-field"><legend>{t("pages.purchase-invoices.077")}</legend><div className="invoice-line-list">{lines.map((line, index) => <div className="invoice-line-editor" key={index}><span className="line-index">{index + 1}</span><label className="line-item"><span>{t("invoiceInventory.item")}</span><select value={line.inventoryItemId} onChange={(event) => selectInventoryItem(index, event.target.value)}><option value="">{t("invoiceInventory.manualLine")}</option>{line.inventoryItemId && !references.inventoryItems.some((item) => item.id === line.inventoryItemId) && <option value={line.inventoryItemId}>{line.inventoryItemLabel}</option>}{references.inventoryItems.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)} ({item.unitOfMeasure.code})</option>)}</select></label><label className="line-description"><span>{t("pages.purchase-invoices.078")}</span><input value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} required /></label><label className="line-quantity"><span>{t("pages.purchase-invoices.079")}</span><input dir="ltr" inputMode="decimal" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} required /></label><label className="line-unit-price"><span>{t("pages.purchase-invoices.080")}</span><input dir="ltr" inputMode="decimal" value={line.unitPrice} onChange={(event) => setLine(index, { unitPrice: event.target.value })} required /></label><label className="line-discount"><span>{t("pages.purchase-invoices.081")}</span><input dir="ltr" inputMode="decimal" value={line.discountAmount} onChange={(event) => setLine(index, { discountAmount: event.target.value })} required /></label><label className="line-account"><span>{t("pages.purchase-invoices.082")}</span><select value={line.debitAccountId} onChange={(event) => setLine(index, { debitAccountId: event.target.value })} required><option value="">{t("pages.purchase-invoices.083")}</option>{debitAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {localizedReferenceName(account)}</option>)}</select></label><label className="line-tax"><span>{t("pages.purchase-invoices.084")}</span><select value={line.taxRateId} onChange={(event) => setLine(index, { taxRateId: event.target.value })}><option value="">{t("pages.purchase-invoices.085")}</option>{references.taxRates.map((tax) => <option key={tax.id} value={tax.id} disabled={!tax.isReady}>{localizedReferenceName(tax)} ({Number(tax.rate)}%){tax.isReady ? "" : ` — ${taxReadinessLabel(tax)}`}</option>)}</select></label><label className="line-cost-center"><span>{t("pages.manual-journals.057")}</span><select value={line.costCenterId} onChange={(event) => setLine(index, { costCenterId: event.target.value })}><option value="">{t("pages.purchase-invoices.087")}</option>{references.costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} — {localizedReferenceName(center)}</option>)}</select></label><Button type="button" className="line-delete" variant="ghost" icon="trash" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>{t("pages.accounts.050")}</Button></div>)}</div><Button type="button" variant="secondary" icon="plus" onClick={() => setLines((current) => [...current, blankLine()])}>{t("pages.purchase-invoices.089")}</Button></fieldset>
    <div className="invoice-live-summary full"><span>{t("pages.purchase-invoices.090")}<strong>{formatMoney(totals.subtotal)}</strong></span><span>{t("pages.purchase-invoices.091")}<strong>{formatMoney(totals.discount)}</strong></span><span>{t("pages.purchase-invoices.092")}<strong>{formatMoney(totals.tax)}</strong></span><span className="grand-total">{t("pages.purchase-invoices.093")}<strong>{formatMoney(totals.total)}</strong></span></div>
    <label className="full"><span>{t("pages.payments.074")}</span><textarea name="notes" defaultValue={invoice?.notes ?? ""} maxLength={1000} rows={3} /></label>
    <div className="form-actions full"><Button type="button" variant="secondary" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit" disabled={saving}>{saving ? t("pages.purchase-invoices.095") : t("pages.manual-journals.077")}</Button></div>
  </form></Modal>;
}

function lineDraft(line: PurchaseInvoiceLine): DraftLine { return { inventoryItemId: line.inventoryItemId ?? "", inventoryItemLabel: line.inventoryItemId ? `${line.inventoryItemCodeSnapshot} — ${line.inventoryItemNameSnapshot} (${line.unitOfMeasureCodeSnapshot})` : "", description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount, debitAccountId: line.debitAccountId, costCenterId: line.costCenterId ?? "", taxRateId: line.taxRateId ?? "" }; }

function InvoiceDetails({ invoice, onClose, onEdit, onCommand, onPrint }: { invoice: PurchaseInvoice; onClose: () => void; onEdit: () => void; onCommand: (operation: "post" | "cancel" | "reverse") => void; onPrint: () => void }) {
  return <Modal title={t("pages.purchase-invoices.097", { value1: invoice.document.documentType === "PURCHASE_INVOICE" ? t("pages.purchase-invoices.044") : t("pages.purchase-invoices.015"), value2: invoice.document.documentNumber })} description={`${invoice.supplierNameSnapshot} — ${statusLabel(invoice.document.status)}`} onClose={onClose} wide><div className="detail-actions">{["POSTED", "REVERSED"].includes(invoice.document.status) && <Button variant="secondary" icon="print" onClick={onPrint}>{t("pages.payments.087")}</Button>}{invoice.document.status === "DRAFT" && <><Button icon="edit" variant="secondary" onClick={onEdit}>{t("pages.accounts.048")}</Button><Button icon="check" onClick={() => onCommand("post")}>{t("pages.manual-journals.004")}</Button><Button icon="ban" variant="danger" onClick={() => onCommand("cancel")}>{t("pages.accounts.065")}</Button></>}{invoice.document.status === "POSTED" && <Button icon="reverse" variant="danger" onClick={() => onCommand("reverse")}>{t("pages.manual-journals.006")}</Button>}</div><div className="document-summary invoice-summary"><div><span>{t("pages.manual-journals.050")}</span><strong>{invoice.document.documentDate}</strong></div><div><span>{t("pages.purchase-invoices.101")}</span><strong>{invoice.dueDate}</strong></div><div><span>{t("pages.manual-journals.066")}</span><strong>{invoice.currency?.code}</strong></div>{invoice.warehouseNameSnapshot && <div><span>{t("invoiceInventory.warehouse")}</span><strong>{invoice.warehouseCodeSnapshot} — {invoice.warehouseNameSnapshot}</strong></div>}<div><span>{t("pages.purchase-invoices.103")}</span><strong>{formatMoney(invoice.subtotal)}</strong></div><div><span>{t("pages.purchase-invoices.081")}</span><strong>{formatMoney(invoice.discountTotal)}</strong></div><div><span>{t("pages.purchase-invoices.084")}</span><strong>{formatMoney(invoice.taxTotal)}</strong></div><div><span>{t("pages.purchase-invoices.041")}</span><strong>{formatMoney(invoice.total)}</strong></div>{invoice.document.documentType === "PURCHASE_INVOICE" && <><div><span>{t("pages.purchase-invoices.104")}</span><strong>{formatMoney(invoice.paidAmount)}</strong></div><div><span>{t("pages.purchase-invoices.105")}</span><strong>{formatMoney(invoice.debitedAmount)}</strong></div><div><span>{t("pages.purchase-invoices.042")}</span><strong>{formatMoney(invoice.outstandingAmount)}</strong></div></>}</div>{invoice.supplierInvoiceNumber && <div className="inline-notice neutral">{t("pages.purchase-invoices.106")}<strong dir="ltr">{invoice.supplierInvoiceNumber}</strong></div>}{invoice.sourceInvoiceNumber && <div className="inline-notice neutral">{t("pages.purchase-invoices.107")}<strong dir="ltr">{invoice.sourceInvoiceNumber}</strong></div>}<div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>#</th><th>{t("invoiceInventory.item")}</th><th>{t("pages.purchase-invoices.078")}</th><th>{t("pages.accounts.039")}</th><th>{t("pages.purchase-invoices.079")}</th><th>{t("pages.purchase-invoices.080")}</th><th>{t("pages.purchase-invoices.081")}</th><th>{t("pages.purchase-invoices.084")}</th><th>{t("pages.purchase-invoices.041")}</th></tr></thead><tbody>{invoice.lines.map((line) => <tr key={line.id}><td>{line.lineNumber}</td><td>{line.inventoryItemNameSnapshot ? <>{line.inventoryItemCodeSnapshot} — {line.inventoryItemNameSnapshot}<small>{line.unitOfMeasureCodeSnapshot}</small></> : t("invoiceInventory.manualLine")}</td><td>{line.description}</td><td>{line.debitAccount?.code} — {line.debitAccount?.nameAr}</td><td>{formatMoney(line.quantity)}</td><td>{formatMoney(line.unitPrice)}</td><td>{formatMoney(line.discountAmount)}</td><td>{formatMoney(line.taxAmount)}<small>{Number(line.taxRateSnapshot)}%</small></td><td className="money-cell">{formatMoney(line.totalAmount)}</td></tr>)}</tbody></table></div>{invoice.notes && <div className="notes-panel"><strong>{t("pages.payments.074")}</strong><p>{invoice.notes}</p></div>}</Modal>;
}

function AgingReport({ suppliers }: { suppliers: Supplier[] }) {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10)); const [supplierId, setSupplierId] = useState(""); const [report, setReport] = useState<PayablesAgingReport | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setReport(await api<PayablesAgingReport>(`/reports/payables-aging?asOf=${asOf}${supplierId ? `&supplierId=${supplierId}` : ""}`)); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.purchase-invoices.109")); } finally { setLoading(false); } }, [asOf, supplierId]);
  useEffect(() => { void load(); }, [load]);
  return <article className="panel aging-panel"><header><div><h2>{t("pages.purchase-invoices.110")}</h2><p>{t("pages.purchase-invoices.111")}</p></div></header><div className="report-toolbar aging-toolbar"><label><span>{t("pages.purchase-invoices.112")}</span><input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label><label><span>{t("pages.purchase-invoices.039")}</span><select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">{t("pages.purchase-invoices.113")}</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {localizedReferenceName(supplier)}</option>)}</select></label><Button onClick={() => void load()}>{t("pages.purchase-invoices.114")}</Button></div>{error ? <div className="inline-notice">{error}</div> : loading ? <Spinner label={t("pages.purchase-invoices.115")} /> : !report?.data.length ? <EmptyState title={t("pages.purchase-invoices.116")} description={t("pages.purchase-invoices.117")} /> : <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table aging-table"><thead><tr><th>{t("pages.purchase-invoices.039")}</th><th>{t("pages.purchase-invoices.118")}</th><th>{t("pages.purchase-invoices.119")}</th><th>{t("pages.purchase-invoices.120")}</th><th>{t("pages.purchase-invoices.121")}</th><th>{t("pages.purchase-invoices.122")}</th><th>{t("pages.purchase-invoices.041")}</th></tr></thead><tbody>{report.data.map((row) => <tr key={row.supplierId}><td><strong>{row.supplierName}</strong><small>{row.supplierCode} — {row.invoices.length}{t("pages.purchase-invoices.123")}</small></td><td>{formatMoney(row.current)}</td><td>{formatMoney(row.days1To30)}</td><td>{formatMoney(row.days31To60)}</td><td>{formatMoney(row.days61To90)}</td><td>{formatMoney(row.daysOver90)}</td><td className="money-cell">{formatMoney(row.total)}</td></tr>)}</tbody><tfoot><tr><th>{t("pages.purchase-invoices.041")}</th><th>{formatMoney(report.totals.current)}</th><th>{formatMoney(report.totals.days1To30)}</th><th>{formatMoney(report.totals.days31To60)}</th><th>{formatMoney(report.totals.days61To90)}</th><th>{formatMoney(report.totals.daysOver90)}</th><th>{formatMoney(report.totals.total)}</th></tr></tfoot></table></div>}</article>;
}

function TaxRatesPanel({ references, notify, onChanged }: { references: References; notify: Notice; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<TaxRate | null | undefined>(undefined);
  return <article className="panel tax-rates-panel"><header><div><h2>{t("pages.purchase-invoices.124")}</h2><p>{t("pages.purchase-invoices.125")}</p></div><Button icon="plus" onClick={() => setEditing(null)}>{t("pages.purchase-invoices.126")}</Button></header>{!references.taxRates.length ? <EmptyState title={t("pages.purchase-invoices.127")} description={t("pages.purchase-invoices.128")} /> : <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.accounts.059")}</th><th>{t("pages.fiscal.054")}</th><th>{t("pages.purchase-invoices.131")}</th><th>{t("pages.purchase-invoices.132")}</th><th>{t("pages.accounts.043")}</th><th></th></tr></thead><tbody>{references.taxRates.map((tax) => <tr key={tax.id}><td><span className="code-pill">{tax.code}</span></td><td>{localizedReferenceName(tax)}</td><td>{Number(tax.rate)}%</td><td>{tax.inputTaxAccount ? `${tax.inputTaxAccount.code} — ${tax.inputTaxAccount.nameAr}` : t("pages.purchase-invoices.133")}</td><td><span className={`status-chip ${tax.isActive ? "active" : "inactive"}`}>{tax.isActive ? t("pages.admin.065") : t("pages.purchase-invoices.135")}</span></td><td><Button variant="ghost" icon="edit" onClick={() => setEditing(tax)}>{t("pages.accounts.048")}</Button></td></tr>)}</tbody></table></div>}{editing !== undefined && <TaxRateForm taxRate={editing} references={references} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); notify(t("pages.purchase-invoices.136")); await onChanged(); }} />}</article>;
}

function TaxRateForm({ taxRate, references, onClose, onSaved }: { taxRate: TaxRate | null; references: References; onClose: () => void; onSaved: () => void }) {
  const [rate, setRate] = useState(taxRate?.rate ?? "15.0000"); const [accountId, setAccountId] = useState(taxRate?.inputTaxAccountId ?? ""); const [active, setActive] = useState(taxRate?.isActive ?? true); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const assetType = references.accountTypes.find((type) => type.code === "ASSET"); const assetAccounts = references.accounts.filter((account) => account.accountTypeId === assetType?.id);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(""); const data = new FormData(event.currentTarget); try { await api(taxRate ? `/purchase-tax-rates/${taxRate.id}` : "/purchase-tax-rates", { method: taxRate ? "PATCH" : "POST", body: JSON.stringify({ nameAr: String(data.get("nameAr") ?? "").trim(), rate: toMoney(rate), inputTaxAccountId: Number(rate) > 0 ? accountId || null : null, ...(taxRate ? { version: taxRate.version, isActive: active } : {}) }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.purchase-invoices.137")); } finally { setSaving(false); } }
  return <Modal title={taxRate ? t("pages.purchase-invoices.138") : t("pages.purchase-invoices.139")} description={t("pages.purchase-invoices.140")} onClose={onClose}><form className="form-grid" onSubmit={submit}>{error && <div className="form-error full" role="alert">{error}</div>}{taxRate ? <label><span>{t("pages.purchase-invoices.141")}</span><input dir="ltr" value={taxRate.code} readOnly /></label> : <div className="inline-notice neutral full">{t("common.autoGeneratedCode")}</div>}<label><span>{t("pages.customers.046")}</span><input name="nameAr" defaultValue={taxRate?.nameAr} required /></label><label><span>{t("pages.purchase-invoices.143")}</span><input dir="ltr" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} required /></label><label><span>{t("pages.purchase-invoices.144")}{Number(rate) > 0 && "*"}</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)} required={Number(rate) > 0}><option value="">{t("pages.customers.044")}</option>{assetAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {localizedReferenceName(account)}</option>)}</select></label>{taxRate && <label className="check-field full"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span>{t("pages.purchase-invoices.146")}</span></label>}<div className="form-actions full"><Button type="button" variant="secondary" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit" disabled={saving}>{saving ? t("pages.purchase-invoices.095") : t("pages.accounts.067")}</Button></div></form></Modal>;
}

const settlementLabel = (status: PurchaseInvoice["settlementStatus"]) => ({ OPEN: t("pages.purchase-invoices.148"), PARTIAL: t("pages.purchase-invoices.149"), PAID: t("pages.purchase-invoices.150") })[status];
