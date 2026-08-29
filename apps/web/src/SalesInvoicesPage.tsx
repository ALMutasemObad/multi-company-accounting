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
import { actionPermissionPolicies } from "./action-permissions";
import { allows,
  firstRequestFailure,
  requestIfAllowed,
  requestValue } from "./authorization";
import { Can, useAuthorization } from "./authorization-context";
import { endpointPermissionPolicies } from "./endpoint-permissions";
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
  CostCenter,
  Currency,
  Customer,
  FiscalPeriod,
  InventoryItem,
  ListResponse,
  ReceivablesAgingReport,
  SalesInvoice,
  SalesInvoiceLine,
  TaxRate,
  Warehouse } from "./types";
import { ReferenceCombobox } from "./ReferenceCombobox";
import { Button,
  EmptyState,
  Modal,
  Pagination,
  Spinner,
  PageHeader,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Section = "invoices" | "aging" | "taxes";
type InvoiceType = "SALES_INVOICE" | "SALES_CREDIT_NOTE";
type References = { periods: FiscalPeriod[]; currencies: Currency[] };
const emptyReferences: References = { periods: [], currencies: [] };

export function SalesInvoicesPage({ notify }: { notify: Notice }) {
  const { permissionSet } = useAuthorization();
  const permissions = actionPermissionPolicies.salesInvoices;
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.sales-invoices.001")); }
    finally { setLoading(false); }
  }, [documentType, page, status, submittedSearch]);

  const loadReferences = useCallback(async () => {
    const [periodResult, currencyResult] = await Promise.all([
      requestIfAllowed(permissionSet, endpointPermissionPolicies.fiscalPeriods, () =>
        api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100")),
      requestIfAllowed(permissionSet, endpointPermissionPolicies.currencies, () =>
        api<{ data: Currency[] }>("/currencies")),
    ]);
    const periods = requestValue(periodResult);
    const currencies = requestValue(currencyResult);
    setReferences({
      periods: periods?.data.filter((item) => item.status !== "CLOSED") ?? [],
      currencies: currencies?.data ?? [],
    });
    const cause = firstRequestFailure([periodResult, currencyResult]);
    if (cause) notify(cause instanceof Error ? cause.message : t("pages.purchase-invoices.002"), "error");
  }, [notify, permissionSet]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadReferences(); }, [loadReferences]);
  useEffect(() => {
    if (section === "aging" && !allows(permissionSet, endpointPermissionPolicies.receivablesAging)) {
      setSection("invoices");
    }
  }, [permissionSet, section]);

  async function openDetails(id: string) {
    try { setSelected(await api<SalesInvoice>(`/sales-invoices/${id}`)); }
    catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.purchase-invoices.003"), "error"); }
  }

  async function command(operation: "post" | "cancel" | "reverse", invoice: SalesInvoice) {
    if (!allows(permissionSet, permissions[operation])) return;
    const action = { post: t("pages.manual-journals.004"), cancel: t("pages.accounts.065"), reverse: t("pages.manual-journals.006") }[operation];
    if (!window.confirm(t("pages.purchase-invoices.007", { value1: action, value2: invoice.document.documentNumber }))) return;
    const reason = operation === "post" ? "" : window.prompt(t("pages.purchase-invoices.008", { value1: action }));
    if (operation !== "post" && (!reason || reason.trim().length < 3)) return;
    const reversalDate = operation === "reverse" ? window.prompt(t("pages.purchase-invoices.009"), new Date().toISOString().slice(0, 10)) : "";
    if (operation === "reverse" && !reversalDate) return;
    try {
      await api(`/sales-invoices/${invoice.id}/${operation}`, { method: "POST", idempotencyKey: operation === "cancel" ? undefined : idempotencyKey(operation, invoice.id), body: JSON.stringify({ version: invoice.document.version, ...(reason ? { reason: reason.trim() } : {}), ...(reversalDate ? { reversalDate } : {}) }) });
      notify(t("pages.purchase-invoices.010", { value1: action })); setSelected(null); await Promise.all([load(), loadReferences()]);
    } catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.fiscal.008"), "error"); await openDetails(invoice.id); }
  }

  return <section className="workspace-page sales-workspace">
    <PageHeader kicker={t("pages.sales-invoices.012")} title={t("pages.sales-invoices.013")} description={t("pages.sales-invoices.014")} actions={section === "invoices" && <Can policy={permissions.create}><div className="page-actions"><Button variant="secondary" icon="reverse" onClick={() => setForm({ type: "SALES_CREDIT_NOTE", invoice: null })}>{t("pages.sales-invoices.015")}</Button><Button icon="plus" onClick={() => setForm({ type: "SALES_INVOICE", invoice: null })}>{t("pages.purchase-invoices.016")}</Button></div></Can>} />
    <div className="section-tabs sales-tabs" role="tablist">
      <button className={section === "invoices" ? "active" : ""} onClick={() => setSection("invoices")}>{t("pages.purchase-invoices.017")}</button>
      <Can policy={endpointPermissionPolicies.receivablesAging}><button className={section === "aging" ? "active" : ""} onClick={() => setSection("aging")}>{t("pages.purchase-invoices.018")}</button></Can>
      <button className={section === "taxes" ? "active" : ""} onClick={() => setSection("taxes")}>{t("pages.purchase-invoices.019")}</button>
    </div>
    {section === "invoices" && <>
      <div className="toolbar sales-filters"><form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedSearch(search.trim()); }}><input aria-label={t("pages.purchase-invoices.020")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("pages.sales-invoices.021")} /><button type="submit">{t("pages.accounts.026")}</button></form><select aria-label={t("pages.purchase-invoices.023")} value={documentType} onChange={(event) => { setPage(1); setDocumentType(event.target.value); }}><option value="">{t("pages.purchase-invoices.024")}</option><option value="SALES_INVOICE">{t("pages.sales-invoices.025")}</option><option value="SALES_CREDIT_NOTE">{t("pages.sales-invoices.015")}</option></select><select aria-label={t("pages.purchase-invoices.026")} value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">{t("pages.accounts.027")}</option><option value="DRAFT">{t("pages.dashboard.044")}</option><option value="POSTED">{t("pages.dashboard.045")}</option><option value="CANCELLED">{t("pages.dashboard.046")}</option><option value="REVERSED">{t("pages.dashboard.047")}</option></select></div>
      {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{t("pages.accounts.030")}</Button></div> : loading ? <Spinner label={t("pages.purchase-invoices.033")} /> : !items.length ? <EmptyState title={t("pages.purchase-invoices.034")} description={t("pages.sales-invoices.035")} action={<Can policy={permissions.create}><Button icon="plus" onClick={() => setForm({ type: "SALES_INVOICE", invoice: null })}>{t("pages.purchase-invoices.036")}</Button></Can>} /> : <><div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table sales-invoices-table"><thead><tr><th>{t("pages.purchase-invoices.037")}</th><th>{t("pages.accounts.040")}</th><th>{t("pages.sales-invoices.039")}</th><th>{t("pages.purchase-invoices.040")}</th><th>{t("pages.purchase-invoices.041")}</th><th>{t("pages.purchase-invoices.042")}</th><th>{t("pages.accounts.043")}</th><th></th></tr></thead><tbody>{items.map((invoice) => <tr key={invoice.id}><td><button className="text-link strong" dir="ltr" onClick={() => void openDetails(invoice.id)}>{invoice.document.documentNumber}</button></td><td>{invoice.document.documentType === "SALES_INVOICE" ? t("pages.purchase-invoices.044") : t("pages.sales-invoices.015")}</td><td>{invoice.customerNameSnapshot}</td><td>{invoice.document.documentDate}<small>{t("pages.purchase-invoices.045")}{invoice.dueDate}</small></td><td className="money-cell">{formatMoney(invoice.total)}</td><td className="money-cell">{invoice.document.documentType === "SALES_INVOICE" ? formatMoney(invoice.outstandingAmount) : "—"}</td><td><span className={`status-chip ${invoice.document.status.toLowerCase()}`}>{statusLabel(invoice.document.status)}</span>{invoice.document.status === "POSTED" && invoice.document.documentType === "SALES_INVOICE" && <small>{settlementLabel(invoice.settlementStatus)}</small>}</td><td><Button variant="ghost" onClick={() => void openDetails(invoice.id)}>{t("pages.payments.040")}</Button></td></tr>)}</tbody></table></div><Pagination {...meta} page={page} onChange={setPage} /></>}
    </>}
    {section === "aging" && allows(permissionSet, endpointPermissionPolicies.receivablesAging) && <AgingReport />}
    {section === "taxes" && <TaxRatesPanel notify={notify} />}
    {form && allows(permissionSet, form.invoice ? permissions.update : permissions.create) && <InvoiceForm type={form.type} invoice={form.invoice} references={references} onClose={() => setForm(null)} onSaved={async (invoice) => { setForm(null); setSelected(invoice); notify(form.invoice ? t("pages.purchase-invoices.047") : form.type === "SALES_INVOICE" ? t("pages.purchase-invoices.048") : t("pages.sales-invoices.049")); await Promise.all([load(), loadReferences()]); }} />}
    {selected && !form && <InvoiceDetails invoice={selected} onClose={() => setSelected(null)} onEdit={() => { if (allows(permissionSet, permissions.update)) setForm({ type: selected.document.documentType as InvoiceType, invoice: selected }); }} onCommand={(operation) => void command(operation, selected)} onPrint={() => { if (allows(permissionSet, permissions.print)) void downloadPdf(`/sales-invoices/${selected.id}/pdf`).catch((cause) => notify(cause instanceof Error ? cause.message : t("pages.purchase-invoices.050"), "error")); }} />}
  </section>;
}

