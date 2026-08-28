import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { activeIntlLocale, useI18n, type TranslationKey } from "./i18n";
import type { PlatformOverview } from "./types";
import { Button, EmptyState, Icon, PageHeader, Spinner } from "./ui";

const moduleLabels: Record<PlatformOverview["modules"][number]["code"], TranslationKey> = {
  SALES: "nav.sales",
  PURCHASES: "nav.purchases",
  TREASURY: "nav.treasury",
  POS: "nav.pos",
  INVENTORY: "nav.inventory",
  PROJECTS: "nav.professionalProjects",
  HR: "nav.humanResources",
  APPROVALS: "nav.approvals",
  IMPORTS: "nav.imports",
};

export function PlatformOperationsPage() {
  const { formatNumber, t } = useI18n();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOverview(await api<PlatformOverview>(`/platform/overview?days=${days}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("platform.loadError"));
    } finally {
      setLoading(false);
    }
  }, [days, t]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !overview) return <Spinner label={t("platform.loading")} />;
  if (!overview) return <div className="error-panel" role="alert"><h3>{t("platform.errorTitle")}</h3><p>{error}</p><Button onClick={() => void load()}>{t("common.retry")}</Button></div>;

  const metrics: Array<{ key: TranslationKey; value: number; hint: TranslationKey; icon: "building" | "users" | "platform" | "document" | "check" | "audit"; tone?: string }> = [
    { key: "platform.metric.companies", value: overview.metrics.totalCompanies, hint: "platform.metric.companiesHint", icon: "building" },
    { key: "platform.metric.employees", value: overview.metrics.totalEmployees, hint: "platform.metric.employeesHint", icon: "users" },
    { key: "platform.metric.users", value: overview.metrics.totalUsers, hint: "platform.metric.usersHint", icon: "users" },
    { key: "platform.metric.sessions", value: overview.metrics.activeSessions, hint: "platform.metric.sessionsHint", icon: "platform" },
    { key: "platform.metric.operations", value: overview.metrics.systemOperations, hint: "platform.metric.operationsHint", icon: "audit" },
    { key: "platform.metric.documents", value: overview.metrics.financialDocuments, hint: "platform.metric.documentsHint", icon: "document" },
    { key: "platform.metric.posted", value: overview.metrics.postedDocuments, hint: "platform.metric.postedHint", icon: "check" },
    { key: "platform.metric.alerts", value: overview.metrics.securityAlerts, hint: "platform.metric.alertsHint", icon: "audit", tone: overview.metrics.securityAlerts ? "warning" : "positive" },
  ];
  const maxTrend = Math.max(1, ...overview.trends.map((item) => item.operations));

  return (
    <section className="workspace-page platform-page">
      <PageHeader
        kicker={t("platform.kicker")}
        title={t("platform.title")}
        description={t("platform.description")}
        actions={<div className="platform-actions">
          <label><span>{t("platform.window")}</span><select value={days} onChange={(event) => setDays(Number(event.target.value) as 7 | 30 | 90)}>
            <option value={7}>{t("platform.days7")}</option>
            <option value={30}>{t("platform.days30")}</option>
            <option value={90}>{t("platform.days90")}</option>
          </select></label>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>{t("platform.refresh")}</Button>
        </div>}
      />
      {error && <div className="inline-notice">{t("platform.stale")}</div>}
      <div className="platform-metric-grid">
        {metrics.map((metric) => <article className={`platform-metric ${metric.tone ?? ""}`} key={metric.key}><span className="platform-metric-icon"><Icon name={metric.icon} /></span><div><small>{t(metric.key)}</small><strong>{formatNumber(metric.value)}</strong><span>{t(metric.hint)}</span></div></article>)}
      </div>
      <div className="platform-overview-grid">
        <article className="panel platform-trend-panel">
          <header><div><h2>{t("platform.trendTitle")}</h2><p>{t("platform.trendDescription")}</p></div></header>
          <div className="platform-trend" role="img" aria-label={t("platform.trendAria")}>
            {overview.trends.map((item) => <div className="platform-trend-month" key={item.month}><div className="platform-trend-value">{formatNumber(item.operations)}</div><div className="platform-trend-track"><span style={{ height: `${Math.max(5, item.operations / maxTrend * 100)}%` }} /></div><small>{new Intl.DateTimeFormat(activeIntlLocale(), { month: "short" }).format(new Date(`${item.month}-01T00:00:00.000Z`))}</small><em>{t("platform.newCompanies", { value1: item.newCompanies })}</em></div>)}
          </div>
        </article>
        <article className="panel platform-health-panel">
          <header><div><h2>{t("platform.healthTitle")}</h2><p>{t("platform.healthDescription")}</p></div></header>
          <div className="platform-health-list">
            <Health label={t("platform.health.coverage")} value={`${formatNumber(overview.health.employeeAccountCoverage)}%`} good={overview.health.employeeAccountCoverage >= 80} />
            <Health label={t("platform.health.adoption")} value={`${formatNumber(overview.health.companyAdoptionRate)}%`} good={overview.health.companyAdoptionRate >= 60} />
            <Health label={t("platform.health.pendingOutbox")} value={formatNumber(overview.health.pendingOutbox)} good={overview.health.pendingOutbox === 0} />
            <Health label={t("platform.health.failedOutbox")} value={formatNumber(overview.health.failedOutbox)} good={overview.health.failedOutbox === 0} />
            <Health label={t("platform.health.security")} value={formatNumber(overview.health.unacknowledgedSecurityAlerts)} good={overview.health.unacknowledgedSecurityAlerts === 0} />
          </div>
        </article>
      </div>
      <article className="panel platform-modules-panel">
        <header><div><h2>{t("platform.modulesTitle")}</h2><p>{t("platform.modulesDescription")}</p></div></header>
        <div className="platform-module-grid">
          {overview.modules.map((module) => <div className="platform-module" key={module.code}><div><strong>{t(moduleLabels[module.code])}</strong><span>{t("platform.moduleRecent", { value1: module.recent })}</span></div><strong>{formatNumber(module.total)}</strong></div>)}
        </div>
      </article>
      <article className="panel platform-tenants-panel">
        <header><div><h2>{t("platform.tenantsTitle")}</h2><p>{t("platform.tenantsDescription")}</p></div><span>{t("platform.generatedAt", { value1: new Date(overview.generatedAt).toLocaleString(activeIntlLocale()) })}</span></header>
        {overview.topCompanies.length ? <div className="data-table-wrap flat" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("platform.company")}</th><th>{t("platform.operations")}</th><th>{t("platform.lastActivity")}</th></tr></thead><tbody>{overview.topCompanies.map((company) => <tr key={company.id}><td><strong>{company.name}</strong></td><td>{formatNumber(company.operations)}</td><td>{new Date(company.lastActivityAt).toLocaleString(activeIntlLocale())}</td></tr>)}</tbody></table></div> : <EmptyState title={t("platform.noActivity")} description={t("platform.noActivityDescription")} />}
      </article>
    </section>
  );
}

function Health({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div><span className={good ? "health-dot good" : "health-dot attention"} /><span>{label}</span><strong>{value}</strong></div>;
}
