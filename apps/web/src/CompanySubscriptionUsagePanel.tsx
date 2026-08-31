import { useEffect, useState } from "react";
import { useAuthorization } from "./authorization-context";
import { useI18n } from "./i18n";
import { Button, Spinner } from "./ui";
import { loadSubscriptionUsage, subscriptionUsageError, type SubscriptionUsage, type SubscriptionUsageMetric } from "./subscription-usage";
import "./subscription-usage.css";

export function CompanySubscriptionUsagePanel() {
  const { selectedCompany, permissionSet } = useAuthorization();
  const companyId = selectedCompany?.id;
  const allowed = permissionSet.has("subscriptions.view");
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<SubscriptionUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ReturnType<typeof subscriptionUsageError> | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null); setError(null); setLoading(true);
    if (!allowed || !companyId) return () => controller.abort();
    void loadSubscriptionUsage(companyId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setSnapshot(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(subscriptionUsageError(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [companyId, allowed, reload]);
  if (!allowed || !companyId) return null;
  const current = snapshot?.companyId === companyId ? snapshot : null;
  return <section className="panel subscription-usage-panel" aria-labelledby="subscription-usage-title" aria-busy={loading}>
    <header className="subscription-usage-heading">
      <div><h2 id="subscription-usage-title">{t("subscriptionUsage.title")}</h2><p>{t("subscriptionUsage.description")}</p></div>
      <Button type="button" variant="secondary" disabled={loading} onClick={() => setReload((value) => value + 1)}>{t("common.refresh")}</Button>
    </header>
    {loading ? <Spinner label={t("subscriptionUsage.loading")} /> : error ? <div className="error-panel" role="alert">
      <h3>{t("subscriptionUsage.errorTitle")}</h3><p>{t(`subscriptionUsage.${error}`)}</p>
      {error !== "forbidden" && <Button type="button" onClick={() => setReload((value) => value + 1)}>{t("common.retry")}</Button>}
    </div> : current && <SubscriptionUsageContent snapshot={current} />}
  </section>;
}

export function SubscriptionUsageContent({ snapshot }: { snapshot: SubscriptionUsage }) {
  const { intlLocale, t } = useI18n();
  const utcTime = (value: string) => new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }).format(new Date(value));
  return <>
    <div className="subscription-usage-context">
      <p><strong>{snapshot.plan?.displayName ?? t("subscriptionUsage.noPlan")}</strong>{snapshot.plan && <> · {t(`subscription.cycle.${snapshot.plan.billingCycle}`)}</>}</p>
      <p>{t("subscriptionUsage.measuredAt", { value1: utcTime(snapshot.measuredAt) })}</p>
      <p>{t("subscriptionUsage.period", { value1: utcTime(snapshot.period.startsAt), value2: utcTime(snapshot.period.endsAtExclusive) })}</p>
      <p>{t(`subscriptionUsage.periodStatus.${snapshot.period.billingPeriodStatus}`)}</p>
    </div>
    <div className="subscription-usage-grid">
      {(["users", "employees", "postedDocuments"] as const).map((name) => <UsageMetric key={name} name={name} metric={snapshot.metrics[name]} />)}
    </div>
    <p className="subscription-usage-note">{t("subscriptionUsage.safety")}</p>
  </>;
}

function UsageMetric({ name, metric }: { name: keyof SubscriptionUsage["metrics"]; metric: SubscriptionUsageMetric }) {
  const { intlLocale, t } = useI18n();
  const count = (value: number) => new Intl.NumberFormat(intlLocale).format(value);
  const comparable = metric.comparisonBasis === "CURRENT_SNAPSHOT" && metric.used !== null && metric.included !== null;
  const showProgress = comparable && metric.included! > 0;
  return <article className={`subscription-usage-card state-${metric.state.toLowerCase()}`} aria-labelledby={`usage-${name}`}>
    <h3 id={`usage-${name}`}>{t(`subscriptionUsage.metric.${name}`)}</h3>
    <p className="subscription-usage-state">{t(`subscriptionUsage.state.${metric.state}`)}</p>
    <dl>
      <div><dt>{t("subscriptionUsage.used")}</dt><dd>{metric.used === null ? t("subscriptionUsage.unknown") : count(metric.used)}</dd></div>
      <div><dt>{t("subscriptionUsage.included")}</dt><dd>{metric.included === null ? t("subscriptionUsage.notConfigured") : count(metric.included)}</dd></div>
      {comparable && metric.remaining !== null && <div><dt>{t("subscriptionUsage.remaining")}</dt><dd>{count(metric.remaining)}</dd></div>}
      {comparable && metric.excess !== null && metric.excess > 0 && <div><dt>{t("subscriptionUsage.excess")}</dt><dd>{count(metric.excess)}</dd></div>}
    </dl>
    {showProgress && <progress max={metric.included!} value={Math.min(metric.used!, metric.included!)} aria-label={t(`subscriptionUsage.metric.${name}`)} />}
    <p className="subscription-usage-definition">{t(`subscriptionUsage.definition.${metric.definition}`)}</p>
    {metric.comparisonBasis === "UNCONFIRMED_PERIOD" && <p>{t("subscriptionUsage.documentPeriod")}</p>}
  </article>;
}
