import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, idempotencyKey } from "./api";
import { Can } from "./authorization-context";
import { useI18n } from "./i18n";
import type { SubscriptionCatalog, SubscriptionPlanVersion, SubscriptionSnapshot } from "./types";
import { Button, PageHeader, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;

const moneyText = (value: string | null, currency: string, fallback: string) =>
  value === null ? fallback : `${value} ${currency}`;

export function CompanySubscriptionPage({ notify }: { notify: Notice }) {
  const { formatDateTime, t } = useI18n();
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(null);
  const [catalog, setCatalog] = useState<SubscriptionCatalog>({ plans: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [optionalIds, setOptionalIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [nextSnapshot, nextCatalog] = await Promise.all([
        api<SubscriptionSnapshot>("/subscription?page=1&pageSize=20"),
        api<SubscriptionCatalog>("/subscription/catalog?page=1&pageSize=100"),
      ]);
      setSnapshot(nextSnapshot);
      setCatalog(nextCatalog);
      setSelectedPlanId((current) => current || nextCatalog.plans[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("subscription.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const selectedPlan = useMemo(
    () => catalog.plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [catalog.plans, selectedPlanId],
  );
  const optionalModules = selectedPlan?.modules.filter((module) => module.selectionMode === "OPTIONAL" && module.active) ?? [];

  function selectPlan(id: string) {
    setSelectedPlanId(id);
    setOptionalIds([]);
  }

  function toggleOptional(id: string) {
    if (!selectedPlan) return;
    setOptionalIds((current) => {
      const selected = new Set(current);
      if (!selected.has(id)) {
        const byId = new Map(selectedPlan.modules.map((module) => [module.id, module]));
        const visit = (moduleId: string) => {
          const module = byId.get(moduleId);
          if (!module?.active || module.selectionMode !== "OPTIONAL" || selected.has(moduleId)) return;
          selected.add(moduleId);
          module.dependencyIds.forEach((dependencyId) => {
            if (byId.get(dependencyId)?.selectionMode === "OPTIONAL") visit(dependencyId);
          });
        };
        visit(id);
      } else {
        const removed = new Set([id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const module of selectedPlan.modules) {
            if (module.selectionMode === "OPTIONAL" && selected.has(module.id) && !removed.has(module.id)
              && module.dependencyIds.some((dependencyId) => removed.has(dependencyId))) {
              removed.add(module.id); changed = true;
            }
          }
        }
        removed.forEach((moduleId) => selected.delete(moduleId));
      }
      return [...selected];
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !selectedPlan) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ change: { state: string }; paymentCollected: false }>("/subscription/change-requests", {
        method: "POST",
        idempotencyKey: idempotencyKey("subscription-change", selectedPlan.id),
        body: JSON.stringify({
          targetPlanVersionId: selectedPlan.id,
          optionalModuleIds: optionalIds,
          subscriptionVersion: snapshot.subscription.version,
        }),
      });
      notify(result.change.state === "PENDING_APPROVAL"
        ? t("subscription.requestPending") : t("subscription.changeApplied"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("subscription.changeError"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label={t("subscription.loading")} />;
  if (!snapshot) return (
    <section className="workspace-page subscription-page">
      <PageHeader kicker={t("subscription.kicker")} title={t("subscription.title")} description={t("subscription.description")} />
      <div className="error-panel" role="alert"><h3>{t("subscription.errorTitle")}</h3><p>{error || t("subscription.loadError")}</p><Button onClick={() => void load()}>{t("common.retry")}</Button></div>
    </section>
  );

  const current = snapshot.current;
  return (
    <section className="workspace-page subscription-page">
      <PageHeader
        kicker={t("subscription.kicker")}
        title={t("subscription.title")}
        description={t("subscription.description")}
        actions={<Button variant="secondary" onClick={() => void load()}>{t("common.refresh")}</Button>}
      />
      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="subscription-summary-grid">
        <article className="metric-card"><span>{t("subscription.currentPlan")}</span><strong>{current.plan.displayName}</strong><small>{current.plan.planCode} · {t("subscription.versionLabel", { value1: current.plan.versionNumber })}</small></article>
        <article className="metric-card"><span>{t("subscription.status")}</span><strong>{t(`subscription.status.${snapshot.subscription.status}`)}</strong><small>{snapshot.subscription.trialEndsAt ? t("subscription.trialUntil", { value1: formatDateTime(snapshot.subscription.trialEndsAt) }) : t("subscription.noTrial")}</small></article>
        <article className="metric-card"><span>{t("subscription.recurringFee")}</span><strong>{moneyText(current.quote.totalRecurringFee, current.quote.currencyCode, t("subscription.unpriced"))}</strong><small>{t(`subscription.cycle.${current.plan.billingCycle}`)}</small></article>
      </div>

      <div className="subscription-columns">
        <section className="panel subscription-panel">
          <header><div><h2>{t("subscription.limits")}</h2><p>{t("subscription.limitsDescription")}</p></div></header>
          <dl className="subscription-facts">
            <div><dt>{t("subscription.users")}</dt><dd>{current.plan.includedUsers ?? t("subscription.notConfigured")}</dd></div>
            <div><dt>{t("subscription.employees")}</dt><dd>{current.plan.includedEmployees ?? t("subscription.notConfigured")}</dd></div>
            <div><dt>{t("subscription.documents")}</dt><dd>{current.plan.includedPostedDocuments ?? t("subscription.notConfigured")}</dd></div>
          </dl>
        </section>
        <section className="panel subscription-panel">
          <header><div><h2>{t("subscription.modules")}</h2><p>{t("subscription.modulesDescription")}</p></div></header>
          {snapshot.effectiveModules.length ? <ul className="subscription-module-list">{snapshot.effectiveModules.map((module) => <li key={module.id}><strong>{module.displayName}</strong><small>{module.code}</small></li>)}</ul>
            : <div className="empty-state"><h3>{t("subscription.noModules")}</h3><p>{t("subscription.noModulesDescription")}</p></div>}
        </section>
      </div>

      {(snapshot.scheduled || snapshot.pending) && <section className="panel subscription-panel subscription-attention">
        <header><div><h2>{snapshot.pending ? t("subscription.pendingChange") : t("subscription.scheduledChange")}</h2><p>{snapshot.pending ? t("subscription.pendingPaymentSafe") : t("subscription.effectiveOn", { value1: formatDateTime(snapshot.scheduled!.effectiveAt!) })}</p></div></header>
        <div className="subscription-change-card">
          <strong>{(snapshot.pending ?? snapshot.scheduled)!.plan.displayName}</strong>
          <span>{moneyText((snapshot.pending ?? snapshot.scheduled)!.quote.totalRecurringFee, (snapshot.pending ?? snapshot.scheduled)!.quote.currencyCode, t("subscription.unpriced"))}</span>
        </div>
      </section>}

      <Can policy={{ permission: "subscriptions.manage" }}>
        <form className="panel subscription-panel subscription-change-form" onSubmit={submit}>
          <header><div><h2>{t("subscription.choosePlan")}</h2><p>{t("subscription.choosePlanDescription")}</p></div></header>
          {catalog.plans.length ? <div className="subscription-form-body">
            <label><span>{t("subscription.plan")}</span><select value={selectedPlanId} onChange={(event) => selectPlan(event.target.value)}>{catalog.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.displayName} — {moneyText(plan.recurringFee, plan.currencyCode, t("subscription.unpriced"))}</option>)}</select></label>
            {selectedPlan && <PlanPreview plan={selectedPlan} t={t} />}
            {optionalModules.length > 0 && <fieldset><legend>{t("subscription.optionalModules")}</legend><div className="subscription-option-grid">{optionalModules.map((module) => <label key={module.id}><input type="checkbox" checked={optionalIds.includes(module.id)} onChange={() => toggleOptional(module.id)} /><span><strong>{module.displayName}</strong><small>{moneyText(module.additionalRecurringFee, selectedPlan!.currencyCode, t("subscription.free"))}</small></span></label>)}</div></fieldset>}
            <div className="subscription-safe-note">{t("subscription.paymentSafety")}</div>
            <Button type="submit" disabled={!selectedPlan || saving}>{saving ? t("common.saving") : t("subscription.submitChange")}</Button>
          </div> : <div className="empty-state"><h3>{t("subscription.noPlans")}</h3><p>{t("subscription.noPlansDescription")}</p></div>}
        </form>
      </Can>

      <section className="panel subscription-panel">
        <header><div><h2>{t("subscription.history")}</h2><p>{t("subscription.historyDescription")}</p></div></header>
        {snapshot.history.length ? <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("subscription.plan")}</th><th>{t("subscription.changeState")}</th><th>{t("subscription.requestedAt")}</th><th>{t("subscription.effectiveAt")}</th></tr></thead><tbody>{snapshot.history.map((item, index) => <tr key={item.id ?? `${item.requestedAt}-${index}`}><td>{item.plan.displayName}<small>{item.plan.planCode} · {t("subscription.versionLabel", { value1: item.plan.versionNumber })}</small></td><td>{t(`subscription.changeState.${item.state}`)}</td><td>{formatDateTime(item.requestedAt)}</td><td>{item.effectiveAt ? formatDateTime(item.effectiveAt) : "—"}</td></tr>)}</tbody></table></div>
          : <div className="empty-state"><h3>{t("subscription.noHistory")}</h3><p>{t("subscription.noHistoryDescription")}</p></div>}
      </section>
    </section>
  );
}

function PlanPreview({ plan, t }: { plan: SubscriptionPlanVersion; t: ReturnType<typeof useI18n>["t"] }) {
  return <div className="subscription-plan-preview"><strong>{plan.displayName}</strong><span>{plan.description || t("subscription.noDescription")}</span><small>{t(`subscription.policy.${plan.selfServicePolicy}`)}</small></div>;
}
