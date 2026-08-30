import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, idempotencyKey } from "./api";
import { useI18n } from "./i18n";
import type { PageMeta, SubscriptionPlanVersion, SubscriptionSnapshot } from "./types";
import { Button, PageHeader, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type CatalogModule = { id: string; code: string; displayName: string; active: boolean; dependencies: Array<{ id: string; code: string; active: boolean }> };
type PlanRow = { id: string; code: string; active: boolean; version: number; latestVersion: SubscriptionPlanVersion | null; updatedAt: string };
type PlanDetail = { id: string; code: string; active: boolean; version: number; versions: SubscriptionPlanVersion[] };
type SubscriptionRow = { company: { id: string; code: string; name: string; active: boolean }; status: string; version: number; recordedPlan: { displayName: string; code: string }; updatedAt: string };

const emptyMeta: PageMeta = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
const localDateTime = () => {
  const date = new Date(Date.now() + 5 * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const localDateTimeFrom = (value: string) => {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const optionalMoney = (value: string) => value.trim() === "" ? null : value.trim();
const optionalLimit = (value: string) => value.trim() === "" ? null : Number(value);

function availableCatalogModuleIds(modules: CatalogModule[]) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const resolved = new Map<string, boolean>();
  const visiting = new Set<string>();
  const available = (id: string): boolean => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    const module = byId.get(id);
    if (!module?.active || visiting.has(id)) return false;
    visiting.add(id);
    const valid = module.dependencies.every((dependency) => dependency.active && available(dependency.id));
    visiting.delete(id);
    resolved.set(id, valid);
    return valid;
  };
  return new Set(modules.filter((module) => available(module.id)).map((module) => module.id));
}

function catalogClosure(modules: CatalogModule[], roots: string[]) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const available = availableCatalogModuleIds(modules);
  if (roots.some((id) => !available.has(id))) return new Set<string>();
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    byId.get(id)?.dependencies.forEach((dependency) => visit(dependency.id));
    result.add(id);
  };
  roots.forEach(visit);
  return result;
}

function removableCatalogModules(modules: CatalogModule[], selected: Set<string>, root: string) {
  const removed = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of modules) {
      if (selected.has(module.id) && !removed.has(module.id)
        && module.dependencies.some((dependency) => removed.has(dependency.id))) {
        removed.add(module.id); changed = true;
      }
    }
  }
  return removed;
}

function toggleOptionalClosure(plan: SubscriptionPlanVersion, current: string[], id: string) {
  const selected = new Set(current);
  if (!selected.has(id)) {
    const byId = new Map(plan.modules.map((module) => [module.id, module]));
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
      for (const module of plan.modules) {
        if (module.selectionMode === "OPTIONAL" && selected.has(module.id) && !removed.has(module.id)
          && module.dependencyIds.some((dependencyId) => removed.has(dependencyId))) {
          removed.add(module.id); changed = true;
        }
      }
    }
    removed.forEach((moduleId) => selected.delete(moduleId));
  }
  return [...selected];
}

