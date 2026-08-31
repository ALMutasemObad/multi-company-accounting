import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Can, useAuthorization } from "./authorization-context";
import { SubscriptionBillingCenter } from "./SubscriptionBillingCenter";
import { useI18n } from "./i18n";
import type { SubscriptionCatalog, SubscriptionPlanVersion, SubscriptionSnapshot } from "./types";
import { Button, PageHeader, Spinner } from "./ui";
import { clearSubscriptionPlanPreference, preferredSubscriptionPlan } from "./public-plans";
import { CompanySubscriptionUsagePanel } from "./CompanySubscriptionUsagePanel";
import { resolveSubscriptionPlanSelection } from "./subscription-usage";
import { RequestError, withinRequest } from "./request-scope";
import { SubscriptionChangeReviewDetails } from "./subscription-change-review";
import { createSubscriptionChangeAttempt, createSubscriptionChangeReview, rememberedSubscriptionChange, rememberSubscriptionChange, sendSubscriptionChange, subscriptionChangeFingerprint, subscriptionChangeOutcome, SUBSCRIPTION_CHANGE_READ_MS, type SubscriptionChangeRecord, type SubscriptionChangeReview } from "./subscription-change-safety";

type Notice = (message: string, tone?: "success" | "error") => void;

const moneyText = (value: string | null, currency: string, fallback: string) =>
  value === null ? fallback : `${value} ${currency}`;

export function CompanySubscriptionPage({ notify }: { notify: Notice }) {
  const { selectedCompany, user, permissionSet } = useAuthorization();
  if (!selectedCompany || !permissionSet.has("subscriptions.view")) return null;
  const scope = `${user.id}:${selectedCompany.id}:${permissionSet.has("subscriptions.manage")}`;
  return <CompanySubscriptionBody key={scope} notify={notify} companyId={selectedCompany.id} scope={`${user.id}:${selectedCompany.id}`} />;
}

