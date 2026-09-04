import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "./api";
import { activeIntlLocale, useI18n, type TranslationKey } from "./i18n";
import type {
  PlatformAnalyticsComparison,
  PlatformAnalyticsDashboard,
  PlatformComparedMoney,
  PlatformComparedNumber,
} from "./types";
import { Button, EmptyState, Icon, Spinner, type IconName } from "./ui";
import { decimalChartValue, formatCurrencyDecimal, isPositiveDecimal } from "./decimal-format";

type CompanyTarget = { id: string; name: string };
type RangePreset = "7D" | "30D" | "90D" | "YTD" | "CUSTOM";
type AppliedFilters = { from: string; to: string; comparison: PlatformAnalyticsComparison; companyId: string };

const dayMilliseconds = 86_400_000;
const isoDate = (value = new Date()) => value.toISOString().slice(0, 10);
const todayUtc = () => new Date(`${isoDate()}T00:00:00.000Z`);
const addDays = (value: Date, days: number) => new Date(value.getTime() + days * dayMilliseconds);

function presetRange(preset: Exclude<RangePreset, "CUSTOM">) {
  const today = todayUtc();
  if (preset === "YTD") return { from: `${today.getUTCFullYear()}-01-01`, to: isoDate(today) };
  const days = preset === "7D" ? 7 : preset === "30D" ? 30 : 90;
  return { from: isoDate(addDays(today, -(days - 1))), to: isoDate(today) };
}

const moduleLabels: Record<PlatformAnalyticsDashboard["modules"][number]["code"], TranslationKey> = {
  SALES: "nav.sales", PURCHASES: "nav.purchases", TREASURY: "nav.treasury", POS: "nav.pos",
  INVENTORY: "nav.inventory", PROJECTS: "nav.professionalProjects", HR: "nav.humanResources",
  APPROVALS: "nav.approvals", IMPORTS: "nav.imports",
};