type DraftLine = { inventoryItemId: string; inventoryItemLabel: string; description: string; quantity: string; unitPrice: string; discountAmount: string; revenueAccountId: string; revenueAccountLabel: string; costCenterId: string; costCenterLabel: string; taxRateId: string; taxRateLabel: string; taxRateRate: string };
const blankLine = (): DraftLine => ({ inventoryItemId: "", inventoryItemLabel: "", description: "", quantity: "1", unitPrice: "", discountAmount: "0.0000", revenueAccountId: "", revenueAccountLabel: "", costCenterId: "", costCenterLabel: "", taxRateId: "", taxRateLabel: "", taxRateRate: "0" });

function InvoiceForm({ type, invoice, references, onClose, onSaved }: { type: InvoiceType; invoice: SalesInvoice | null; references: References; onClose: () => void; onSaved: (value: SalesInvoice) => void }) {
  const { permissionSet } = useAuthorization();
  const canReadCurrencies = allows(permissionSet, endpointPermissionPolicies.currencies);
  const canReadCustomers = allows(permissionSet, endpointPermissionPolicies.customers);
  const canReadFiscalPeriods = allows(permissionSet, endpointPermissionPolicies.fiscalPeriods);
  const canReadWarehouses = allows(permissionSet, endpointPermissionPolicies.warehouses);
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? "");
  const [warehouseId, setWarehouseId] = useState(invoice?.warehouseId ?? "");
  const [currencyId, setCurrencyId] = useState(invoice?.currencyId ?? references.currencies[0]?.id ?? "");
  const [exchangeRate, setExchangeRate] = useState(invoice?.exchangeRate ?? exchangeRateForCurrency(references.currencies[0]));
  const [documentDate, setDocumentDate] = useState(invoice?.document.documentDate ?? new Date().toISOString().slice(0, 10));
  const [sourceInvoiceId, setSourceInvoiceId] = useState(invoice?.sourceInvoiceId ?? "");
  const [lines, setLines] = useState<DraftLine[]>(invoice?.lines.map(lineDraft) ?? [blankLine()]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const totals = useMemo(() => lines.reduce((value, line) => { const gross = Number(line.quantity || 0) * Number(line.unitPrice || 0); const discount = Number(line.discountAmount || 0); const net = Math.max(0, gross - discount); const tax = net * Number(line.taxRateRate || 0) / 100; return { subtotal: value.subtotal + gross, discount: value.discount + discount, tax: value.tax + tax, total: value.total + net + tax }; }, { subtotal: 0, discount: 0, tax: 0, total: 0 }), [lines]);

  useEffect(() => { if (!currencyId && references.currencies[0]) { setCurrencyId(references.currencies[0].id); setExchangeRate(exchangeRateForCurrency(references.currencies[0])); } }, [currencyId, references.currencies]);
  async function selectCurrency(id: string, date = documentDate) { const selected = references.currencies.find((currency) => currency.id === id); setCurrencyId(id); try { setExchangeRate(await exchangeRateForDocumentDate(selected, date)); setErrors((current) => current.filter((message) => message !== missingDatedRateMessage())); } catch { setExchangeRate(""); setErrors([missingDatedRateMessage()]); } }
  function changeDocumentDate(value: string) { setDocumentDate(value); if (currencyId) void selectCurrency(currencyId, value); }
  function setLine(index: number, patch: Partial<DraftLine>) { setLines((current) => current.map((line, position) => position === index ? { ...line, ...patch } : line)); }
  function selectInventoryItem(index: number, item: InventoryItem | null) {
    setLine(index, {
      inventoryItemId: item?.id ?? "",
      inventoryItemLabel: item ? `${item.code} — ${localizedReferenceName(item)} (${item.unitOfMeasure.code})` : "",
      ...(item ? { description: item.description || localizedReferenceName(item) } : {}),
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allows(permissionSet, invoice ? actionPermissionPolicies.salesInvoices.update : actionPermissionPolicies.salesInvoices.create)) return;
    const data = new FormData(event.currentTarget); const value = (name: string) => String(data.get(name) ?? "").trim();
    const validation: string[] = [];
    if (!customerId) validation.push(t("pages.sales-invoices.050"));
    if (type === "SALES_CREDIT_NOTE" && !sourceInvoiceId) validation.push(t("pages.purchase-invoices.052"));
    if (lines.some((line) => line.inventoryItemId) && !warehouseId) validation.push(t("invoiceInventory.warehouseRequired"));
    if (!lines.length || lines.some((line) => !line.description.trim() || !line.revenueAccountId || Number(line.quantity) <= 0 || Number(line.unitPrice) < 0 || Number(line.discountAmount) < 0 || Number(line.discountAmount) > Number(line.quantity) * Number(line.unitPrice))) validation.push(t("pages.purchase-invoices.053"));
    if (totals.total <= 0) validation.push(t("pages.purchase-invoices.054"));
    if (validation.length) { setErrors(validation); return; }
    setSaving(true); setErrors([]);
    try {
      const result = await api<SalesInvoice>(invoice ? `/sales-invoices/${invoice.id}` : "/sales-invoices", { method: invoice ? "PATCH" : "POST", body: JSON.stringify({ documentType: type, fiscalPeriodId: value("fiscalPeriodId"), documentDate: value("documentDate"), dueDate: value("dueDate"), description: value("description"), customerId, warehouseId: warehouseId || null, sourceInvoiceId: type === "SALES_CREDIT_NOTE" ? sourceInvoiceId : null, currencyId, exchangeRate: toRate(exchangeRate), customerAddress: value("customerAddress") || null, notes: value("notes") || null, lines: lines.map((line) => ({ inventoryItemId: line.inventoryItemId || null, description: line.description.trim(), quantity: toQuantity(line.quantity), unitPrice: toMoney(line.unitPrice), discountAmount: toMoney(line.discountAmount), revenueAccountId: line.revenueAccountId, costCenterId: line.costCenterId || null, taxRateId: line.taxRateId || null })), ...(invoice ? { version: invoice.document.version } : {}) }) });
      onSaved(result);
    } catch (cause) { setErrors([cause instanceof ApiError ? cause.message : t("pages.purchase-invoices.055")]); }
    finally { setSaving(false); }
  }

  return <Modal title={invoice ? t("pages.payments.046", { value1: invoice.document.documentNumber }) : type === "SALES_INVOICE" ? t("pages.sales-invoices.056") : t("pages.sales-invoices.057")} description={t("pages.purchase-invoices.059")} onClose={onClose} wide><form className="form-grid sales-invoice-form" onSubmit={submit}>{errors.length > 0 && <div className="form-error full" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    <label><span>{t("pages.payments.049")}</span><select name="fiscalPeriodId" defaultValue={invoice?.document.fiscalPeriodId} disabled={!canReadFiscalPeriods} required><option value="">{t("pages.manual-journals.047")}</option>{references.periods.map((period) => <option key={period.id} value={period.id}>{period.name} — {period.startDate}{t("pages.payments.051")}{period.endDate}</option>)}</select></label>
    <label><span>{t("pages.purchase-invoices.063")}</span><input name="documentDate" type="date" value={documentDate} onChange={(event) => changeDocumentDate(event.target.value)} required /></label>
    <label><span>{t("pages.purchase-invoices.064")}</span><input name="dueDate" type="date" defaultValue={invoice?.dueDate ?? new Date().toISOString().slice(0, 10)} required /></label>
    <label><span>{t("pages.receipts.057")}</span><ReferenceCombobox<Customer> endpoint="/customers?active=true" value={customerId} selectedLabel={invoice?.customer ? `${invoice.customer.code} — ${localizedReferenceName(invoice.customer)}` : invoice?.customerNameSnapshot ?? ""} onChange={(customer) => { setCustomerId(customer?.id ?? ""); setSourceInvoiceId(""); }} optionLabel={(customer) => `${customer.code} — ${localizedReferenceName(customer)}`} placeholder={t("pages.receipts.058")} searchLabel={t("pages.customers.015")} required disabled={!canReadCustomers} /></label>
    {type === "SALES_CREDIT_NOTE" && <label className="full"><span>{t("pages.purchase-invoices.068")}</span><ReferenceCombobox<SalesInvoice> endpoint={`/sales-invoices?documentType=SALES_INVOICE&status=POSTED${customerId ? `&customerId=${customerId}` : ""}`} value={sourceInvoiceId} selectedLabel={invoice?.sourceInvoiceNumber ?? ""} onChange={(source) => setSourceInvoiceId(source?.id ?? "")} optionLabel={(source) => `${source.document.documentNumber}${t("pages.purchase-invoices.070")}${formatMoney(source.total)}${t("pages.payments.082")}${formatMoney(source.outstandingAmount)}`} optionDisabled={(source) => Number(source.total) <= Number(source.creditedAmount)} placeholder={t("pages.purchase-invoices.069")} searchLabel={t("pages.purchase-invoices.068")} required disabled={!customerId} /></label>}
    <label className="full"><span>{t("pages.payments.053")}</span><input name="description" defaultValue={invoice?.document.description} maxLength={500} required /></label>
    <label><span>{t("pages.payments.066")}</span><select value={currencyId} onChange={(event) => void selectCurrency(event.target.value)} disabled={!canReadCurrencies} required>{references.currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} — {localizedReferenceName(currency)}</option>)}</select></label>
    <label><span>{t("pages.payments.068")}</span><input dir="ltr" inputMode="decimal" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} required /></label>
    <label className="full"><span>{t("invoiceInventory.warehouse")}</span><ReferenceCombobox<Warehouse> endpoint="/warehouses?active=true" value={warehouseId} selectedLabel={invoice?.warehouseId ? `${invoice.warehouseCodeSnapshot} — ${invoice.warehouseNameSnapshot}` : ""} onChange={(warehouse) => setWarehouseId(warehouse?.id ?? "")} optionLabel={(warehouse) => `${warehouse.code} — ${localizedReferenceName(warehouse)}`} placeholder={t("invoiceInventory.noWarehouse")} searchLabel={t("invoiceInventory.warehouse")} optionalLabel={t("invoiceInventory.noWarehouse")} disabled={!canReadWarehouses} /><small>{t("invoiceInventory.warehouseHint")}</small></label>
    <label className="full"><span>{t("pages.purchase-invoices.075")}</span><input name="customerAddress" defaultValue={invoice?.customerAddressSnapshot ?? ""} maxLength={500} placeholder={t("pages.sales-invoices.074")} /></label>
    <fieldset className="full invoice-lines-field"><legend>{t("pages.purchase-invoices.077")}</legend><div className="invoice-line-list">{lines.map((line, index) => <div className="invoice-line-editor" key={index}><span className="line-index">{index + 1}</span><label className="line-item"><span>{t("invoiceInventory.item")}</span><ReferenceCombobox<InventoryItem> endpoint="/inventory-items?active=true" value={line.inventoryItemId} selectedLabel={line.inventoryItemLabel} onChange={(item) => selectInventoryItem(index, item)} optionLabel={(item) => `${item.code} — ${localizedReferenceName(item)} (${item.unitOfMeasure.code})`} placeholder={t("invoiceInventory.manualLine")} searchLabel={t("invoiceInventory.item")} optionalLabel={t("invoiceInventory.manualLine")} /></label><label className="line-description"><span>{t("pages.purchase-invoices.078")}</span><input value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} required /></label><label className="line-quantity"><span>{t("pages.purchase-invoices.079")}</span><input dir="ltr" inputMode="decimal" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} required /></label><label className="line-unit-price"><span>{t("pages.purchase-invoices.080")}</span><input dir="ltr" inputMode="decimal" value={line.unitPrice} onChange={(event) => setLine(index, { unitPrice: event.target.value })} required /></label><label className="line-discount"><span>{t("pages.purchase-invoices.081")}</span><input dir="ltr" inputMode="decimal" value={line.discountAmount} onChange={(event) => setLine(index, { discountAmount: event.target.value })} required /></label><label className="line-account"><span>{t("pages.sales-invoices.080")}</span><ReferenceCombobox<Account> endpoint="/accounts?active=true&allowsPosting=true&accountClasses=REVENUE" value={line.revenueAccountId} selectedLabel={line.revenueAccountLabel} onChange={(account) => setLine(index, { revenueAccountId: account?.id ?? "", revenueAccountLabel: account ? `${account.code} — ${localizedReferenceName(account)}` : "" })} optionLabel={(account) => `${account.code} — ${localizedReferenceName(account)}`} placeholder={t("pages.purchase-invoices.083")} searchLabel={t("pages.sales-invoices.080")} required /></label><label className="line-tax"><span>{t("pages.purchase-invoices.084")}</span><ReferenceCombobox<TaxRate> endpoint="/tax-rates?activeOnly=true" value={line.taxRateId} selectedLabel={line.taxRateLabel} onChange={(tax) => setLine(index, { taxRateId: tax?.id ?? "", taxRateLabel: tax ? `${localizedReferenceName(tax)} (${Number(tax.rate)}%)${tax.isReady ? "" : ` — ${taxReadinessLabel(tax)}`}` : "", taxRateRate: tax?.rate ?? "0" })} optionLabel={(tax) => `${localizedReferenceName(tax)} (${Number(tax.rate)}%)${tax.isReady ? "" : ` — ${taxReadinessLabel(tax)}`}`} optionDisabled={(tax) => !tax.isReady} placeholder={t("pages.purchase-invoices.085")} searchLabel={t("pages.purchase-invoices.084")} optionalLabel={t("pages.purchase-invoices.085")} /></label><label className="line-cost-center"><span>{t("pages.manual-journals.057")}</span><ReferenceCombobox<CostCenter> endpoint="/cost-centers?active=true" value={line.costCenterId} selectedLabel={line.costCenterLabel} onChange={(center) => setLine(index, { costCenterId: center?.id ?? "", costCenterLabel: center ? `${center.code} — ${localizedReferenceName(center)}` : "" })} optionLabel={(center) => `${center.code} — ${localizedReferenceName(center)}`} placeholder={t("pages.purchase-invoices.087")} searchLabel={t("pages.manual-journals.057")} optionalLabel={t("pages.purchase-invoices.087")} /></label><Button type="button" className="line-delete" variant="ghost" icon="trash" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>{t("pages.accounts.050")}</Button></div>)}</div><Button type="button" variant="secondary" icon="plus" onClick={() => setLines((current) => [...current, blankLine()])}>{t("pages.purchase-invoices.089")}</Button></fieldset>
    <div className="invoice-live-summary full"><span>{t("pages.purchase-invoices.090")}<strong>{formatMoney(totals.subtotal)}</strong></span><span>{t("pages.purchase-invoices.091")}<strong>{formatMoney(totals.discount)}</strong></span><span>{t("pages.purchase-invoices.092")}<strong>{formatMoney(totals.tax)}</strong></span><span className="grand-total">{t("pages.purchase-invoices.093")}<strong>{formatMoney(totals.total)}</strong></span></div>
    <label className="full"><span>{t("pages.payments.074")}</span><textarea name="notes" defaultValue={invoice?.notes ?? ""} maxLength={1000} rows={3} /></label>
    <div className="form-actions full"><Button type="button" variant="secondary" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit" disabled={saving}>{saving ? t("pages.purchase-invoices.095") : t("pages.manual-journals.077")}</Button></div>
  </form></Modal>;
}

