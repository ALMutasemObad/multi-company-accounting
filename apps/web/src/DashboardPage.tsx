import {
  activeIntlLocale,
  translate as t } from "./i18n";
import { useCallback,
  useEffect,
  useState } from "react";
import { api } from "./api";
import { formatMoney } from "./domain";
import { currentYearRange,
  monthLabel } from "./reporting";
import type { DashboardReport } from "./types";
import { Button,
  EmptyState,
  Icon,
  Spinner,
  PageHeader,
} from "./ui";

export function DashboardPage({ onNavigate }: { onNavigate: (view: "customers" | "receipts" | "suppliers" | "payments" | "reports") => void }) {
  const initial = currentYearRange();
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [applied, setApplied] = useState(initial);
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(applied);
      setReport(await api<DashboardReport>(`/reports/dashboard?${query}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("pages.dashboard.001"));
    } finally {
      setLoading(false);
    }
  }, [applied]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !report) return <Spinner label={t("pages.dashboard.002")} />;
  if (error && !report) return <div className="error-panel" role="alert"><h3>{t("pages.dashboard.003")}</h3><p>{error}</p><Button onClick={() => void load()}>{t("pages.accounts.030")}</Button></div>;
  if (!report) return null;
  const currency = report.baseCurrency.code;
  const maxMovement = Math.max(1, ...report.cashFlow.flatMap((item) => [Math.abs(Number(item.receipts)), Math.abs(Number(item.payments))]));
  const cards = [
    { label: t("pages.dashboard.005"), value: formatMoney(report.metrics.receipts), suffix: currency, tone: "positive", icon: "arrowDown" as const },
    { label: t("pages.dashboard.006"), value: formatMoney(report.metrics.payments), suffix: currency, tone: "negative", icon: "arrowUp" as const },
    { label: t("pages.dashboard.007"), value: formatMoney(report.metrics.netCashFlow), suffix: currency, tone: Number(report.metrics.netCashFlow) >= 0 ? "positive" : "negative", icon: "wallet" as const },
    { label: t("pages.dashboard.008"), value: report.metrics.draftDocuments.toLocaleString(activeIntlLocale()), suffix: t("pages.dashboard.009"), tone: "neutral", icon: "document" as const },
  ];
  return (
    <section className="workspace-page dashboard-page">
      <PageHeader kicker={t("pages.dashboard.010")} title={t("pages.dashboard.011")} description={t("pages.dashboard.012")} actions={<div className="period-filter">
          <label><span>{t("pages.dashboard.013")}</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label><span>{t("pages.dashboard.014")}</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          <Button disabled={!dateFrom || !dateTo || dateFrom > dateTo} onClick={() => setApplied({ dateFrom, dateTo })}>{t("pages.dashboard.015")}</Button>
        </div>} />
      {error && <div className="inline-notice">{t("pages.dashboard.016")}</div>}
      <div className="metric-grid">
        {cards.map((card) => <article className={`metric-card ${card.tone}`} key={card.label}><div className="metric-icon"><Icon name={card.icon} /></div><span>{card.label}</span><strong>{card.value}</strong><small>{card.suffix}</small></article>)}
      </div>
      <div className="dashboard-grid">
        <article className="panel cashflow-panel">
          <header><div><h2>{t("pages.dashboard.017")}</h2><p>{t("pages.dashboard.018")}</p></div><button className="text-link strong" onClick={() => onNavigate("reports")}>{t("pages.dashboard.019")}</button></header>
          {report.cashFlow.length ? <div className="cashflow-chart" role="img" aria-label={t("pages.dashboard.020")}>
            {report.cashFlow.map((item) => <div className="chart-month" key={item.month}><div className="bar-pair"><span className="bar receipt" style={{ height: `${Math.max(4, Math.abs(Number(item.receipts)) / maxMovement * 100)}%` }} title={t("pages.dashboard.021", { value1: formatMoney(item.receipts) })} /><span className="bar payment" style={{ height: `${Math.max(4, Math.abs(Number(item.payments)) / maxMovement * 100)}%` }} title={t("pages.dashboard.022", { value1: formatMoney(item.payments) })} /></div><small>{monthLabel(item.month)}</small></div>)}
          </div> : <EmptyState title={t("pages.dashboard.023")} description={t("pages.dashboard.024")} />}
          <div className="chart-legend"><span><i className="receipt" />{t("pages.dashboard.025")}</span><span><i className="payment" />{t("pages.dashboard.026")}</span></div>
        </article>
        <article className="panel overview-panel">
          <header><div><h2>{t("pages.dashboard.027")}</h2><p>{t("pages.dashboard.028")}</p></div></header>
          <button onClick={() => onNavigate("suppliers")}><span>{t("pages.dashboard.029")}</span><strong>{report.metrics.activeSuppliers.toLocaleString(activeIntlLocale())}</strong><Icon name="back" /></button>
          <button onClick={() => onNavigate("customers")}><span>{t("pages.dashboard.030")}</span><strong>{report.metrics.activeCustomers.toLocaleString(activeIntlLocale())}</strong><Icon name="back" /></button>
          <button onClick={() => onNavigate("payments")}><span>{t("pages.dashboard.031")}</span><strong>{report.metrics.draftDocuments.toLocaleString(activeIntlLocale())}</strong><Icon name="back" /></button>
        </article>
      </div>
      <article className="panel activity-panel">
        <header><div><h2>{t("pages.dashboard.032")}</h2><p>{t("pages.dashboard.033")}</p></div></header>
        {report.recentActivity.length ? <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.dashboard.034")}</th><th>{t("pages.accounts.040")}</th><th>{t("pages.dashboard.036")}</th><th>{t("pages.dashboard.037")}</th><th>{t("pages.accounts.043")}</th><th>{t("pages.dashboard.039")}</th></tr></thead><tbody>{report.recentActivity.map((item) => <tr key={`${item.type}-${item.id}`}><td><strong>{item.documentNumber}</strong><small>{item.description}</small></td><td>{item.type === "RECEIPT" ? t("pages.dashboard.040") : t("pages.dashboard.041")}</td><td>{item.counterpartyName}</td><td>{item.documentDate}</td><td><span className={`status-chip ${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></td><td className="money-cell">{formatMoney(item.amount)} {currency}</td></tr>)}</tbody></table></div> : <EmptyState title={t("pages.dashboard.042")} description={t("pages.dashboard.043")} />}
      </article>
    </section>
  );
}

const statusLabel = (status: string) => ({ DRAFT: t("pages.dashboard.044"), POSTED: t("pages.dashboard.045"), CANCELLED: t("pages.dashboard.046"), REVERSED: t("pages.dashboard.047") }[status] ?? status);