export function PlatformAnalyticsDashboardView({
  revision,
  onOpenCompany,
  onOpenCompanies,
  onOpenBilling,
}: {
  revision: number;
  onOpenCompany: (company: CompanyTarget) => void;
  onOpenCompanies: () => void;
  onOpenBilling: () => void;
}) {
  const { formatNumber, t } = useI18n();
  const initial = useMemo(() => presetRange("30D"), []);
  const [preset, setPreset] = useState<RangePreset>("30D");
  const [draftFrom, setDraftFrom] = useState(initial.from);
  const [draftTo, setDraftTo] = useState(initial.to);
  const [draftComparison, setDraftComparison] = useState<PlatformAnalyticsComparison>("PREVIOUS_PERIOD");
  const [draftCompanyId, setDraftCompanyId] = useState("");
  const [filters, setFilters] = useState<AppliedFilters>({
    from: initial.from,
    to: initial.to,
    comparison: "PREVIOUS_PERIOD",
    companyId: "",
  });
  const [dashboard, setDashboard] = useState<PlatformAnalyticsDashboard | null>(null);
  const [currencyCode, setCurrencyCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        from: filters.from,
        to: filters.to,
        comparison: filters.comparison,
      });
      if (filters.companyId) params.set("companyId", filters.companyId);
      setDashboard(await api<PlatformAnalyticsDashboard>(`/platform/analytics?${params}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("platform.analytics.loadError"));
    } finally {
      setLoading(false);
    }
  }, [filters, revision, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dashboard?.financials.length) {
      setCurrencyCode("");
      return;
    }
    if (!dashboard.financials.some((item) => item.currencyCode === currencyCode)) {
      setCurrencyCode(dashboard.financials[0]!.currencyCode);
    }
  }, [currencyCode, dashboard]);

  const applyPreset = (value: Exclude<RangePreset, "CUSTOM">) => {
    const range = presetRange(value);
    setPreset(value);
    setDraftFrom(range.from);
    setDraftTo(range.to);
  };
  const apply = () => {
    setFilters({ from: draftFrom, to: draftTo, comparison: draftComparison, companyId: draftCompanyId });
  };
  const drillCompany = (company: CompanyTarget) => {
    setDraftCompanyId(company.id);
    setFilters((current) => ({ ...current, companyId: company.id }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return <div className="platform-tab-content platform-analytics">
    <form className="panel platform-analytics-filter" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <div className="platform-range-presets" aria-label={t("platform.analytics.presetsAria")}>
        {(["7D", "30D", "90D", "YTD"] as const).map((value) => <button
          type="button"
          key={value}
          className={preset === value ? "active" : ""}
          onClick={() => applyPreset(value)}
        >{t(`platform.analytics.preset.${value}`)}</button>)}
        <button type="button" className={preset === "CUSTOM" ? "active" : ""} onClick={() => setPreset("CUSTOM")}>{t("platform.analytics.preset.CUSTOM")}</button>
      </div>
      <div className="platform-analytics-fields">
        <label><span>{t("platform.analytics.from")}</span><input type="date" value={draftFrom} max={draftTo} onChange={(event) => { setPreset("CUSTOM"); setDraftFrom(event.target.value); }} required /></label>
        <label><span>{t("platform.analytics.to")}</span><input type="date" value={draftTo} min={draftFrom} max={isoDate()} onChange={(event) => { setPreset("CUSTOM"); setDraftTo(event.target.value); }} required /></label>
        <label><span>{t("platform.analytics.compare")}</span><select value={draftComparison} onChange={(event) => setDraftComparison(event.target.value as PlatformAnalyticsComparison)}>
          <option value="PREVIOUS_PERIOD">{t("platform.analytics.compare.previous")}</option>
          <option value="PREVIOUS_YEAR">{t("platform.analytics.compare.year")}</option>
          <option value="NONE">{t("platform.analytics.compare.none")}</option>
        </select></label>
        <label className="platform-company-filter"><span>{t("platform.analytics.companyScope")}</span><select value={draftCompanyId} onChange={(event) => setDraftCompanyId(event.target.value)}>
          <option value="">{t("platform.analytics.allCompanies")}</option>
          {dashboard?.companyOptions.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select></label>
        <Button type="submit" disabled={loading}>{t("platform.analytics.apply")}</Button>
      </div>
    </form>

    {loading && !dashboard ? <Spinner label={t("platform.analytics.loading")} /> : !dashboard ? <AnalyticsError error={error} retry={load} /> : <>
      <div className="platform-analytics-meta">
        <div><strong>{dashboard.scope.company?.name ?? t("platform.analytics.allCompanies")}</strong><span>{t("platform.analytics.rangeSummary", { value1: formatDateRange(dashboard.period.from, dashboard.period.to), value2: dashboard.period.days })}</span></div>
        <div className="platform-analytics-meta-actions">
          {dashboard.financials.length > 1 && <label><span>{t("platform.analytics.currency")}</span><select value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)}>{dashboard.financials.map((financial) => <option key={financial.currencyCode} value={financial.currencyCode}>{financial.currencyCode}</option>)}</select></label>}
          <span>{t("platform.generatedAt", { value1: new Date(dashboard.generatedAt).toLocaleString(activeIntlLocale()) })}</span>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>{t("platform.refresh")}</Button>
        </div>
      </div>
      <nav className="platform-analytics-shortcuts" aria-label={t("platform.analytics.shortcutsAria")}>
        <div><strong>{t("platform.analytics.shortcutsTitle")}</strong><span>{t("platform.analytics.shortcutsDescription")}</span></div>
        <Button variant="secondary" icon="building" onClick={onOpenCompanies}>{t("platform.analytics.openCompanies")}</Button>
        <Button variant="secondary" icon="payments" onClick={onOpenBilling}>{t("platform.analytics.openBilling")}</Button>
      </nav>
      {error && <div className="inline-notice">{t("platform.stale")}</div>}
      <AnalyticsBody dashboard={dashboard} currencyCode={currencyCode} onDrillCompany={drillCompany} onOpenCompany={onOpenCompany} />
    </>}
  </div>;
}

function AnalyticsBody({
  dashboard,
  currencyCode,
  onDrillCompany,
  onOpenCompany,
}: {
  dashboard: PlatformAnalyticsDashboard;
  currencyCode: string;
  onDrillCompany: (company: CompanyTarget) => void;
  onOpenCompany: (company: CompanyTarget) => void;
}) {
  const { formatNumber, t } = useI18n();
  const financial = dashboard.financials.find((item) => item.currencyCode === currencyCode) ?? dashboard.financials[0] ?? null;
  const kpis: Array<{ icon: IconName; label: TranslationKey; value: string; comparison: PlatformComparedNumber | PlatformComparedMoney; tone?: string }> = [
    ...(financial ? [
      { icon: "document" as IconName, label: "platform.analytics.kpi.billed" as TranslationKey, value: formatMoney(financial.billed.current, financial.currencyCode), comparison: financial.billed },
      { icon: "receipts" as IconName, label: "platform.analytics.kpi.collected" as TranslationKey, value: formatMoney(financial.collected.current, financial.currencyCode), comparison: financial.collected },
      { icon: "wallet" as IconName, label: "platform.analytics.kpi.balance" as TranslationKey, value: formatMoney(financial.outstanding, financial.currencyCode), comparison: { current: financial.outstanding, previous: null, changePercent: null } },
      { icon: "check" as IconName, label: "platform.analytics.kpi.collectionRate" as TranslationKey, value: `${formatNumber(financial.collectionRate.current)}%`, comparison: financial.collectionRate, tone: financial.collectionRate.current >= 80 ? "positive" : "warning" },
    ] : []),
    { icon: "audit", label: "platform.analytics.kpi.operations", value: formatNumber(dashboard.metrics.operations.current), comparison: dashboard.metrics.operations },
    { icon: "platform", label: "platform.analytics.kpi.activeCompanies", value: formatNumber(dashboard.metrics.activeCompanies.current), comparison: dashboard.metrics.activeCompanies },
    { icon: "document", label: "platform.analytics.kpi.posted", value: formatNumber(dashboard.metrics.postedDocuments.current), comparison: dashboard.metrics.postedDocuments },
    { icon: "audit", label: "platform.analytics.kpi.alerts", value: formatNumber(dashboard.metrics.securityAlerts.current), comparison: dashboard.metrics.securityAlerts, tone: dashboard.metrics.securityAlerts.current ? "warning" : "positive" },
  ];
  return <>
    <div className="platform-analytics-kpis">{kpis.map((kpi) => <ComparisonMetric key={kpi.label} {...kpi} />)}</div>

    <div className="platform-analytics-main-grid">
      <ChartPanel title={t("platform.analytics.revenueChart")} description={t("platform.analytics.revenueChartDescription")} className="platform-chart-wide" aside={financial ? <ChartLegend items={[
        [t("platform.analytics.billed"), "#276b54"], [t("platform.analytics.collected"), "#c39331"], [t("platform.analytics.previous"), "#9aaba4"],
      ]} /> : undefined}>
        {financial ? <FinancialChart financial={financial} /> : <EmptyState title={t("platform.analytics.noBilling")} description={t("platform.analytics.noBillingDescription")} />}
      </ChartPanel>
      <ChartPanel title={t("platform.analytics.agingTitle")} description={t("platform.analytics.agingDescription")}>
        {financial ? <AgingDonut financial={financial} /> : <EmptyState title={t("platform.analytics.noBalances")} description={t("platform.analytics.noBillingDescription")} />}
      </ChartPanel>
    </div>

    <div className="platform-analytics-main-grid">
      <ChartPanel title={t("platform.analytics.activityChart")} description={t("platform.analytics.activityChartDescription")} className="platform-chart-wide" aside={<ChartLegend items={[
        [t("platform.operations"), "#276b54"], [t("platform.companies.documents"), "#3f86a5"], [t("platform.analytics.previous"), "#9aaba4"],
      ]} />}>
        <ActivityChart dashboard={dashboard} />
      </ChartPanel>
      <ChartPanel title={t("platform.analytics.alertsTitle")} description={t("platform.analytics.alertsDescription")}>
        <AlertsPanel alerts={dashboard.alerts} />
      </ChartPanel>
    </div>

    <div className="platform-analytics-main-grid equal">
      <ChartPanel title={t("platform.analytics.modulesTitle")} description={t("platform.analytics.modulesDescription")}>
        <ModuleBars modules={dashboard.modules} />
      </ChartPanel>
      <ChartPanel title={t("platform.analytics.growthTitle")} description={t("platform.analytics.growthDescription")}>
        <GrowthSummary dashboard={dashboard} />
      </ChartPanel>
    </div>

    <article className="panel platform-list-panel platform-analytics-companies">
      <header><div><h2>{t("platform.analytics.companyRanking")}</h2><p>{t("platform.analytics.companyRankingDescription")}</p></div><span className="code-pill">{formatNumber(dashboard.companies.length)}</span></header>
      {dashboard.companies.length ? <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr>
        <th>{t("platform.company")}</th><th>{t("platform.operations")}</th><th>{t("platform.companies.documents")}</th><th>{t("platform.analytics.billed")}</th><th>{t("platform.analytics.collected")}</th><th>{t("platform.billing.balance")}</th><th>{t("platform.billing.overdue")}</th><th />
      </tr></thead><tbody>{dashboard.companies.map((company) => <tr key={company.id}>
        <td><strong>{company.name}</strong><small>{company.lastActivityAt ? new Date(company.lastActivityAt).toLocaleString(activeIntlLocale()) : t("platform.analytics.noRecentActivity")}</small></td>
        <td>{formatNumber(company.operations)}</td><td>{formatNumber(company.postedDocuments)}</td>
        <td>{formatMoney(company.billed, company.currencyCode)}</td><td>{formatMoney(company.collected, company.currencyCode)}</td>
        <td>{formatMoney(company.outstanding, company.currencyCode)}</td><td className={isPositiveDecimal(company.overdue) ? "platform-overdue" : ""}>{formatMoney(company.overdue, company.currencyCode)}</td>
        <td><div className="platform-row-actions"><Button variant="ghost" onClick={() => onDrillCompany(company)}>{t("platform.analytics.explore")}</Button><Button variant="ghost" onClick={() => onOpenCompany(company)}>{t("platform.companies.open")}</Button></div></td>
      </tr>)}</tbody></table></div> : <EmptyState title={t("platform.noActivity")} description={t("platform.noActivityDescription")} />}
    </article>
  </>;
}

function ComparisonMetric({ icon, label, value, comparison, tone = "" }: {
  icon: IconName;
  label: TranslationKey;
  value: string;
  comparison: PlatformComparedNumber | PlatformComparedMoney;
  tone?: string;
}) {
  const { t } = useI18n();
  const change = comparison.changePercent;
  const trend = change === null ? "neutral" : change > 0 ? "up" : change < 0 ? "down" : "neutral";
  return <article className={`platform-analytics-kpi ${tone}`}>
    <span className="platform-metric-icon"><Icon name={icon} /></span>
    <div><small>{t(label)}</small><strong>{value}</strong><span className={`platform-delta ${trend}`}>{change === null ? t("platform.analytics.noComparison") : `${change > 0 ? "+" : ""}${change}% · ${t("platform.analytics.vsComparison")}`}</span></div>
  </article>;
}

function ChartPanel({ title, description, aside, className = "", children }: {
  title: string; description: string; aside?: ReactNode; className?: string; children: ReactNode;
}) {
  return <article className={`panel platform-chart-panel ${className}`}><header><div><h2>{title}</h2><p>{description}</p></div>{aside}</header><div className="platform-chart-content">{children}</div></article>;
}

function ChartLegend({ items }: { items: Array<[string, string]> }) {
  return <div className="platform-chart-legend">{items.map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</div>;
}

function FinancialChart({ financial }: { financial: PlatformAnalyticsDashboard["financials"][number] }) {
  const { t } = useI18n();
  const [active, setActive] = useState(Math.max(0, financial.timeline.length - 1));
  const values = financial.timeline.flatMap((point) => [decimalChartValue(point.billed), decimalChartValue(point.collected), decimalChartValue(point.previousBilled ?? "0"), decimalChartValue(point.previousCollected ?? "0")]);
  const maximum = Math.max(1, ...values);
  const width = 760;
  const height = 250;
  const top = 18;
  const bottom = 44;
  const chartHeight = height - top - bottom;
  const slot = (width - 48) / Math.max(1, financial.timeline.length);
  const barWidth = Math.min(24, slot * .28);
  const selected = financial.timeline[active] ?? financial.timeline[0]!;
  return <div className="platform-interactive-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("platform.analytics.revenueChart")}>
      {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1="24" x2={width - 24} y1={top + chartHeight * ratio} y2={top + chartHeight * ratio} className="platform-chart-gridline" />)}
      {financial.timeline.map((point, index) => {
        const center = 24 + slot * index + slot / 2;
        const billedHeight = decimalChartValue(point.billed) / maximum * chartHeight;
        const collectedHeight = decimalChartValue(point.collected) / maximum * chartHeight;
        const previousHeight = decimalChartValue(point.previousBilled ?? "0") / maximum * chartHeight;
        return <g key={point.key} className={active === index ? "active" : ""}>
          <rect x={center - barWidth - 2} y={top + chartHeight - billedHeight} width={barWidth} height={Math.max(1, billedHeight)} rx="4" className="platform-bar billed" />
          <rect x={center + 2} y={top + chartHeight - collectedHeight} width={barWidth} height={Math.max(1, collectedHeight)} rx="4" className="platform-bar collected" />
          {point.previousBilled !== null && <line x1={center - barWidth - 4} x2={center + barWidth + 4} y1={top + chartHeight - previousHeight} y2={top + chartHeight - previousHeight} className="platform-previous-marker" />}
          <text x={center} y={height - 16} textAnchor="middle" className="platform-chart-axis-label">{shortDate(point.from)}</text>
          <rect x={24 + slot * index} y={top} width={slot} height={chartHeight + 28} fill="transparent" tabIndex={0} role="button" aria-label={`${formatDateRange(point.from, point.to)}: ${formatMoney(point.billed, financial.currencyCode)}`} onClick={() => setActive(index)} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} className="platform-chart-hit-area" />
        </g>;
      })}
    </svg>
    <div className="platform-chart-tooltip" aria-live="polite"><strong>{formatDateRange(selected.from, selected.to)}</strong><span>{t("platform.analytics.billed")}: {formatMoney(selected.billed, financial.currencyCode)}</span><span>{t("platform.analytics.collected")}: {formatMoney(selected.collected, financial.currencyCode)}</span>{selected.previousBilled !== null && <span>{t("platform.analytics.previous")}: {formatMoney(selected.previousBilled, financial.currencyCode)}</span>}</div>
  </div>;
}

function ActivityChart({ dashboard }: { dashboard: PlatformAnalyticsDashboard }) {
  const { formatNumber, t } = useI18n();
  const [active, setActive] = useState(Math.max(0, dashboard.activityTimeline.length - 1));
  const values = dashboard.activityTimeline.flatMap((point) => [point.operations, point.postedDocuments, point.previousOperations ?? 0]);
  const maximum = Math.max(1, ...values);
  const width = 760;
  const height = 250;
  const left = 34;
  const top = 20;
  const bottom = 44;
  const chartHeight = height - top - bottom;
  const chartWidth = width - left * 2;
  const x = (index: number) => left + (dashboard.activityTimeline.length === 1 ? chartWidth / 2 : index / (dashboard.activityTimeline.length - 1) * chartWidth);
  const y = (value: number) => top + chartHeight - value / maximum * chartHeight;
  const path = (selector: (point: PlatformAnalyticsDashboard["activityTimeline"][number]) => number | null) => dashboard.activityTimeline.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(selector(point) ?? 0)}`).join(" ");
  const selected = dashboard.activityTimeline[active] ?? dashboard.activityTimeline[0]!;
  return <div className="platform-interactive-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("platform.analytics.activityChart")}>
      {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1={left} x2={width - left} y1={top + chartHeight * ratio} y2={top + chartHeight * ratio} className="platform-chart-gridline" />)}
      <path d={path((point) => point.previousOperations)} className="platform-line previous" />
      <path d={path((point) => point.postedDocuments)} className="platform-line documents" />
      <path d={path((point) => point.operations)} className="platform-line operations" />
      {dashboard.activityTimeline.map((point, index) => <g key={point.key}>
        <circle cx={x(index)} cy={y(point.operations)} r={active === index ? 7 : 5} className="platform-chart-point" />
        <text x={x(index)} y={height - 16} textAnchor="middle" className="platform-chart-axis-label">{shortDate(point.from)}</text>
        <rect x={x(index) - Math.max(24, chartWidth / Math.max(1, dashboard.activityTimeline.length - 1) / 2)} y={top} width={Math.max(48, chartWidth / Math.max(1, dashboard.activityTimeline.length - 1))} height={chartHeight + 28} fill="transparent" tabIndex={0} role="button" aria-label={`${formatDateRange(point.from, point.to)}: ${point.operations}`} onClick={() => setActive(index)} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} className="platform-chart-hit-area" />
      </g>)}
    </svg>
    <div className="platform-chart-tooltip" aria-live="polite"><strong>{formatDateRange(selected.from, selected.to)}</strong><span>{t("platform.operations")}: {formatNumber(selected.operations)}</span><span>{t("platform.companies.documents")}: {formatNumber(selected.postedDocuments)}</span><span>{t("platform.metric.alerts")}: {formatNumber(selected.securityAlerts)}</span></div>
  </div>;
}