function lineDraft(line: SalesInvoiceLine): DraftLine { return { inventoryItemId: line.inventoryItemId ?? "", inventoryItemLabel: line.inventoryItemId ? `${line.inventoryItemCodeSnapshot} — ${line.inventoryItemNameSnapshot} (${line.unitOfMeasureCodeSnapshot})` : "", description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount, revenueAccountId: line.revenueAccountId, revenueAccountLabel: line.revenueAccount ? `${line.revenueAccount.code} — ${line.revenueAccount.nameAr}` : "", costCenterId: line.costCenterId ?? "", costCenterLabel: line.costCenter ? `${line.costCenter.code} — ${line.costCenter.nameAr}` : "", taxRateId: line.taxRateId ?? "", taxRateLabel: line.taxRate ? `${localizedReferenceName(line.taxRate)} (${Number(line.taxRate.rate)}%)` : "", taxRateRate: line.taxRate?.rate ?? line.taxRateSnapshot ?? "0" }; }

function InvoiceDetails({ invoice, onClose, onEdit, onCommand, onPrint }: { invoice: SalesInvoice; onClose: () => void; onEdit: () => void; onCommand: (operation: "post" | "cancel" | "reverse") => void; onPrint: () => void }) {
  const permissions = actionPermissionPolicies.salesInvoices;
  return <Modal title={t("pages.purchase-invoices.097", { value1: invoice.document.documentType === "SALES_INVOICE" ? t("pages.purchase-invoices.044") : t("pages.sales-invoices.015"), value2: invoice.document.documentNumber })} description={`${invoice.customerNameSnapshot} — ${statusLabel(invoice.document.status)}`} onClose={onClose} wide><div className="detail-actions">{["POSTED", "REVERSED"].includes(invoice.document.status) && <Can policy={permissions.print}><Button variant="secondary" icon="print" onClick={onPrint}>{t("pages.payments.087")}</Button></Can>}{invoice.document.status === "DRAFT" && <><Can policy={permissions.update}><Button icon="edit" variant="secondary" onClick={onEdit}>{t("pages.accounts.048")}</Button></Can><Can policy={permissions.post}><Button icon="check" onClick={() => onCommand("post")}>{t("pages.manual-journals.004")}</Button></Can><Can policy={permissions.cancel}><Button icon="ban" variant="danger" onClick={() => onCommand("cancel")}>{t("pages.accounts.065")}</Button></Can></>}{invoice.document.status === "POSTED" && <Can policy={permissions.reverse}><Button icon="reverse" variant="danger" onClick={() => onCommand("reverse")}>{t("pages.manual-journals.006")}</Button></Can>}</div><div className="document-summary invoice-summary"><div><span>{t("pages.manual-journals.050")}</span><strong>{invoice.document.documentDate}</strong></div><div><span>{t("pages.purchase-invoices.101")}</span><strong>{invoice.dueDate}</strong></div><div><span>{t("pages.manual-journals.066")}</span><strong>{invoice.currency?.code}</strong></div>{invoice.warehouseNameSnapshot && <div><span>{t("invoiceInventory.warehouse")}</span><strong>{invoice.warehouseCodeSnapshot} — {invoice.warehouseNameSnapshot}</strong></div>}<div><span>{t("pages.purchase-invoices.103")}</span><strong>{formatMoney(invoice.subtotal)}</strong></div><div><span>{t("pages.purchase-invoices.081")}</span><strong>{formatMoney(invoice.discountTotal)}</strong></div><div><span>{t("pages.purchase-invoices.084")}</span><strong>{formatMoney(invoice.taxTotal)}</strong></div><div><span>{t("pages.purchase-invoices.041")}</span><strong>{formatMoney(invoice.total)}</strong></div>{invoice.document.documentType === "SALES_INVOICE" && <><div><span>{t("pages.sales-invoices.101")}</span><strong>{formatMoney(invoice.paidAmount)}</strong></div><div><span>{t("pages.sales-invoices.102")}</span><strong>{formatMoney(invoice.creditedAmount)}</strong></div><div><span>{t("pages.purchase-invoices.042")}</span><strong>{formatMoney(invoice.outstandingAmount)}</strong></div></>}</div>{invoice.sourceInvoiceNumber && <div className="inline-notice neutral">{t("pages.purchase-invoices.107")}<strong dir="ltr">{invoice.sourceInvoiceNumber}</strong></div>}<div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>#</th><th>{t("invoiceInventory.item")}</th><th>{t("pages.purchase-invoices.078")}</th><th>{t("pages.accounts.039")}</th><th>{t("pages.purchase-invoices.079")}</th><th>{t("pages.purchase-invoices.080")}</th><th>{t("pages.purchase-invoices.081")}</th><th>{t("pages.purchase-invoices.084")}</th><th>{t("pages.purchase-invoices.041")}</th></tr></thead><tbody>{invoice.lines.map((line) => <tr key={line.id}><td>{line.lineNumber}</td><td>{line.inventoryItemNameSnapshot ? <>{line.inventoryItemCodeSnapshot} — {line.inventoryItemNameSnapshot}<small>{line.unitOfMeasureCodeSnapshot}</small></> : t("invoiceInventory.manualLine")}</td><td>{line.description}</td><td>{line.revenueAccount?.code} — {line.revenueAccount?.nameAr}</td><td>{formatMoney(line.quantity)}</td><td>{formatMoney(line.unitPrice)}</td><td>{formatMoney(line.discountAmount)}</td><td>{formatMoney(line.taxAmount)}<small>{Number(line.taxRateSnapshot)}%</small></td><td className="money-cell">{formatMoney(line.totalAmount)}</td></tr>)}</tbody></table></div>{invoice.notes && <div className="notes-panel"><strong>{t("pages.payments.074")}</strong><p>{invoice.notes}</p></div>}</Modal>;
}