function CompanySubscriptionBody({ notify, companyId, scope }: { notify: Notice; companyId: string; scope: string }) {
  const { formatDateTime, t } = useI18n();
  const { permissionSet } = useAuthorization();
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(null);
  const [catalog, setCatalog] = useState<SubscriptionCatalog>({ plans: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [optionalIds, setOptionalIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<SubscriptionChangeReview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [record, setRecord] = useState<SubscriptionChangeRecord | null>(() => rememberedSubscriptionChange(scope));
  const [readSucceeded, setReadSucceeded] = useState(false);
  const recordRef = useRef(record);
  const command = useRef<AbortController | null>(null);
  const read = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const reviewHeading = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectionMissing, setSelectionMissing] = useState(false);
  const selectionInitialized = useRef(false);
  const selectionRef = useRef("");
  const selectedDefinition = useRef("");
  const catalogPageRef = useRef(1);
  const catalogRequest = useRef(0);

  function saveRecord(next: SubscriptionChangeRecord | null) {
    recordRef.current = next;
    rememberSubscriptionChange(scope, next);
    if (mounted.current) setRecord(next);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++catalogRequest.current;
      read.current?.abort();
      if (command.current && recordRef.current?.status === "sending") {
        rememberSubscriptionChange(scope, { ...recordRef.current, status: "uncertain" });
      }
      command.current?.abort();
    };
  }, [scope]);

  useEffect(() => {
    if (!review) return;
    const section = reviewHeading.current?.querySelector<HTMLElement>("section");
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: "start" });
  }, [review]);

  const applyCatalog = useCallback((nextCatalog: SubscriptionCatalog) => {
    setReview(null); setAcknowledged(false);
    const candidate = selectionInitialized.current ? selectionRef.current : preferredSubscriptionPlan() ?? "";
    const resolved = resolveSubscriptionPlanSelection(nextCatalog.plans.map((plan) => plan.id), candidate, !selectionInitialized.current);
    const definition = JSON.stringify(nextCatalog.plans.find(plan => plan.id === resolved.selectedId) ?? null);
    if (resolved.selectedId !== selectionRef.current || resolved.missing || (selectedDefinition.current && selectedDefinition.current !== definition)) setOptionalIds([]);
    selectedDefinition.current = definition;
    if (resolved.missing) setSelectionMissing(true);
    // Once a choice is missing, another page never selects a replacement (or restores it) implicitly.
    selectionInitialized.current = true;
    selectionRef.current = resolved.selectedId;
    setSelectedPlanId(resolved.selectedId);
    setCatalog(nextCatalog);
    catalogPageRef.current = nextCatalog.meta.page;
  }, []);

  const load = useCallback(async () => {
    const requestId = ++catalogRequest.current;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setCatalogLoading(true);
    setReadSucceeded(false);
    setError("");
    try {
      const [nextSnapshot, nextCatalog] = await withinRequest(signal => Promise.all([
        api<SubscriptionSnapshot>("/subscription?page=1&pageSize=20", { signal }),
        api<SubscriptionCatalog>(`/subscription/catalog?page=${catalogPageRef.current}&pageSize=100`, { signal }),
      ]), { signal: controller.signal, timeoutMs: SUBSCRIPTION_CHANGE_READ_MS });
      if (!mounted.current || controller.signal.aborted || requestId !== catalogRequest.current) return false;
      if (nextSnapshot.company && nextSnapshot.company.id !== companyId) throw new RequestError("response");
      setSnapshot(nextSnapshot);
      applyCatalog(nextCatalog);
      setReadSucceeded(true);
      return true;
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && requestId === catalogRequest.current) setError(t("subscriptionChanges.readFailed"));
      return false;
    } finally {
      if (mounted.current && requestId === catalogRequest.current) { setLoading(false); setCatalogLoading(false); }
    }
  }, [applyCatalog, companyId, t]);

  async function pageCatalog(page: number) {
    if (command.current || recordRef.current) return;
    const requestId = ++catalogRequest.current;
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    setReview(null); setAcknowledged(false);
    setCatalogLoading(true); setError("");
    try {
      const result = await api<SubscriptionCatalog>(`/subscription/catalog?page=${page}&pageSize=100`, { signal: controller.signal, timeoutMs: SUBSCRIPTION_CHANGE_READ_MS });
      if (mounted.current && !controller.signal.aborted && requestId === catalogRequest.current) applyCatalog(result);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && requestId === catalogRequest.current) setError(t("subscriptionChanges.readFailed"));
    } finally {
      if (mounted.current && requestId === catalogRequest.current) setCatalogLoading(false);
    }
  }

  useEffect(() => { void load(); }, [load]);

  const selectedPlan = useMemo(
    () => catalog.plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [catalog.plans, selectedPlanId],
  );
  const optionalModules = selectedPlan?.modules.filter((module) => module.selectionMode === "OPTIONAL" && module.active) ?? [];

  function selectPlan(id: string) {
    if (command.current || recordRef.current) return;
    setReview(null); setAcknowledged(false);
    selectionRef.current = id;
    selectedDefinition.current = JSON.stringify(catalog.plans.find(plan => plan.id === id) ?? null);
    setSelectionMissing(false);
    setSelectedPlanId(id);
    setOptionalIds([]);
  }

  function toggleOptional(id: string) {
    if (!selectedPlan || command.current || recordRef.current) return;
    setReview(null); setAcknowledged(false);
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

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !selectedPlan || catalogLoading || command.current || recordRef.current || !permissionSet.has("subscriptions.manage")) return;
    setAcknowledged(false);
    setReview(createSubscriptionChangeReview(selectedPlan, optionalIds, snapshot.subscription.version));
  }

  async function confirm(sameAttempt = false) {
    if (command.current || catalogLoading || !permissionSet.has("subscriptions.manage")) return;
    const previous = recordRef.current;
    if (sameAttempt ? previous?.status !== "uncertain" : Boolean(previous)) return;
    if (!sameAttempt && (!review || !acknowledged || !snapshot || !selectedPlan
      || review.fingerprint !== subscriptionChangeFingerprint(selectedPlan, optionalIds, snapshot.subscription.version))) {
      setReview(null); setAcknowledged(false); return;
    }
    const attempt = sameAttempt ? previous!.attempt : createSubscriptionChangeAttempt(review!);
    const controller = new AbortController();
    command.current = controller; // synchronous lock, before React's next render
    saveRecord({ attempt, status: "sending" });
    setSaving(true);
    setReadSucceeded(false);
    setError("");
    try {
      const result = await sendSubscriptionChange(attempt, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      saveRecord({ attempt, status: "succeeded", result });
      notify(t(result === "PENDING_APPROVAL" ? "subscriptionChanges.pending" : "subscriptionChanges.succeeded"));
      clearSubscriptionPlanPreference();
      await load();
    } catch (cause) {
      if (mounted.current) saveRecord({ attempt, status: subscriptionChangeOutcome(cause) });
    } finally {
      if (mounted.current && command.current === controller) { command.current = null; setSaving(false); }
    }
  }

  if (loading) return <Spinner label={t("subscription.loading")} />;
  if (!snapshot) return (
    <section className="workspace-page subscription-page">
      <PageHeader kicker={t("subscription.kicker")} title={t("subscription.title")} description={t("subscription.description")} />
      <div className="error-panel" role="alert"><h3>{t("subscription.errorTitle")}</h3><p>{error || t("subscription.loadError")}</p><Button onClick={() => void load()}>{t("common.retry")}</Button></div>
      <CompanySubscriptionUsagePanel />
    </section>
  );

  const current = snapshot.current;
  return (
    <section className="workspace-page subscription-page">
      <PageHeader
        kicker={t("subscription.kicker")}
        title={t("subscription.title")}
        description={t("subscription.description")}
        actions={<Button variant="secondary" disabled={saving || catalogLoading} onClick={() => void load()}>{t("common.refresh")}</Button>}
      />
      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="subscription-summary-grid">
        <article className="metric-card"><span>{t("subscription.currentPlan")}</span><strong>{current.plan.displayName}</strong><small>{current.plan.planCode} · {t("subscription.versionLabel", { value1: current.plan.versionNumber })}</small></article>
        <article className="metric-card"><span>{t("subscription.status")}</span><strong>{t(`subscription.status.${snapshot.subscription.status}`)}</strong><small>{snapshot.subscription.trialEndsAt ? t("subscription.trialUntil", { value1: formatDateTime(snapshot.subscription.trialEndsAt) }) : t("subscription.noTrial")}</small></article>
        <article className="metric-card"><span>{t("subscription.recurringFee")}</span><strong>{moneyText(current.quote.totalRecurringFee, current.quote.currencyCode, t("subscription.unpriced"))}</strong><small>{t(`subscription.cycle.${current.plan.billingCycle}`)}</small></article>
      </div>

      <CompanySubscriptionUsagePanel key={current.plan.id} />
        <section className="panel subscription-panel">
          <header><div><h2>{t("subscription.modules")}</h2><p>{t("subscription.modulesDescription")}</p></div></header>
          {snapshot.effectiveModules.length ? <ul className="subscription-module-list">{snapshot.effectiveModules.map((module) => <li key={module.id}><strong>{module.displayName}</strong><small>{module.code}</small></li>)}</ul>
            : <div className="empty-state"><h3>{t("subscription.noModules")}</h3><p>{t("subscription.noModulesDescription")}</p></div>}
        </section>

      {([{ change: snapshot.pending, pending: true }, { change: snapshot.scheduled, pending: false }]).map(({ change, pending }) => change && <section key={pending ? "pending" : "scheduled"} className="panel subscription-panel subscription-attention">
        <header><div><h2>{pending ? t("subscription.pendingChange") : t("subscription.scheduledChange")}</h2><p>{pending ? t("subscription.pendingPaymentSafe") : t("subscription.effectiveOn", { value1: change.effectiveAt ? formatDateTime(change.effectiveAt) : "—" })}</p></div></header>
        <div className="subscription-change-card">
          <strong>{change.plan.displayName}</strong>
          <span>{moneyText(change.quote.totalRecurringFee, change.quote.currencyCode, t("subscription.unpriced"))}</span>
        </div>
      </section>)}

      <Can policy={{ permission: "subscriptions.manage" }}>
        <form className="panel subscription-panel subscription-change-form" onSubmit={submit}>
          <header><div><h2>{t("subscription.choosePlan")}</h2><p>{t("subscription.choosePlanDescription")}</p></div></header>
          {selectionMissing && <p className="subscription-catalog-notice" role="status">{t("subscriptionUsage.selectionMissing")}</p>}
          {catalog.plans.length ? <div className="subscription-form-body">
            <label><span>{t("subscription.plan")}</span><select disabled={catalogLoading || saving || Boolean(record)} value={selectedPlanId} onChange={(event) => selectPlan(event.target.value)}><option value="">{t("subscriptionUsage.selectPlan")}</option>{catalog.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.displayName} — {moneyText(plan.recurringFee, plan.currencyCode, t("subscription.unpriced"))}</option>)}</select></label>
            {selectedPlan && <PlanPreview plan={selectedPlan} t={t} />}
            {optionalModules.length > 0 && <fieldset disabled={catalogLoading || saving || Boolean(record)}><legend>{t("subscription.optionalModules")}</legend><div className="subscription-option-grid">{optionalModules.map((module) => <label key={module.id}><input type="checkbox" checked={optionalIds.includes(module.id)} onChange={() => toggleOptional(module.id)} /><span><strong>{module.displayName}</strong><small>{moneyText(module.additionalRecurringFee, selectedPlan!.currencyCode, t("subscriptionChanges.notConfigured"))}</small></span></label>)}</div></fieldset>}
            <div className="subscription-safe-note">{t("subscription.paymentSafety")}</div>
            {!record && <Button type="submit" disabled={!selectedPlan || saving || catalogLoading}>{t("subscriptionChanges.review")}</Button>}
          </div> : <div className="empty-state"><h3>{t("subscription.noPlans")}</h3><p>{t("subscription.noPlansDescription")}</p></div>}
          {catalog.meta.totalPages > 1 && <div className="pagination subscription-catalog-pagination">
            <Button type="button" variant="ghost" disabled={catalogLoading || saving || Boolean(record) || catalog.meta.page <= 1} onClick={() => void pageCatalog(catalog.meta.page - 1)}>{t("common.previous")}</Button>
            <span>{t("subscriptionUsage.catalogPage", { value1: catalog.meta.page, value2: catalog.meta.totalPages })}</span>
            <Button type="button" variant="ghost" disabled={catalogLoading || saving || Boolean(record) || catalog.meta.page >= catalog.meta.totalPages} onClick={() => void pageCatalog(catalog.meta.page + 1)}>{t("common.next")}</Button>
          </div>}
          {(review || record) && <div ref={reviewHeading}>
            <SubscriptionChangeReviewDetails review={record?.attempt.review ?? review!} />
            {(snapshot.pending || snapshot.scheduled) && <p>{t("subscriptionChanges.existingChange")}</p>}
            {!record && <>
              <label className="subscription-change-confirmation"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>{t("subscriptionChanges.acknowledge")}</span></label>
              <div className="subscription-change-actions"><Button type="button" disabled={!acknowledged || catalogLoading} onClick={() => void confirm()}>{t("subscriptionChanges.confirm")}</Button><Button type="button" variant="secondary" onClick={() => { setReview(null); setAcknowledged(false); }}>{t("subscriptionChanges.edit")}</Button></div>
            </>}
          </div>}
          {record && <div className="subscription-change-recovery" role="status" aria-live="polite">
            <p>{t(record.status === "sending" ? "subscriptionChanges.waiting" : record.status === "succeeded" ? record.result === "PENDING_APPROVAL" ? "subscriptionChanges.pending" : "subscriptionChanges.succeeded" : `subscriptionChanges.${record.status}`)}</p>
            {record.status === "uncertain" && <p>{t("subscriptionChanges.memoryLimit")}</p>}
            {record.status === "succeeded" && error && <p>{t("subscriptionChanges.reloadFailed")}</p>}
            <div className="subscription-change-actions">
              {record.status === "sending" && <Button type="button" variant="secondary" onClick={() => command.current?.abort()}>{t("subscriptionChanges.cancelWait")}</Button>}
              {record.status !== "sending" && <Button type="button" variant="secondary" disabled={saving || catalogLoading} onClick={() => void load()}>{t("subscriptionChanges.refreshOnly")}</Button>}
              {record.status === "uncertain" && <Button type="button" disabled={saving || catalogLoading} onClick={() => void confirm(true)}>{t("subscriptionChanges.retrySame")}</Button>}
              {record.status !== "sending" && record.status !== "uncertain" && <Button type="button" disabled={saving || catalogLoading || !readSucceeded} onClick={() => { saveRecord(null); setReview(null); setAcknowledged(false); }}>{t("subscriptionChanges.newReview")}</Button>}
            </div>
          </div>}
        </form>
      </Can>

      <SubscriptionBillingCenter notify={notify} />

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