function AgingDonut({ financial }: { financial: PlatformAnalyticsDashboard["financials"][number] }) {
  const { t } = useI18n();
  const items = [
    { key: "notDue", label: t("platform.analytics.aging.notDue"), rawValue: financial.aging.notDue, chartValue: decimalChartValue(financial.aging.notDue), color: "#2d795d" },
    { key: "days1To30", label: t("platform.analytics.aging.1to30"), rawValue: financial.aging.days1To30, chartValue: decimalChartValue(financial.aging.days1To30), color: "#d7a13b" },
    { key: "days31To60", label: t("platform.analytics.aging.31to60"), rawValue: financial.aging.days31To60, chartValue: decimalChartValue(financial.aging.days31To60), color: "#d57943" },
    { key: "days61Plus", label: t("platform.analytics.aging.61plus"), rawValue: financial.aging.days61Plus, chartValue: decimalChartValue(financial.aging.days61Plus), color: "#a8463b" },
  ];
  const [activeKey, setActiveKey] = useState(items[0]!.key);
  const total = items.reduce((sum, item) => sum + item.chartValue, 0);
  let cursor = 0;
  const stops = items.map((item) => {
    const start = cursor;
    cursor += total ? item.chartValue / total * 100 : 0;
    return `${item.color} ${start}% ${cursor}%`;
  });
  const active = items.find((item) => item.key === activeKey) ?? items[0]!;
  const style = { "--platform-donut": total ? `conic-gradient(${stops.join(",")})` : "#edf3ef" } as CSSProperties;
  return <div className="platform-aging">
    <div className="platform-donut" style={style} role="img" aria-label={t("platform.analytics.agingTitle")}><div><strong>{formatMoney(active.rawValue, financial.currencyCode)}</strong><span>{active.label}</span></div></div>
    <div className="platform-aging-legend">{items.map((item) => <button type="button" key={item.key} className={active.key === item.key ? "active" : ""} onClick={() => setActiveKey(item.key)}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{formatMoney(item.rawValue, financial.currencyCode)}</strong></button>)}</div>
  </div>;
}

