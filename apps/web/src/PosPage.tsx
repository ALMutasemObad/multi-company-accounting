import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, idempotencyKey } from "./api";
import { actionPermissionPolicies } from "./action-permissions";
import { allows } from "./authorization";
import { Can, useAuthorization } from "./authorization-context";
import { formatMoney, statusLabel, taxReadinessLabel, toMoney, toQuantity } from "./domain";
import { activeIntlLocale, localizedReferenceName, useI18n } from "./i18n";
import { ReferenceCombobox } from "./ReferenceCombobox";
import type {
  Account,
  CashBankAccount,
  Currency,
  Customer,
  FiscalPeriod,
  InventoryItem,
  ListResponse,
  PaymentMethod,
  PosCheckoutResult,
  PosSale,
  TaxRate,
  Warehouse,
} from "./types";
import { Button, EmptyState, PageHeader, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type DraftLine = {
  inventoryItemId: string;
  inventoryItemLabel: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  revenueAccountId: string;
  revenueAccountLabel: string;
  taxRateId: string;
  taxRateLabel: string;
};

const blankLine = (): DraftLine => ({
  inventoryItemId: "",
  inventoryItemLabel: "",
  description: "",
  quantity: "1.000000",
  unitPrice: "0.0000",
  discountAmount: "0.0000",
  revenueAccountId: "",
  revenueAccountLabel: "",
  taxRateId: "",
  taxRateLabel: "",
});

export const normalizePosRate = (value: string) => {
  const match = value.trim().match(/^(\d{1,11})(?:\.(\d{0,8}))?$/u);
  return match ? `${match[1]}.${(match[2] ?? "").padEnd(8, "0")}` : value.trim();
};

export function PosPage({ notify }: { notify: Notice }) {
  const { t } = useI18n();
  const { permissionSet } = useAuthorization();
  const checkoutPolicy = actionPermissionPolicies.pos.checkout;
  const [sales, setSales] = useState<PosSale[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [exchangeRate, setExchangeRate] = useState("1.00000000");
  const [customerId, setCustomerId] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [warehouseLabel, setWarehouseLabel] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [cashAccountLabel, setCashAccountLabel] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<ListResponse<PosSale>>(`/pos/sales?page=${page}&pageSize=10`);
      setSales(result.data);
      setMeta(result.meta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("pos.loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void Promise.all([
      api<ListResponse<FiscalPeriod>>("/fiscal-periods?page=1&pageSize=100"),
      api<{ data: Currency[] }>("/currencies"),
    ]).then(([periodResult, currencyResult]) => {
      const openPeriods = periodResult.data.filter((period) => period.status !== "CLOSED");
      setPeriods(openPeriods);
      setCurrencies(currencyResult.data);
      setPeriodId((current) => current || openPeriods[0]?.id || "");
      const base = currencyResult.data.find((currency) => currency.isBase) ?? currencyResult.data[0];
      setCurrencyId((current) => current || base?.id || "");
    }).catch((cause) => notify(cause instanceof Error ? cause.message : t("pos.loadError"), "error"));
  }, [notify, t]);

  const displayTotal = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity) || 0;
    const price = Number(line.unitPrice) || 0;
    const discount = Number(line.discountAmount) || 0;
    return sum + Math.max(0, quantity * price - discount);
  }, 0), [lines]);

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line, position) => position === index ? { ...line, ...patch } : line));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allows(permissionSet, checkoutPolicy)) return;
    const data = new FormData(event.currentTarget);
    if (paymentMethod?.requiresReference && !String(data.get("referenceNumber") ?? "").trim()) {
      notify(t("pos.referenceRequired"), "error");
      return;
    }
    setSaving(true);
    try {
      await api<PosCheckoutResult>("/pos/checkouts", {
        method: "POST",
        idempotencyKey: idempotencyKey("pos-checkout", crypto.randomUUID()),
        body: JSON.stringify({
          fiscalPeriodId: periodId,
          documentDate: String(data.get("documentDate") ?? ""),
          description: String(data.get("description") ?? "").trim(),
          customerId,
          warehouseId,
          currencyId,
          exchangeRate: normalizePosRate(exchangeRate),
          cashBankAccountId: cashAccountId,
          paymentMethodId: paymentMethod?.id ?? "",
          referenceNumber: String(data.get("referenceNumber") ?? "").trim() || null,
          notes: String(data.get("notes") ?? "").trim() || null,
          lines: lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            description: line.description.trim(),
            quantity: toQuantity(line.quantity),
            unitPrice: toMoney(line.unitPrice),
            discountAmount: toMoney(line.discountAmount),
            revenueAccountId: line.revenueAccountId,
            costCenterId: null,
            taxRateId: line.taxRateId || null,
          })),
        }),
      });
      notify(t("pos.completed"));
      setLines([blankLine()]);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("pos.checkoutError"), "error");
    } finally {
      setSaving(false);
    }
  }

  return <section className="workspace-page pos-workspace">
    <PageHeader kicker={t("pos.kicker")} title={t("pos.title")} description={t("pos.description")} />
    <div className="pos-layout">
      <form className="panel pos-checkout-form" onSubmit={submit}>
        <header><div><h2>{t("pos.newSale")}</h2><p>{t("pos.inventoryOnly")}</p></div></header>
        <div className="pos-reference-grid">
          <label><span>{t("pos.period")}</span><select value={periodId} onChange={(event) => setPeriodId(event.target.value)} required><option value="" />{periods.map((period) => <option value={period.id} key={period.id}>{period.name}</option>)}</select></label>
          <label><span>{t("pos.date")}</span><input name="documentDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
          <label className="pos-description"><span>{t("pos.descriptionLabel")}</span><input name="description" maxLength={500} required /></label>
          <label><span>{t("pos.customer")}</span><ReferenceCombobox<Customer> endpoint="/customers?active=true" value={customerId} selectedLabel={customerLabel} onChange={(customer) => { setCustomerId(customer?.id ?? ""); setCustomerLabel(customer ? `${customer.code} — ${localizedReferenceName(customer)}` : ""); }} optionLabel={(customer) => `${customer.code} — ${localizedReferenceName(customer)}`} placeholder={t("pos.customer")} searchLabel={t("pos.customer")} required /></label>
          <label><span>{t("pos.warehouse")}</span><ReferenceCombobox<Warehouse> endpoint="/warehouses?active=true" value={warehouseId} selectedLabel={warehouseLabel} onChange={(warehouse) => { setWarehouseId(warehouse?.id ?? ""); setWarehouseLabel(warehouse ? `${warehouse.code} — ${localizedReferenceName(warehouse)}` : ""); }} optionLabel={(warehouse) => `${warehouse.code} — ${localizedReferenceName(warehouse)}`} placeholder={t("pos.warehouse")} searchLabel={t("pos.warehouse")} required /></label>
          <label><span>{t("pos.currency")}</span><select value={currencyId} onChange={(event) => setCurrencyId(event.target.value)} required><option value="" />{currencies.map((currency) => <option value={currency.id} key={currency.id}>{currency.code} — {currency.nameAr}</option>)}</select></label>
          <label><span>{t("pos.exchangeRate")}</span><input dir="ltr" inputMode="decimal" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} required /></label>
          <label><span>{t("pos.cashAccount")}</span><ReferenceCombobox<CashBankAccount> endpoint="/cash-bank-accounts?active=true" value={cashAccountId} selectedLabel={cashAccountLabel} onChange={(account) => { setCashAccountId(account?.id ?? ""); setCashAccountLabel(account ? `${account.code} — ${localizedReferenceName(account)}` : ""); }} optionLabel={(account) => `${account.code} — ${localizedReferenceName(account)}`} placeholder={t("pos.cashAccount")} searchLabel={t("pos.cashAccount")} required /></label>
          <label><span>{t("pos.paymentMethod")}</span><ReferenceCombobox<PaymentMethod> endpoint="/payment-methods?active=true" value={paymentMethod?.id ?? ""} selectedLabel={paymentMethod ? `${paymentMethod.code} — ${paymentMethod.nameAr}` : ""} onChange={setPaymentMethod} optionLabel={(method) => `${method.code} — ${method.nameAr}`} placeholder={t("pos.paymentMethod")} searchLabel={t("pos.paymentMethod")} required /></label>
          <label><span>{t("pos.reference")}</span><input name="referenceNumber" maxLength={100} required={paymentMethod?.requiresReference} /></label>
        </div>
        <fieldset className="pos-lines"><legend>{t("pos.lines")}</legend>{lines.map((line, index) => <div className="pos-line" key={index}>
          <span className="line-index">{index + 1}</span>
          <label className="pos-item"><span>{t("pos.item")}</span><ReferenceCombobox<InventoryItem> endpoint="/inventory-items?active=true" value={line.inventoryItemId} selectedLabel={line.inventoryItemLabel} onChange={(item) => updateLine(index, { inventoryItemId: item?.id ?? "", inventoryItemLabel: item ? `${item.code} — ${localizedReferenceName(item)}` : "", description: item ? localizedReferenceName(item) : line.description })} optionLabel={(item) => `${item.code} — ${localizedReferenceName(item)}`} placeholder={t("pos.item")} searchLabel={t("pos.item")} required /></label>
          <label><span>{t("pos.quantity")}</span><input dir="ltr" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} required /></label>
          <label><span>{t("pos.unitPrice")}</span><input dir="ltr" inputMode="decimal" value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} required /></label>
          <label><span>{t("pos.discount")}</span><input dir="ltr" inputMode="decimal" value={line.discountAmount} onChange={(event) => updateLine(index, { discountAmount: event.target.value })} required /></label>
          <label className="pos-revenue"><span>{t("pos.revenueAccount")}</span><ReferenceCombobox<Account> endpoint="/accounts?active=true&allowsPosting=true&accountClasses=REVENUE" value={line.revenueAccountId} selectedLabel={line.revenueAccountLabel} onChange={(account) => updateLine(index, { revenueAccountId: account?.id ?? "", revenueAccountLabel: account ? `${account.code} — ${localizedReferenceName(account)}` : "" })} optionLabel={(account) => `${account.code} — ${localizedReferenceName(account)}`} placeholder={t("pos.revenueAccount")} searchLabel={t("pos.revenueAccount")} required /></label>
          <label className="pos-tax"><span>{t("pos.tax")}</span><ReferenceCombobox<TaxRate> endpoint="/tax-rates?activeOnly=true" value={line.taxRateId} selectedLabel={line.taxRateLabel} onChange={(tax) => updateLine(index, { taxRateId: tax?.id ?? "", taxRateLabel: tax ? `${localizedReferenceName(tax)} (${Number(tax.rate)}%)` : "" })} optionLabel={(tax) => `${localizedReferenceName(tax)} (${Number(tax.rate)}%)${tax.isReady ? "" : ` — ${taxReadinessLabel(tax)}`}`} optionDisabled={(tax) => !tax.isReady} placeholder={t("pos.tax")} searchLabel={t("pos.tax")} optionalLabel={t("pos.tax")} /></label>
          <Button type="button" variant="ghost" icon="trash" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>{t("pos.removeLine")}</Button>
        </div>)}<Button type="button" variant="secondary" icon="plus" disabled={lines.length >= 50} onClick={() => setLines((current) => [...current, blankLine()])}>{t("pos.addLine")}</Button></fieldset>
        <div className="pos-checkout-footer"><label><span>{t("pos.notes")}</span><textarea name="notes" maxLength={1000} rows={2} /></label><div className="pos-total"><span>{t("pos.total")}</span><strong>{formatMoney(displayTotal)}</strong></div><Can policy={checkoutPolicy}><Button type="submit" icon="check" disabled={saving || !periodId || !currencyId || !customerId || !warehouseId || !cashAccountId || !paymentMethod}>{saving ? t("pos.checkingOut") : t("pos.checkout")}</Button></Can></div>
      </form>
      <article className="panel pos-history"><header><div><h2>{t("pos.recentSales")}</h2><p>{t("pos.recentDescription")}</p></div></header>
        {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{t("common.retry")}</Button></div> : loading ? <Spinner label={t("common.loading")} /> : sales.length === 0 ? <EmptyState title={t("pos.emptyTitle")} description={t("pos.emptyDescription")} /> : <><div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pos.invoice")}</th><th>{t("pos.receipt")}</th><th>{t("pos.customer")}</th><th>{t("pos.total")}</th><th>{t("pos.completedAt")}</th><th>{t("pos.status")}</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td dir="ltr">{sale.invoice.documentNumber}</td><td dir="ltr">{sale.receipt.documentNumber}</td><td>{sale.invoice.customerName}</td><td className="money-cell">{formatMoney(sale.invoice.total)}</td><td>{new Date(sale.completedAt).toLocaleString(activeIntlLocale())}</td><td><div className="pos-statuses"><span><small>{t("pos.invoice")}</small><span className={`status-chip ${sale.invoice.status.toLowerCase()}`}>{statusLabel(sale.invoice.status)}</span></span><span><small>{t("pos.receipt")}</small><span className={`status-chip ${sale.receipt.status.toLowerCase()}`}>{statusLabel(sale.receipt.status)}</span></span></div></td></tr>)}</tbody></table></div><Pagination {...meta} page={page} onChange={setPage} /></>}
      </article>
    </div>
  </section>;
}