function AgingReport() {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10)); const [customerId, setCustomerId] = useState(""); const [report, setReport] = useState<ReceivablesAgingReport | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setReport(await api<ReceivablesAgingReport>(`/reports/receivables-aging?asOf=${asOf}${customerId ? `&customerId=${customerId}` : ""}`)); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.purchase-invoices.109")); } finally { setLoading(false); } }, [asOf, customerId]);
  useEffect(() => { void load(); }, [load]);
  return <article className="panel aging-panel"><header><div><h2>{t("pages.sales-invoices.106")}</h2><p>{t("pages.sales-invoices.107")}</p></div></header><div className="report-toolbar aging-toolbar"><label><span>{t("pages.purchase-invoices.112")}</span><input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label><label><span>{t("pages.sales-invoices.039")}</span><ReferenceCombobox<Customer> endpoint="/customers?active=true" value={customerId} onChange={(customer) => setCustomerId(customer?.id ?? "")} optionLabel={(customer) => `${customer.code} — ${localizedReferenceName(customer)}`} placeholder={t("pages.sales-invoices.109")} searchLabel={t("pages.customers.015")} optionalLabel={t("pages.sales-invoices.109")} /></label><Button onClick={() => void load()}>{t("pages.purchase-invoices.114")}</Button></div>{error ? <div className="inline-notice">{error}</div> : loading ? <Spinner label={t("pages.purchase-invoices.115")} /> : !report?.data.length ? <EmptyState title={t("pages.purchase-invoices.116")} description={t("pages.sales-invoices.113")} /> : <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table aging-table"><thead><tr><th>{t("pages.sales-invoices.039")}</th><th>{t("pages.purchase-invoices.118")}</th><th>{t("pages.purchase-invoices.119")}</th><th>{t("pages.purchase-invoices.120")}</th><th>{t("pages.purchase-invoices.121")}</th><th>{t("pages.purchase-invoices.122")}</th><th>{t("pages.purchase-invoices.041")}</th></tr></thead><tbody>{report.data.map((row) => <tr key={row.customerId}><td><strong>{row.customerName}</strong><small>{row.customerCode} — {row.invoices.length}{t("pages.purchase-invoices.123")}</small></td><td>{formatMoney(row.current)}</td><td>{formatMoney(row.days1To30)}</td><td>{formatMoney(row.days31To60)}</td><td>{formatMoney(row.days61To90)}</td><td>{formatMoney(row.daysOver90)}</td><td className="money-cell">{formatMoney(row.total)}</td></tr>)}</tbody><tfoot><tr><th>{t("pages.purchase-invoices.041")}</th><th>{formatMoney(report.totals.current)}</th><th>{formatMoney(report.totals.days1To30)}</th><th>{formatMoney(report.totals.days31To60)}</th><th>{formatMoney(report.totals.days61To90)}</th><th>{formatMoney(report.totals.daysOver90)}</th><th>{formatMoney(report.totals.total)}</th></tr></tfoot></table></div>}</article>;
}