export function PlatformSubscriptionsPage({ notify }: { notify: Notice }) {
  const { formatDateTime, t } = useI18n();
  const [tab, setTab] = useState<"plans" | "subscriptions">("plans");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [planMeta, setPlanMeta] = useState(emptyMeta);
  const [modules, setModules] = useState<CatalogModule[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [subscriptionMeta, setSubscriptionMeta] = useState(emptyMeta);
  const [selectedPlan, setSelectedPlan] = useState<PlanDetail | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<SubscriptionSnapshot | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const loadPlans = useCallback(async (page = 1, term = "") => {
    const response = await api<{ plans: PlanRow[]; meta: PageMeta }>(`/platform/subscription-plans?page=${page}&pageSize=20&search=${encodeURIComponent(term)}&active=ALL&publicationStatus=ALL`);
    setPlans(response.plans); setPlanMeta(response.meta);
  }, []);
  const loadSubscriptions = useCallback(async (page = 1, term = "") => {
    const response = await api<{ subscriptions: SubscriptionRow[]; meta: PageMeta }>(`/platform/subscriptions?page=${page}&pageSize=20&search=${encodeURIComponent(term)}&status=ALL`);
    setSubscriptions(response.subscriptions); setSubscriptionMeta(response.meta);
  }, []);
  const loadInitial = useCallback(async () => {
    setError("");
    try {
      const [moduleResponse] = await Promise.all([
        api<{ modules: CatalogModule[] }>("/platform/subscription-modules"),
        loadPlans(), loadSubscriptions(),
      ]);
      setModules(moduleResponse.modules);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("platformSubscriptions.loadError"));
    } finally { setLoading(false); }
  }, [loadPlans, loadSubscriptions, t]);
  useEffect(() => { void loadInitial(); }, [loadInitial]);

  async function openPlan(id: string) {
    setBusy(true); setError("");
    try { setSelectedPlan((await api<{ plan: PlanDetail }>(`/platform/subscription-plans/${id}`)).plan); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.loadError")); }
    finally { setBusy(false); }
  }
  async function openCompany(id: string) {
    setBusy(true); setError("");
    try { setSelectedCompany(await api<SubscriptionSnapshot>(`/platform/companies/${id}/subscription?page=1&pageSize=20`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.loadError")); }
    finally { setBusy(false); }
  }
  async function refreshSelectedPlan() {
    if (!selectedPlan) return;
    await openPlan(selectedPlan.id); await loadPlans(planMeta.page, appliedSearch);
  }
  async function updatePlanStatus() {
    if (!selectedPlan) return;
    setBusy(true);
    try {
      await api(`/platform/subscription-plans/${selectedPlan.id}`, { method: "PATCH", body: JSON.stringify({ active: !selectedPlan.active, version: selectedPlan.version }) });
      notify(t("platformSubscriptions.planStatusSaved")); await refreshSelectedPlan();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.saveError")); }
    finally { setBusy(false); }
  }
  async function createNextDraft() {
    if (!selectedPlan) return;
    setBusy(true);
    try {
      await api(`/platform/subscription-plans/${selectedPlan.id}/versions`, { method: "POST" });
      notify(t("platformSubscriptions.draftCreated")); await refreshSelectedPlan();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.saveError")); }
    finally { setBusy(false); }
  }
  async function publish(version: SubscriptionPlanVersion) {
    setBusy(true);
    try {
      await api(`/platform/subscription-plan-versions/${version.id}/publish`, { method: "POST", body: JSON.stringify({ version: version.version }) });
      notify(t("platformSubscriptions.published")); await refreshSelectedPlan();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.publishError")); }
    finally { setBusy(false); }
  }
  async function searchNow(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    setAppliedSearch(search);
    try { if (tab === "plans") await loadPlans(1, search); else await loadSubscriptions(1, search); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.loadError")); }
    finally { setLoading(false); }
  }

  if (loading) return <Spinner label={t("platformSubscriptions.loading")} />;
  return <section className="workspace-page platform-subscriptions-page">
    <PageHeader kicker={t("platformSubscriptions.kicker")} title={t("platformSubscriptions.title")} description={t("platformSubscriptions.description")} actions={<Button onClick={() => setShowCreate(true)} icon="plus">{t("platformSubscriptions.createPlan")}</Button>} />
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="subscription-admin-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "plans"} className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}>{t("platformSubscriptions.plans")}</button>
      <button type="button" role="tab" aria-selected={tab === "subscriptions"} className={tab === "subscriptions" ? "active" : ""} onClick={() => setTab("subscriptions")}>{t("platformSubscriptions.subscriptions")}</button>
    </div>
    <form className="toolbar" onSubmit={searchNow}><label className="search-field"><span>{t("common.search")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><Button type="submit" variant="secondary">{t("common.search")}</Button></form>
    {tab === "plans" ? <div className="subscription-admin-layout">
      <section className="panel platform-list-panel"><header><div><h2>{t("platformSubscriptions.catalog")}</h2><p>{t("platformSubscriptions.catalogDescription")}</p></div><span>{planMeta.total}</span></header>
        {plans.length ? <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("platformSubscriptions.plan")}</th><th>{t("platformSubscriptions.publication")}</th><th>{t("platformSubscriptions.updated")}</th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id} onClick={() => void openPlan(plan.id)} className={selectedPlan?.id === plan.id ? "selected-row" : ""}><td><strong>{plan.latestVersion?.displayName ?? plan.code}</strong><small>{plan.code} · {plan.active ? t("common.active") : t("common.inactive")}</small></td><td>{plan.latestVersion ? t(`platformSubscriptions.publication.${plan.latestVersion.publicationStatus}` as never) : "—"}</td><td>{formatDateTime(plan.updatedAt)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>{t("platformSubscriptions.noPlans")}</h3><p>{t("platformSubscriptions.noPlansDescription")}</p></div>}
        <Pager meta={planMeta} onPage={(page) => void loadPlans(page, appliedSearch)} t={t} />
      </section>
      <section className="panel subscription-admin-detail">{busy ? <Spinner /> : selectedPlan ? <PlanEditor plan={selectedPlan} modules={modules} busy={busy} t={t} onSaved={refreshSelectedPlan} onPublish={publish} onToggle={updatePlanStatus} onNewDraft={createNextDraft} /> : <div className="empty-state"><h3>{t("platformSubscriptions.selectPlan")}</h3><p>{t("platformSubscriptions.selectPlanDescription")}</p></div>}</section>
    </div> : <div className="subscription-admin-layout">
      <section className="panel platform-list-panel"><header><div><h2>{t("platformSubscriptions.companySubscriptions")}</h2><p>{t("platformSubscriptions.companySubscriptionsDescription")}</p></div><span>{subscriptionMeta.total}</span></header>
        {subscriptions.length ? <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("platformSubscriptions.company")}</th><th>{t("subscription.status")}</th><th>{t("subscription.currentPlan")}</th></tr></thead><tbody>{subscriptions.map((item) => <tr key={item.company.id} onClick={() => void openCompany(item.company.id)} className={selectedCompany?.company?.id === item.company.id ? "selected-row" : ""}><td>{item.company.name}<small>{item.company.code}</small></td><td>{item.status}</td><td>{item.recordedPlan.displayName}</td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>{t("platformSubscriptions.noSubscriptions")}</h3><p>{t("platformSubscriptions.noSubscriptionsDescription")}</p></div>}
        <Pager meta={subscriptionMeta} onPage={(page) => void loadSubscriptions(page, appliedSearch)} t={t} />
      </section>
      <section className="panel subscription-admin-detail">{busy ? <Spinner /> : selectedCompany ? <CompanyLifecycle snapshot={selectedCompany} publishedVersions={selectedPlan?.versions.filter((version) => version.publicationStatus === "PUBLISHED") ?? []} t={t} notify={notify} reload={() => openCompany(selectedCompany.company!.id)} /> : <div className="empty-state"><h3>{t("platformSubscriptions.selectCompany")}</h3><p>{t("platformSubscriptions.selectCompanyDescription")}</p></div>}</section>
    </div>}
    {showCreate && <CreatePlan modules={modules} t={t} onClose={() => setShowCreate(false)} onCreated={async (id) => { setShowCreate(false); await loadPlans(1, appliedSearch); await openPlan(id); notify(t("platformSubscriptions.created")); }} />}
  </section>;
}

function PlanEditor({ plan, modules, busy, t, onSaved, onPublish, onToggle, onNewDraft }: { plan: PlanDetail; modules: CatalogModule[]; busy: boolean; t: ReturnType<typeof useI18n>["t"]; onSaved: () => Promise<void>; onPublish: (version: SubscriptionPlanVersion) => Promise<void>; onToggle: () => Promise<void>; onNewDraft: () => Promise<void> }) {
  const draft = plan.versions.find((version) => version.publicationStatus === "DRAFT");
  return <><header><div><h2>{plan.code}</h2><p>{plan.active ? t("common.active") : t("common.inactive")}</p></div><div className="row-actions"><Button variant="secondary" disabled={busy} onClick={() => void onToggle()}>{plan.active ? t("common.deactivate") : t("common.activate")}</Button>{!draft && <Button disabled={busy} onClick={() => void onNewDraft()}>{t("platformSubscriptions.newVersion")}</Button>}</div></header>
    {draft ? <DraftForm key={draft.id} draft={draft} modules={modules} t={t} onSaved={onSaved} onPublish={onPublish} /> : <div className="subscription-version-list">{plan.versions.map((version) => <article key={version.id}><strong>{version.displayName} · {t("subscription.versionLabel", { value1: version.versionNumber })}</strong><span>{t("platformSubscriptions.publishedImmutable")}</span></article>)}</div>}
  </>;
}

function DraftForm({ draft, modules, t, onSaved, onPublish }: { draft: SubscriptionPlanVersion; modules: CatalogModule[]; t: ReturnType<typeof useI18n>["t"]; onSaved: () => Promise<void>; onPublish: (version: SubscriptionPlanVersion) => Promise<void> }) {
  const [value, setValue] = useState(() => draftToForm(draft));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = new Set(value.modules.map((module) => module.moduleId));
  const availableModuleIds = useMemo(() => availableCatalogModuleIds(modules), [modules]);
  function set(key: string, next: string) { setValue((current) => ({ ...current, [key]: next })); }
  function toggle(module: CatalogModule) {
    setValue((current) => {
      const currentIds = new Set(current.modules.map((item) => item.moduleId));
      if (currentIds.has(module.id)) {
        const removed = removableCatalogModules(modules, currentIds, module.id);
        return { ...current, modules: current.modules.filter((item) => !removed.has(item.moduleId)) };
      }
      const closure = catalogClosure(modules, [module.id]);
      return { ...current, modules: [
        ...current.modules,
        ...[...closure].filter((id) => !currentIds.has(id)).map((moduleId) => ({
          moduleId, selectionMode: "INCLUDED" as const, additionalRecurringFee: null,
        })),
      ] };
    });
  }
  function configureModule(moduleId: string, selectionMode: "INCLUDED" | "OPTIONAL", additionalRecurringFee?: string) {
    setValue((current) => ({ ...current, modules: current.modules.map((item) => item.moduleId === moduleId
      ? { ...item, selectionMode, additionalRecurringFee: selectionMode === "INCLUDED" ? null : (additionalRecurringFee ?? item.additionalRecurringFee ?? "0.0000") }
      : item) }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await api(`/platform/subscription-plan-versions/${draft.id}`, { method: "PUT", body: JSON.stringify(formPayload(value, draft.version)) }); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.saveError")); }
    finally { setSaving(false); }
  }
  return <form className="subscription-draft-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid">
    <label><span>{t("platformSubscriptions.name")}</span><input value={value.displayName} onChange={(event) => set("displayName", event.target.value)} required /></label>
    <label><span>{t("platformSubscriptions.currency")}</span><input dir="ltr" value={value.currencyCode} onChange={(event) => set("currencyCode", event.target.value.toUpperCase())} required /></label>
    <label><span>{t("platformSubscriptions.billingCycle")}</span><select value={value.billingCycle} onChange={(event) => set("billingCycle", event.target.value)}><option value="MONTHLY">{t("subscription.cycle.MONTHLY")}</option><option value="QUARTERLY">{t("subscription.cycle.QUARTERLY")}</option><option value="ANNUAL">{t("subscription.cycle.ANNUAL")}</option></select></label>
    <label><span>{t("platformSubscriptions.recurringFee")}</span><input dir="ltr" value={value.recurringFee} placeholder={t("subscription.unpriced")} onChange={(event) => set("recurringFee", event.target.value)} /></label>
    <label><span>{t("subscription.users")}</span><input dir="ltr" type="number" min="0" value={value.includedUsers} onChange={(event) => set("includedUsers", event.target.value)} /></label>
    <label><span>{t("platformSubscriptions.extraUserPrice")}</span><input dir="ltr" value={value.pricePerAdditionalUser} placeholder={t("subscription.notConfigured")} onChange={(event) => set("pricePerAdditionalUser", event.target.value)} /></label>
    <label><span>{t("subscription.employees")}</span><input dir="ltr" type="number" min="0" value={value.includedEmployees} onChange={(event) => set("includedEmployees", event.target.value)} /></label>
    <label><span>{t("platformSubscriptions.extraEmployeePrice")}</span><input dir="ltr" value={value.pricePerAdditionalEmployee} placeholder={t("subscription.notConfigured")} onChange={(event) => set("pricePerAdditionalEmployee", event.target.value)} /></label>
    <label><span>{t("subscription.documents")}</span><input dir="ltr" type="number" min="0" value={value.includedPostedDocuments} onChange={(event) => set("includedPostedDocuments", event.target.value)} /></label>
    <label><span>{t("platformSubscriptions.extraDocumentPrice")}</span><input dir="ltr" value={value.pricePerAdditionalPostedDocument} placeholder={t("subscription.notConfigured")} onChange={(event) => set("pricePerAdditionalPostedDocument", event.target.value)} /></label>
    <label><span>{t("platformSubscriptions.taxRate")}</span><input dir="ltr" value={value.taxRate} onChange={(event) => set("taxRate", event.target.value)} required /></label>
    <label><span>{t("platformSubscriptions.paymentTerms")}</span><input dir="ltr" type="number" min="0" max="365" value={value.paymentTermsDays} onChange={(event) => set("paymentTermsDays", event.target.value)} required /></label>
    <label><span>{t("platformSubscriptions.trialDays")}</span><input dir="ltr" type="number" min="0" max="365" value={value.trialDays} onChange={(event) => set("trialDays", event.target.value)} /></label>
    <label><span>{t("platformSubscriptions.effectiveFrom")}</span><input type="datetime-local" value={value.effectiveFrom} onChange={(event) => set("effectiveFrom", event.target.value)} required /></label>
    <label><span>{t("platformSubscriptions.selfService")}</span><select value={value.selfServicePolicy} onChange={(event) => set("selfServicePolicy", event.target.value)}><option value="DISABLED">{t("subscription.policy.DISABLED")}</option><option value="REQUEST_ONLY">{t("subscription.policy.REQUEST_ONLY")}</option><option value="IMMEDIATE_FREE">{t("subscription.policy.IMMEDIATE_FREE")}</option></select></label>
  </div><label><span>{t("platformSubscriptions.descriptionLabel")}</span><textarea value={value.description} onChange={(event) => set("description", event.target.value)} /></label>
  <fieldset><legend>{t("subscription.modules")}</legend><div className="subscription-module-config-grid">{modules.filter((module) => availableModuleIds.has(module.id)).map((module) => {
    const configured = value.modules.find((item) => item.moduleId === module.id);
    const includedDependent = value.modules.some((item) => item.selectionMode === "INCLUDED" && modules.find((candidate) => candidate.id === item.moduleId)?.dependencies.some((dependency) => dependency.id === module.id));
    return <article key={module.id} className={configured ? "selected" : ""}><label><input type="checkbox" checked={selected.has(module.id)} onChange={() => toggle(module)} /><span><strong>{module.displayName}</strong><small>{module.dependencies.length ? `${t("platformSubscriptions.dependsOn")}: ${module.dependencies.map((item) => item.code).join(", ")}` : module.code}</small></span></label>{configured && <div className="module-price-controls"><select aria-label={t("platformSubscriptions.moduleMode")} value={configured.selectionMode} onChange={(event) => configureModule(module.id, event.target.value as "INCLUDED" | "OPTIONAL")}><option value="INCLUDED">{t("platformSubscriptions.includedModule")}</option><option value="OPTIONAL" disabled={includedDependent}>{t("platformSubscriptions.optionalModule")}</option></select>{configured.selectionMode === "OPTIONAL" && <input aria-label={t("platformSubscriptions.optionalModulePrice")} dir="ltr" value={configured.additionalRecurringFee ?? ""} onChange={(event) => configureModule(module.id, "OPTIONAL", event.target.value)} required />}</div>}</article>;
  })}</div></fieldset>
  <div className="row-actions"><Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button><Button variant="secondary" type="button" disabled={saving} onClick={() => void onPublish(draft)}>{t("platformSubscriptions.publish")}</Button></div></form>;
}

function CreatePlan({ modules, t, onClose, onCreated }: { modules: CatalogModule[]; t: ReturnType<typeof useI18n>["t"]; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { const result = await api<{ plan: { id: string } }>("/platform/subscription-plans", { method: "POST", body: JSON.stringify({ code: code.trim().toUpperCase(), displayName: name.trim(), description: null, billingCycle: "MONTHLY", currencyCode: "SAR", recurringFee: null, includedUsers: null, pricePerAdditionalUser: null, includedEmployees: null, pricePerAdditionalEmployee: null, includedPostedDocuments: null, pricePerAdditionalPostedDocument: null, taxRate: "0", paymentTermsDays: 0, trialDays: 0, effectiveFrom: new Date().toISOString(), selfServicePolicy: "DISABLED", modules: [] }) }); await onCreated(result.plan.id); } catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.saveError")); } finally { setSaving(false); } }
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-plan-title"><header><h2 id="create-plan-title">{t("platformSubscriptions.createPlan")}</h2><button type="button" onClick={onClose}>×</button></header><form onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<label><span>{t("platformSubscriptions.code")}</span><input dir="ltr" value={code} onChange={(event) => setCode(event.target.value)} pattern="[A-Z][A-Z0-9_]{1,79}" required /></label><label><span>{t("platformSubscriptions.name")}</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><p>{t("platformSubscriptions.createDraftNote", { value1: modules.filter((item) => item.active).length })}</p><div className="row-actions"><Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("common.create")}</Button></div></form></section></div>;
}

function CompanyLifecycle({ snapshot, publishedVersions, t, notify, reload }: { snapshot: SubscriptionSnapshot; publishedVersions: SubscriptionPlanVersion[]; t: ReturnType<typeof useI18n>["t"]; notify: Notice; reload: () => Promise<void> }) {
  const [versionId, setVersionId] = useState(publishedVersions[0]?.id ?? ""); const [optionalIds, setOptionalIds] = useState<string[]>([]); const [effectiveAt, setEffectiveAt] = useState(localDateTime()); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const selectedVersion = publishedVersions.find((version) => version.id === versionId);
  const optionalModules = selectedVersion?.modules.filter((module) => module.active && module.selectionMode === "OPTIONAL") ?? [];
  async function schedule(event: FormEvent) { event.preventDefault(); if (!versionId) return; setBusy(true); setError(""); try { await api(`/platform/companies/${snapshot.company!.id}/subscription-changes`, { method: "POST", idempotencyKey: idempotencyKey("operator-subscription-change", snapshot.company!.id), body: JSON.stringify({ targetPlanVersionId: versionId, optionalModuleIds: optionalIds, effectiveAt: new Date(effectiveAt).toISOString(), subscriptionVersion: snapshot.subscription.version }) }); notify(t("platformSubscriptions.changeScheduled")); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.saveError")); } finally { setBusy(false); } }
  async function decide(decision: "APPROVE" | "REJECT") { if (!snapshot.pending?.id) return; setBusy(true); setError(""); try { await api(`/platform/subscription-change-requests/${snapshot.pending.id}/decision`, { method: "POST", idempotencyKey: idempotencyKey("operator-subscription-decision", snapshot.pending.id), body: JSON.stringify({ decision, effectiveAt: decision === "APPROVE" ? new Date(effectiveAt).toISOString() : null, reason: decision === "REJECT" ? t("platformSubscriptions.rejectedReason") : null, subscriptionVersion: snapshot.subscription.version }) }); notify(t("platformSubscriptions.decisionSaved")); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("platformSubscriptions.saveError")); } finally { setBusy(false); } }
  return <><header><div><h2>{snapshot.company!.name}</h2><p>{snapshot.current.plan.displayName} · {t(`subscription.status.${snapshot.subscription.status}`)}</p></div></header><div className="subscription-admin-company">{error && <div className="form-error" role="alert">{error}</div>}<dl className="subscription-facts"><div><dt>{t("subscription.currentPlan")}</dt><dd>{snapshot.current.plan.displayName}</dd></div><div><dt>{t("subscription.modules")}</dt><dd>{snapshot.effectiveModules.length}</dd></div></dl>{snapshot.pending && <div className="subscription-safe-note"><strong>{t("subscription.pendingChange")}</strong><span>{snapshot.pending.plan.displayName} · {snapshot.pending.quote.totalRecurringFee} {snapshot.pending.quote.currencyCode}</span><div className="row-actions"><Button disabled={busy} onClick={() => void decide("APPROVE")}>{t("common.approve")}</Button><Button disabled={busy} variant="danger" onClick={() => void decide("REJECT")}>{t("common.reject")}</Button></div></div>}<form onSubmit={schedule}><label><span>{t("platformSubscriptions.targetVersion")}</span><select value={versionId} onChange={(event) => { setVersionId(event.target.value); setOptionalIds([]); }}><option value="">{t("platformSubscriptions.choosePublishedVersion")}</option>{publishedVersions.map((version) => <option key={version.id} value={version.id}>{version.displayName} · {t("subscription.versionLabel", { value1: version.versionNumber })}</option>)}</select></label>{selectedVersion && optionalModules.length > 0 && <fieldset><legend>{t("subscription.optionalModules")}</legend><div className="subscription-option-grid">{optionalModules.map((module) => <label key={module.id}><input type="checkbox" checked={optionalIds.includes(module.id)} onChange={() => setOptionalIds((current) => toggleOptionalClosure(selectedVersion, current, module.id))} /><span><strong>{module.displayName}</strong><small>{module.additionalRecurringFee} {selectedVersion.currencyCode}</small></span></label>)}</div></fieldset>}<label><span>{t("platformSubscriptions.effectiveAt")}</span><input type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label><Button type="submit" disabled={busy || !versionId}>{t("platformSubscriptions.schedule")}</Button><small>{publishedVersions.length ? t("platformSubscriptions.selectedCatalogHint") : t("platformSubscriptions.selectPlanFirst")}</small></form></div></>;
}

function draftToForm(draft: SubscriptionPlanVersion) { return { displayName: draft.displayName, description: draft.description ?? "", billingCycle: draft.billingCycle, currencyCode: draft.currencyCode, recurringFee: draft.recurringFee ?? "", includedUsers: draft.includedUsers?.toString() ?? "", pricePerAdditionalUser: draft.pricePerAdditionalUser ?? "", includedEmployees: draft.includedEmployees?.toString() ?? "", pricePerAdditionalEmployee: draft.pricePerAdditionalEmployee ?? "", includedPostedDocuments: draft.includedPostedDocuments?.toString() ?? "", pricePerAdditionalPostedDocument: draft.pricePerAdditionalPostedDocument ?? "", taxRate: draft.taxRate, paymentTermsDays: draft.paymentTermsDays.toString(), trialDays: draft.trialDays.toString(), effectiveFrom: localDateTimeFrom(draft.effectiveFrom), selfServicePolicy: draft.selfServicePolicy, modules: draft.modules.map((module) => ({ moduleId: module.id, selectionMode: module.selectionMode, additionalRecurringFee: module.additionalRecurringFee })) }; }
function formPayload(value: ReturnType<typeof draftToForm>, version: number) { return { displayName: value.displayName.trim(), description: value.description.trim() || null, billingCycle: value.billingCycle, currencyCode: value.currencyCode, recurringFee: optionalMoney(value.recurringFee), includedUsers: optionalLimit(value.includedUsers), pricePerAdditionalUser: optionalMoney(value.pricePerAdditionalUser), includedEmployees: optionalLimit(value.includedEmployees), pricePerAdditionalEmployee: optionalMoney(value.pricePerAdditionalEmployee), includedPostedDocuments: optionalLimit(value.includedPostedDocuments), pricePerAdditionalPostedDocument: optionalMoney(value.pricePerAdditionalPostedDocument), taxRate: value.taxRate.trim(), paymentTermsDays: Number(value.paymentTermsDays), trialDays: Number(value.trialDays), effectiveFrom: new Date(value.effectiveFrom).toISOString(), selfServicePolicy: value.selfServicePolicy, modules: value.modules, version }; }
function Pager({ meta, onPage, t }: { meta: PageMeta; onPage: (page: number) => void; t: ReturnType<typeof useI18n>["t"] }) { return <div className="pagination"><Button variant="ghost" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>{t("common.previous")}</Button><span>{meta.page} / {Math.max(meta.totalPages, 1)}</span><Button variant="ghost" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>{t("common.next")}</Button></div>; }
