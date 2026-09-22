import { useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadFile } from "../api";
import { activeIntlLocale, localizedCopyFor, useI18n } from "../i18n";
import { inventoryAgingReportCopy } from "../i18n/locales/inventory-aging-report";
import { Button, EmptyState, Spinner } from "../ui";

type Classification = "ACTIVE" | "SLOW_MOVING" | "STAGNANT" | "NO_MOVEMENT";
type AgingRow = { balanceId: string; barcode: string | null; itemName: string; unitOfMeasureCode: string; warehouseCode: string; warehouseName: string; onHand: string; lastMovementDate: string | null; ageDays: number | null; classification: Classification; inventoryValueBase: string | null };
type AgingReport = { asOf: string; policy: { slowMovingDays: number; stagnantDays: number }; rows: AgingRow[]; summary: { balanceCount: number; unvaluedBalanceCount: number; valuedInventoryTotalBase: string; classificationTotals: Record<Classification, { balanceCount: number; valuedInventoryValueBase: string }> } };
const today = () => new Date().toISOString().slice(0, 10);

export function InventoryAgingReportPanel({ notify }: { notify: (message: string, tone?: "success" | "error") => void }) {
  const { locale } = useI18n();
  const copy = localizedCopyFor(inventoryAgingReportCopy, locale, "ar");
  const [report, setReport] = useState<AgingReport | null>(null);
  const [asOf, setAsOf] = useState(today);
  const [slowMovingDays, setSlowMovingDays] = useState(90);
  const [stagnantDays, setStagnantDays] = useState(180);
  const [classification, setClassification] = useState<Classification | "ALL">("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = useCallback(() => new URLSearchParams({ asOf, slowMovingDays: String(slowMovingDays), stagnantDays: String(stagnantDays) }), [asOf, slowMovingDays, stagnantDays]);
  const load = useCallback(async () => {
    if (stagnantDays <= slowMovingDays) { setError(copy.invalidPolicy); setLoading(false); return; }
    setLoading(true); setError("");
    try { setReport(await api<AgingReport>(`/inventory-aging-report?${query()}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : copy.loadError); }
    finally { setLoading(false); }
  }, [copy.invalidPolicy, copy.loadError, query, slowMovingDays, stagnantDays]);
  useEffect(() => { void load(); }, [load]);
  const rows = useMemo(() => report?.rows.filter((row) => classification === "ALL" || row.classification === classification) ?? [], [classification, report]);
  const counts = useMemo(() => Object.fromEntries((["ACTIVE", "SLOW_MOVING", "STAGNANT", "NO_MOVEMENT"] as const).map((value) => [value, report?.rows.filter((row) => row.classification === value).length ?? 0])) as Record<Classification, number>, [report]);
  const download = async () => { try { await downloadFile(`/inventory-aging-report.xlsx?${query()}`, `inventory-aging-${asOf}.xlsx`); notify(copy.downloaded); } catch (cause) { notify(cause instanceof Error ? cause.message : copy.loadError, "error"); } };
  const number = (value: string) => Number(value).toLocaleString(activeIntlLocale(), { maximumFractionDigits: 4 });
  return <>
    <div className="subsection-heading"><div><h2>{copy.title}</h2><p>{copy.description}</p></div><Button variant="secondary" icon="document" onClick={() => void download()} disabled={loading || !report}>{copy.download}</Button></div>
    <div className="toolbar treasury-filters inventory-catalog-toolbar"><label>{copy.asOf}<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label><label>{copy.slowMovingDays}<input type="number" min={1} max={3650} value={slowMovingDays} onChange={(event) => setSlowMovingDays(Number(event.target.value))} /></label><label>{copy.stagnantDays}<input type="number" min={2} max={7300} value={stagnantDays} onChange={(event) => setStagnantDays(Number(event.target.value))} /></label><select aria-label={copy.classification} value={classification} onChange={(event) => setClassification(event.target.value as Classification | "ALL")}><option value="ALL">{copy.allClassifications}</option><option value="ACTIVE">{copy.active}</option><option value="SLOW_MOVING">{copy.slowMoving}</option><option value="STAGNANT">{copy.stagnant}</option><option value="NO_MOVEMENT">{copy.noMovement}</option></select></div>
    {error ? <div className="form-error" role="alert">{error} <Button variant="ghost" onClick={() => void load()}>{copy.retry}</Button></div> : loading ? <Spinner label={copy.loading} /> : report && <><div className="metric-grid statement-metrics"><article className="metric-card"><span>{copy.slowMoving}</span><strong dir="ltr">{number(report.summary.classificationTotals.SLOW_MOVING.valuedInventoryValueBase)}</strong><small>{counts.SLOW_MOVING.toLocaleString(activeIntlLocale())} {copy.balanceRows}</small></article><article className="metric-card"><span>{copy.stagnant}</span><strong dir="ltr">{number(report.summary.classificationTotals.STAGNANT.valuedInventoryValueBase)}</strong><small>{counts.STAGNANT.toLocaleString(activeIntlLocale())} {copy.balanceRows}</small></article><article className="metric-card neutral"><span>{copy.noMovement}</span><strong dir="ltr">{number(report.summary.classificationTotals.NO_MOVEMENT.valuedInventoryValueBase)}</strong><small>{counts.NO_MOVEMENT.toLocaleString(activeIntlLocale())} {copy.balanceRows}</small></article><article className="metric-card neutral"><span>{copy.totalValue}</span><strong dir="ltr">{number(report.summary.valuedInventoryTotalBase)}</strong><small>{copy.valuedOnly}</small></article></div>{report.summary.unvaluedBalanceCount > 0 && <div className="inline-notice warning" role="alert">{copy.warning.replace("{count}", report.summary.unvaluedBalanceCount.toLocaleString(activeIntlLocale()))}</div>}{!rows.length ? <EmptyState title={copy.empty} description={copy.description} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={copy.title}><table className="data-table"><thead><tr><th>{copy.item}</th><th>{copy.warehouse}</th><th>{copy.quantity}</th><th>{copy.lastMovement}</th><th>{copy.ageDays}</th><th>{copy.classification}</th><th>{copy.value}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.balanceId}><td><strong>{row.itemName}</strong><small dir="ltr">{row.barcode ?? copy.noBarcode} · {row.unitOfMeasureCode}</small></td><td><strong>{row.warehouseName}</strong><small dir="ltr">{row.warehouseCode}</small></td><td dir="ltr">{number(row.onHand)}</td><td dir="ltr">{row.lastMovementDate ?? "—"}</td><td dir="ltr">{row.ageDays === null ? "—" : row.ageDays.toLocaleString(activeIntlLocale())}</td><td><span className={`status-chip ${row.classification === "ACTIVE" ? "active" : "inactive"}`}>{copy.classifications[row.classification]}</span></td><td dir="ltr">{row.inventoryValueBase === null ? "—" : number(row.inventoryValueBase)}</td></tr>)}</tbody></table></div>}</>}
  </>;
}