function TaxRatesPanel({ notify }: { notify: Notice }) {
  const { permissionSet } = useAuthorization();
  const managePolicy = actionPermissionPolicies.salesTaxRates.manage;
  const [editing, setEditing] = useState<TaxRate | null | undefined>(undefined);
  const [rows, setRows] = useState<TaxRate[]>([]); const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 }); const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [submittedSearch, setSubmittedSearch] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { const query = new URLSearchParams({ page: String(page), pageSize: "10", activeOnly: "false", ...(submittedSearch ? { search: submittedSearch } : {}) }); const result = await api<ListResponse<TaxRate>>(`/tax-rates?${query}`); setRows(result.data); setMeta(result.meta); } catch (cause) { setError(cause instanceof Error ? cause.message : t("referencePicker.loadError")); } finally { setLoading(false); } }, [page, submittedSearch]);
  useEffect(() => { void load(); }, [load]);
  return <article className="panel tax-rates-panel"><header><div><h2>{t("pages.sales-invoices.120")}</h2><p>{t("pages.sales-invoices.121")}</p></div><Can policy={managePolicy}><Button icon="plus" onClick={() => setEditing(null)}>{t("pages.purchase-invoices.126")}</Button></Can></header><form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedSearch(search.trim()); }}><input aria-label={t("pages.accounts.025")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("pages.accounts.025")} /><button type="submit">{t("pages.accounts.026")}</button></form>{error ? <div className="inline-notice" role="alert">{error}</div> : loading ? <Spinner label={t("common.loading")} /> : !rows.length ? <EmptyState title={t("pages.purchase-invoices.127")} description={t("pages.sales-invoices.124")} /> : <><div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.accounts.059")}</th><th>{t("pages.fiscal.054")}</th><th>{t("pages.purchase-invoices.131")}</th><th>{t("pages.sales-invoices.128")}</th><th>{t("pages.accounts.043")}</th><th></th></tr></thead><tbody>{rows.map((tax) => <tr key={tax.id}><td><span className="code-pill">{tax.code}</span></td><td>{localizedReferenceName(tax)}</td><td>{Number(tax.rate)}%</td><td>{tax.outputTaxAccount ? `${tax.outputTaxAccount.code} — ${tax.outputTaxAccount.nameAr}` : t("pages.purchase-invoices.133")}</td><td><span className={`status-chip ${tax.isActive ? "active" : "inactive"}`}>{tax.isActive ? t("pages.admin.065") : t("pages.purchase-invoices.135")}</span></td><td><Can policy={managePolicy}><Button variant="ghost" icon="edit" onClick={() => setEditing(tax)}>{t("pages.accounts.048")}</Button></Can></td></tr>)}</tbody></table></div><Pagination {...meta} page={page} onChange={setPage} /></>}{editing !== undefined && allows(permissionSet, managePolicy) && <TaxRateForm taxRate={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); notify(t("pages.purchase-invoices.136")); await load(); }} />}</article>;
}