function AlertsPanel({ alerts }: { alerts: PlatformAnalyticsDashboard["alerts"] }) {
  const { formatNumber, t } = useI18n();
  const items: Array<{ label: TranslationKey; value: number; severity: "critical" | "warning" | "neutral" }> = [
    { label: "platform.analytics.alert.overdue", value: alerts.overdueInvoices, severity: alerts.overdueInvoices ? "critical" : "neutral" },
    { label: "platform.analytics.alert.dueSoon", value: alerts.dueSoonInvoices, severity: alerts.dueSoonInvoices ? "warning" : "neutral" },
    { label: "platform.analytics.alert.security", value: alerts.unacknowledgedSecurity, severity: alerts.unacknowledgedSecurity ? "critical" : "neutral" },
    { label: "platform.analytics.alert.failedOutbox", value: alerts.failedOutbox, severity: alerts.failedOutbox ? "critical" : "neutral" },
    { label: "platform.analytics.alert.pendingOutbox", value: alerts.pendingOutbox, severity: alerts.pendingOutbox ? "warning" : "neutral" },
    { label: "platform.analytics.alert.stale", value: alerts.staleCompanies, severity: alerts.staleCompanies ? "warning" : "neutral" },
  ];
  return <div className="platform-alert-grid">{items.map((item) => <div key={item.label} className={item.severity}><span>{t(item.label)}</span><strong>{formatNumber(item.value)}</strong><small>{item.value ? t("platform.analytics.needsAttention") : t("platform.analytics.allClear")}</small></div>)}</div>;
}

