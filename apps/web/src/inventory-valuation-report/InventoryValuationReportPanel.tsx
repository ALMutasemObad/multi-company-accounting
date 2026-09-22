import { useCallback, useEffect, useState } from "react";
import { api, downloadFile } from "../api";
import { activeIntlLocale, localizedCopyFor, localizedReferenceName, useI18n } from "../i18n";
import { inventoryValuationReportCopy } from "../i18n/locales/inventory-valuation-report";
import { inventoryAgingReportCopy } from "../i18n/locales/inventory-aging-report";
import type { InventoryBalance, InventoryItem, ListResponse, Warehouse } from "../types";
import { Button, EmptyState, Spinner } from "../ui";
import { InventoryAgingReportPanel } from "./InventoryAgingReportPanel";

type Report = {
  generatedAt: string;
  basis: "CURRENT_BALANCE";
  valuationPolicy: "MOVING_WEIGHTED_AVERAGE";
  rows: InventoryBalance[];
  totals: { rowCount: number; valuedRowCount: number; unvaluedRowCount: number; valuedInventoryValueBase: string };
};

export function InventoryValuationReportPanel({ notify }: { notify: (message: string, tone?: "success" | "error") => void }) {
  const { locale } = useI18n();
  const copy = localizedCopyFor(inventoryValuationReportCopy, locale, "ar");
  const agingCopy = localizedCopyFor(inventoryAgingReportCopy, locale, "ar");
  const [report, setReport] = useState<Report | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [valuationStatus, setValuationStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportMode, setReportMode] = useState<"valuation" | "aging">("valuation");

  const query = useCallback(() => new URLSearchParams({ valuationStatus, ...(warehouseId ? { warehouseId } : {}), ...(inventoryItemId ? { inventoryItemId } : {}), ...(search.trim() ? { search: search.trim() } : {}) }), [inventoryItemId, search, valuationStatus, warehouseId]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [next, warehouseResult, itemResult] = await Promise.all([
        api<Report>(`/inventory-valuation-report?${query()}`),
        api<ListResponse<Warehouse>>("/warehouses?page=1&pageSize=100&active=true"),
        api<ListResponse<InventoryItem>>("/inventory-items?page=1&pageSize=100&active=true"),
      ]);
      setReport(next); setWarehouses(warehouseResult.data); setItems(itemResult.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.loadError); }
    finally { setLoading(false); }
  }, [copy.loadError, query]);
  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    try { await downloadFile(`/inventory-valuation-report.xlsx?${query()}`, "inventory-current-valuation.xlsx"); notify(copy.downloaded); }
    catch (cause) { notify(cause instanceof Error ? cause.message : copy.loadError, "error"); }
  };
  const money = (value: string) => Number(value).toLocaleString(activeIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const quantity = (value: string) => Number(value).toLocaleString(activeIntlLocale(), { maximumFractionDigits: 6 });
  return <>
    <div className="toolbar"><Button variant={reportMode === "valuation" ? "primary" : "secondary"} onClick={() => setReportMode("valuation")}>{copy.title}</Button><Button variant={reportMode === "aging" ? "primary" : "secondary"} onClick={() => setReportMode("aging")}>{agingCopy.title}</Button></div>
    {reportMode === "aging" ? <InventoryAgingReportPanel notify={notify} /> : <>
    <div className="subsection-heading"><div><h2>{copy.title}</h2><p>{copy.description}</p></div><Button variant="secondary" icon="document" onClick={() => void download()} disabled={loading || !report}>{copy.download}</Button></div>
    <div className="toolbar treasury-filters inventory-catalog-toolbar">
      <input aria-label={copy.search} placeholder={copy.search} value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label={copy.warehouse} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">{copy.allWarehouses}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {localizedReferenceName(warehouse)}</option>)}</select>
      <select aria-label={copy.item} value={inventoryItemId} onChange={(event) => setInventoryItemId(event.target.value)}><option value="">{copy.allItems}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)}</option>)}</select>
      <select aria-label={copy.status} value={valuationStatus} onChange={(event) => setValuationStatus(event.target.value)}><option value="ALL">{copy.allStatuses}</option><option value="VALUED">{copy.valued}</option><option value="UNVALUED">{copy.unvalued}</option></select>
    </div>
    {error ? <div className="form-error" role="alert">{error} <Button variant="ghost" onClick={() => void load()}>{copy.loading}</Button></div> : loading ? <Spinner label={copy.loading} /> : report && <>
      <div className="metric-grid statement-metrics"><article className="metric-card"><span>{copy.total}</span><strong dir="ltr">{money(report.totals.valuedInventoryValueBase)}</strong><small>{copy.valued}</small></article><article className="metric-card neutral"><span>{copy.rows}</span><strong>{report.totals.rowCount.toLocaleString(activeIntlLocale())}</strong><small>{new Date(report.generatedAt).toLocaleString(activeIntlLocale())}</small></article></div>
      {report.totals.unvaluedRowCount > 0 && <div className="inline-notice warning" role="alert">{copy.warning.replace("{count}", report.totals.unvaluedRowCount.toLocaleString(activeIntlLocale()))}</div>}
      {!report.rows.length ? <EmptyState title={copy.empty} description={copy.description} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={copy.title}><table className="data-table"><thead><tr><th>{copy.item}</th><th>{copy.unit}</th><th>{copy.warehouse}</th><th>{copy.quantity}</th><th>{copy.averageCost}</th><th>{copy.value}</th><th>{copy.status}</th></tr></thead><tbody>{report.rows.map((row) => <tr key={row.id}><td><strong>{localizedReferenceName(row.inventoryItem)}</strong><small dir="ltr">{row.inventoryItem.primaryBarcode ?? "—"}</small></td><td dir="ltr">{row.inventoryItem.unitOfMeasure.code}</td><td><strong>{localizedReferenceName(row.warehouse)}</strong><small dir="ltr">{row.warehouse.code}</small></td><td dir="ltr">{quantity(row.onHand)}</td><td dir="ltr">{row.isValuationInitialized ? money(row.averageUnitCostBase) : "—"}</td><td dir="ltr">{row.isValuationInitialized ? money(row.inventoryValueBase) : "—"}</td><td><span className={`status-chip ${row.isValuationInitialized ? "active" : "inactive"}`}>{row.isValuationInitialized ? copy.valued : copy.unvalued}</span></td></tr>)}</tbody></table></div>}
    </>}
    </>}
  </>;
}