function TaxRateForm({ taxRate, onClose, onSaved }: { taxRate: TaxRate | null; onClose: () => void; onSaved: () => void }) {
  const { permissionSet } = useAuthorization();
  const [rate, setRate] = useState(taxRate?.rate ?? "15.0000"); const [accountId, setAccountId] = useState(taxRate?.outputTaxAccountId ?? ""); const [active, setActive] = useState(taxRate?.isActive ?? true); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!allows(permissionSet, actionPermissionPolicies.salesTaxRates.manage)) return; setSaving(true); setError(""); const data = new FormData(event.currentTarget); try { await api(taxRate ? `/tax-rates/${taxRate.id}` : "/tax-rates", { method: taxRate ? "PATCH" : "POST", body: JSON.stringify({ nameAr: String(data.get("nameAr") ?? "").trim(), rate: toMoney(rate), outputTaxAccountId: Number(rate) > 0 ? accountId || null : null, ...(taxRate ? { version: taxRate.version, isActive: active } : {}) }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.purchase-invoices.137")); } finally { setSaving(false); } }
  return <Modal title={taxRate ? t("pages.purchase-invoices.138") : t("pages.purchase-invoices.139")} description={t("pages.purchase-invoices.140")} onClose={onClose}><form className="form-grid" onSubmit={submit}>{error && <div className="form-error full" role="alert">{error}</div>}{taxRate ? <label><span>{t("pages.purchase-invoices.141")}</span><input dir="ltr" value={taxRate.code} readOnly /></label> : <div className="inline-notice neutral full">{t("common.autoGeneratedCode")}</div>}<label><span>{t("pages.customers.046")}</span><input name="nameAr" defaultValue={taxRate?.nameAr} required /></label><label><span>{t("pages.purchase-invoices.143")}</span><input dir="ltr" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} required /></label><label><span>{t("pages.sales-invoices.140")}{Number(rate) > 0 && "*"}</span><ReferenceCombobox<Account> endpoint="/accounts?active=true&allowsPosting=true&accountClasses=LIABILITY" value={accountId} selectedLabel={taxRate?.outputTaxAccount ? `${taxRate.outputTaxAccount.code} — ${taxRate.outputTaxAccount.nameAr}` : ""} onChange={(account) => setAccountId(account?.id ?? "")} optionLabel={(account) => `${account.code} — ${localizedReferenceName(account)}`} placeholder={t("pages.customers.044")} searchLabel={t("pages.sales-invoices.140")} optionalLabel={Number(rate) === 0 ? t("pages.customers.044") : undefined} required={Number(rate) > 0} /></label>{taxRate && <label className="check-field full"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span>{t("pages.purchase-invoices.146")}</span></label>}<div className="form-actions full"><Button type="button" variant="secondary" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit" disabled={saving}>{saving ? t("pages.purchase-invoices.095") : t("pages.accounts.067")}</Button></div></form></Modal>;
}

const settlementLabel = (status: SalesInvoice["settlementStatus"]) => ({ OPEN: t("pages.sales-invoices.144"), PARTIAL: t("pages.sales-invoices.145"), PAID: t("pages.purchase-invoices.150") })[status];