function ModuleBars({ modules }: { modules: PlatformAnalyticsDashboard["modules"] }) {
  const { formatNumber, t } = useI18n();
  const maximum = Math.max(1, ...modules.map((module) => Math.max(module.current, module.previous ?? 0)));
  return <div className="platform-module-bars">{modules.map((module) => <div key={module.code}>
    <div><strong>{t(moduleLabels[module.code])}</strong><span>{formatNumber(module.current)}{module.changePercent === null ? "" : ` · ${module.changePercent > 0 ? "+" : ""}${module.changePercent}%`}</span></div>
    <div className="platform-module-bar"><i style={{ width: `${module.current / maximum * 100}%` }} />{module.previous !== null && <em style={{ insetInlineStart: `${module.previous / maximum * 100}%` }} />}</div>
  </div>)}</div>;
}

function GrowthSummary({ dashboard }: { dashboard: PlatformAnalyticsDashboard }) {
  const { formatNumber, t } = useI18n();
  const items = [
    { label: t("platform.analytics.growth.active"), metric: dashboard.metrics.activeCompanies },
    { label: t("platform.analytics.growth.new"), metric: dashboard.metrics.newCompanies },
    { label: t("platform.analytics.growth.operations"), metric: dashboard.metrics.operations },
    { label: t("platform.analytics.growth.documents"), metric: dashboard.metrics.postedDocuments },
  ];
  return <div className="platform-growth-grid">{items.map((item) => {
    const delta = item.metric.changePercent;
    return <div key={item.label}><span>{item.label}</span><strong>{formatNumber(item.metric.current)}</strong><small className={delta === null ? "neutral" : delta >= 0 ? "up" : "down"}>{delta === null ? t("platform.analytics.noComparison") : `${delta > 0 ? "+" : ""}${delta}%`}</small></div>;
  })}</div>;
}

function AnalyticsError({ error, retry }: { error: string; retry: () => Promise<void> }) {
  const { t } = useI18n();
  return <div className="error-panel" role="alert"><h3>{t("platform.errorTitle")}</h3><p>{error}</p><Button onClick={() => void retry()}>{t("common.retry")}</Button></div>;
}

function formatMoney(value: string, currency: string) {
  return formatCurrencyDecimal(value, currency, activeIntlLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    currencyDisplay: "symbol",
  });
}

function formatDateRange(from: string, to: string) {
  const formatter = new Intl.DateTimeFormat(activeIntlLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const start = formatter.format(new Date(`${from}T00:00:00.000Z`));
  const end = formatter.format(new Date(`${to}T00:00:00.000Z`));
  return from === to ? start : `${start} – ${end}`;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat(activeIntlLocale(), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}
