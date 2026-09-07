import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAuthorization } from "./authorization-context";
import { useI18n } from "./i18n";
import { Button, EmptyState, Modal, PageHeader, Pagination, Spinner } from "./ui";
import { formatCurrencyDecimal } from "./decimal-format";
import { createCrmCommandSender } from "./crm-journey/command-sender";
import "./crm.css";

type Notice = (message: string, tone?: "success" | "error") => void;
type Owner = { id: string; employeeNumber: string; nameAr: string; nameEn: string | null };
type Lead = {
  id: string; code: string; kind: "INDIVIDUAL" | "ORGANIZATION"; displayName: string; status: "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED";
  owner: Owner | null; phone: string | null; email: string | null; version: number;
};
type Opportunity = {
  id: string; code: string; title: string; stage: "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST"; owner: Owner | null;
  estimatedAmount: string | null; currencyId: string | null; probabilityBps: number; expectedCloseDate: string | null; version: number;
};
type Activity = {
  id: string; parentType: "LEAD" | "OPPORTUNITY"; type: "CALL" | "MEETING" | "TASK" | "NOTE"; subject: string;
  assignee: Owner | null; scheduledFor: string | null; status: "OPEN" | "COMPLETED" | "CANCELLED"; version: number;
};
type Meta = { page: number; pageSize: number; total: number; totalPages: number };
type Options = {
  owners: Owner[];
  currencies: Array<{ id: string; code: string; nameAr: string; decimals: number }>;
  customers: Array<{ id: string; code: string; nameAr: string; nameEn: string | null }>;
};
type Pipeline = { stage: Opportunity["stage"]; currencyId: string | null; opportunityCount: number; estimatedAmount: string; weightedAmount: string };
type FormState = { kind: "lead" } | { kind: "qualify"; lead: Lead } | { kind: "convert"; lead: Lead } | { kind: "activity"; parentType: "LEAD" | "OPPORTUNITY"; parentId: string };
const blankMeta: Meta = { page: 1, pageSize: 8, total: 0, totalPages: 0 };

export function CrmPage({ notify }: { notify: Notice }) {
  const { selectedCompany, user, permissionSet } = useAuthorization();
  // A different identity or authorization must never inherit records or form drafts.
  return <CrmWorkspace key={JSON.stringify([user.id, selectedCompany?.id, [...permissionSet].sort()])} notify={notify} />;
}

function CrmWorkspace({ notify }: { notify: Notice }) {
  const { locale, intlLocale, t, formatNumber } = useI18n();
  const { permissionSet } = useAuthorization();
  const canManage = permissionSet.has("crm.manage");
  const canActivity = permissionSet.has("crm.activities.manage");
  const canConvert = permissionSet.has("crm.convert");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline[]>([]);
  const [options, setOptions] = useState<Options>({ owners: [], currencies: [], customers: [] });
  const [leadMeta, setLeadMeta] = useState<Meta>(blankMeta);
  const [opportunityMeta, setOpportunityMeta] = useState<Meta>(blankMeta);
  const [activityMeta, setActivityMeta] = useState<Meta>(blankMeta);
  const [leadPage, setLeadPage] = useState(1);
  const [opportunityPage, setOpportunityPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendCommand] = useState(createCrmCommandSender);

  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readRequest.current?.abort(); writeRequest.current?.abort(); };
  }, []);

  const load = useCallback(async () => {
    readRequest.current?.abort();
    const request = new AbortController();
    readRequest.current = request;
    const current = () => mounted.current && !request.signal.aborted && readRequest.current === request;
    setLoading(true);
    setError("");
    const searchQuery = submittedSearch ? `&search=${encodeURIComponent(submittedSearch)}` : "";
    try {
      const [leadResult, opportunityResult, activityResult, pipelineResult, optionResult] = await Promise.all([
        api<{ data: Lead[]; meta: Meta }>(`/crm/leads?page=${leadPage}&pageSize=8${searchQuery}`, { signal: request.signal }),
        api<{ data: Opportunity[]; meta: Meta }>(`/crm/opportunities?page=${opportunityPage}&pageSize=8${searchQuery}`, { signal: request.signal }),
        api<{ data: Activity[]; meta: Meta }>(`/crm/activities?page=${activityPage}&pageSize=8&status=OPEN`, { signal: request.signal }),
        api<{ data: Pipeline[] }>("/crm/pipeline", { signal: request.signal }),
        api<Options>("/crm/options", { signal: request.signal }),
      ]);
      if (!current()) return;
      setLeads(leadResult.data); setLeadMeta(leadResult.meta);
      setOpportunities(opportunityResult.data); setOpportunityMeta(opportunityResult.meta);
      setActivities(activityResult.data); setActivityMeta(activityResult.meta);
      setPipeline(pipelineResult.data); setOptions(optionResult);
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : t("crm.loadError"));
    } finally {
      if (current()) setLoading(false);
    }
  }, [activityPage, leadPage, opportunityPage, submittedSearch, t]);

  useEffect(() => { void load(); return () => readRequest.current?.abort(); }, [load]);
  const latestLoad = useRef(load);
  latestLoad.current = load;

  const amountLabel = (amount: string, id: string | null) => {
    const currency = options.currencies.find((item) => item.id === id);
    return currency ? formatCurrencyDecimal(amount, currency.code, intlLocale, { minimumFractionDigits: currency.decimals, maximumFractionDigits: Math.max(4, currency.decimals) }) : `${amount} —`;
  };
  const ownerName = (owner: Owner | null) => owner ? (locale === "en" && owner.nameEn ? owner.nameEn : owner.nameAr) : "—";
  const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value)) : "—";
  const submitSearch = (event: FormEvent) => { event.preventDefault(); if (writeRequest.current) return; setLeadPage(1); setOpportunityPage(1); setSubmittedSearch(search.trim()); };

  const mutate = async (permission: string, work: (signal: AbortSignal) => Promise<unknown>) => {
    if (!permissionSet.has(permission) || writeRequest.current || !mounted.current) return;
    const request = new AbortController();
    writeRequest.current = request;
    setBusy(true);
    try {
      await work(request.signal);
      if (!mounted.current || request.signal.aborted) return;
      setForm(null);
      notify(t("crm.saved"));
      await latestLoad.current();
    } catch (cause) {
      if (!mounted.current || request.signal.aborted) return;
      notify(cause instanceof Error ? cause.message : t("crm.saveError"), "error");
    } finally {
      if (writeRequest.current === request) writeRequest.current = null;
      if (mounted.current && !request.signal.aborted) setBusy(false);
    }
  };

  const markContacted = (lead: Lead) => void mutate("crm.manage", (signal) => sendCommand(`/crm/leads/${lead.id}/mark-contacted`, {
    method: "POST", signal, body: JSON.stringify({ version: lead.version }),
  }));
  const completeActivity = (activity: Activity) => void mutate("crm.activities.manage", (signal) => sendCommand(`/crm/activities/${activity.id}/complete`, {
    method: "POST", signal, body: JSON.stringify({ version: activity.version }),
  }));
  const moveStage = (opportunity: Opportunity, stage: Opportunity["stage"]) => {
    if (!canManage || stage === opportunity.stage || stage === "WON" || stage === "LOST") return;
    void mutate("crm.manage", (signal) => sendCommand(`/crm/opportunities/${opportunity.id}/stage`, {
      method: "POST", signal,
      body: JSON.stringify({ version: opportunity.version, stage, probabilityBps: opportunity.probabilityBps }),
    }));
  };

  return (
    <div className="workspace-page crm-page">
      <PageHeader kicker={t("crm.kicker")} title={t("crm.title")} description={t("crm.description")} actions={canManage ? <Button disabled={busy || loading || !!error} icon="plus" onClick={() => setForm({ kind: "lead" })}>{t("crm.newLead")}</Button> : undefined} />
      <aside className="crm-boundary-note" role="note">{t("crm.legalBlocked")}</aside>
      <form className="crm-search" role="search" onSubmit={submitSearch}>
        <label><span>{t("crm.search")}</span><input type="search" disabled={busy} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <Button disabled={busy} type="submit" variant="secondary" icon="search">{t("crm.searchAction")}</Button>
      </form>
      {submittedSearch && <p role="status">{t("crm.searchScope", { search: submittedSearch })}</p>}
      {busy && <p role="status">{t("crm.saving")}</p>}
      {error && <div className="alert error" role="alert">{error}<Button disabled={busy} variant="ghost" onClick={() => void load()}>{t("common.retry")}</Button></div>}
      {loading ? <div role="status"><Spinner /><span>{t("crm.loading")}</span></div> : !error && <>
        <section className="crm-section" aria-labelledby="crm-pipeline-title">
          <div className="crm-section-heading"><div><h2 id="crm-pipeline-title">{t("crm.pipeline")}</h2><p>{t("crm.pipelineDescription")}</p></div></div>
          <div className="crm-pipeline">
            {(["DISCOVERY", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const).map((stage) => {
              const rows = pipeline.filter((item) => item.stage === stage);
              const count = rows.reduce((sum, item) => sum + item.opportunityCount, 0);
              return <article key={stage} className={`crm-pipeline-card stage-${stage.toLowerCase()}`}>
                <div><strong>{t(`crm.stage.${stage}`)}</strong><span>{formatNumber(count)} {t("crm.count")}</span></div>
                {rows.length ? rows.map((row) => <p key={`${stage}-${row.currencyId ?? "none"}`}><b>{amountLabel(row.weightedAmount, row.currencyId)}</b> · {t("crm.weighted")}</p>) : <p>—</p>}
              </article>;
            })}
          </div>
        </section>

        <div className="crm-columns">
          <section className="crm-section" aria-labelledby="crm-leads-title">
            <div className="crm-section-heading"><div><h2 id="crm-leads-title">{t("crm.leads")}</h2><p>{formatNumber(leadMeta.total)} {t("common.results", { total: "" }).trim()}</p></div></div>
            {!leads.length ? <EmptyState title={t("crm.emptyLeads")} description={t(submittedSearch ? "crm.noSearchResults" : "crm.emptyLeadsDescription")} /> : <div className="crm-record-list">
              {leads.map((lead) => <article className="crm-record" key={lead.id}>
                <header><div><strong>{lead.displayName}</strong><span>{lead.code}</span></div><span className={`status-pill status-${lead.status.toLowerCase()}`}>{t(`crm.status.${lead.status}`)}</span></header>
                <dl><div><dt>{t("crm.owner")}</dt><dd>{ownerName(lead.owner)}</dd></div><div><dt>{t("crm.phone")}</dt><dd dir="ltr">{lead.phone ?? "—"}</dd></div></dl>
                <p className="crm-next-step">{t(`crm.next.${lead.status}`)}</p>
                <div className="crm-record-actions">
                  {canManage && lead.status === "NEW" && <Button disabled={busy} variant="secondary" onClick={() => markContacted(lead)}>{t("crm.markContacted")}</Button>}
                  {canManage && ["NEW", "CONTACTED"].includes(lead.status) && <Button disabled={busy} variant="secondary" onClick={() => setForm({ kind: "qualify", lead })}>{t("crm.qualify")}</Button>}
                  {canActivity && !["DISQUALIFIED", "CONVERTED"].includes(lead.status) && <Button disabled={busy} variant="ghost" onClick={() => setForm({ kind: "activity", parentType: "LEAD", parentId: lead.id })}>{t("crm.addActivity")}</Button>}
                  {canConvert && lead.status === "QUALIFIED" && <Button disabled={busy} onClick={() => setForm({ kind: "convert", lead })}>{t("crm.convert")}</Button>}
                </div>
              </article>)}
            </div>}
            <Pagination page={leadMeta.page} totalPages={leadMeta.totalPages} total={leadMeta.total} onChange={(page) => { if (!writeRequest.current) setLeadPage(page); }} />
          </section>

          <section className="crm-section" aria-labelledby="crm-opportunities-title">
            <div className="crm-section-heading"><div><h2 id="crm-opportunities-title">{t("crm.opportunities")}</h2><p>{formatNumber(opportunityMeta.total)} {t("crm.count")}</p></div></div>
            {!opportunities.length ? <EmptyState title={t("crm.emptyOpportunities")} description={t(submittedSearch ? "crm.noSearchResults" : "crm.emptyOpportunitiesDescription")} /> : <div className="crm-record-list">
              {opportunities.map((opportunity) => <article className="crm-record opportunity" key={opportunity.id}>
                <header><div><strong>{opportunity.title}</strong><span>{opportunity.code}</span></div><span className={`status-pill stage-${opportunity.stage.toLowerCase()}`}>{t(`crm.stage.${opportunity.stage}`)}</span></header>
                <dl><div><dt>{t("crm.owner")}</dt><dd>{ownerName(opportunity.owner)}</dd></div><div><dt>{t("crm.value")}</dt><dd>{opportunity.estimatedAmount ? amountLabel(opportunity.estimatedAmount, opportunity.currencyId) : "—"}</dd></div><div><dt>{t("crm.probability")}</dt><dd>{formatNumber(opportunity.probabilityBps / 100)}%</dd></div><div><dt>{t("crm.expectedClose")}</dt><dd>{dateLabel(opportunity.expectedCloseDate)}</dd></div></dl>
                <div className="crm-record-actions">
                  {canManage && !["WON", "LOST"].includes(opportunity.stage) && <label className="crm-stage-select"><span>{t("crm.stage")}</span><select disabled={busy} value={opportunity.stage} onChange={(event) => moveStage(opportunity, event.target.value as Opportunity["stage"])}><option value="DISCOVERY">{t("crm.stage.DISCOVERY")}</option><option value="PROPOSAL">{t("crm.stage.PROPOSAL")}</option><option value="NEGOTIATION">{t("crm.stage.NEGOTIATION")}</option></select></label>}
                  {canActivity && <Button disabled={busy} variant="ghost" onClick={() => setForm({ kind: "activity", parentType: "OPPORTUNITY", parentId: opportunity.id })}>{t("crm.addActivity")}</Button>}
                </div>
              </article>)}
            </div>}
            <Pagination page={opportunityMeta.page} totalPages={opportunityMeta.totalPages} total={opportunityMeta.total} onChange={(page) => { if (!writeRequest.current) setOpportunityPage(page); }} />
          </section>
        </div>

        <section className="crm-section" aria-labelledby="crm-activities-title">
          <div className="crm-section-heading"><div><h2 id="crm-activities-title">{t("crm.nextActions")}</h2><p>{formatNumber(activityMeta.total)} {t("crm.activities")}</p></div></div>
          {!activities.length ? <EmptyState title={t("crm.emptyActivities")} description={t("crm.emptyActivitiesDescription")} /> : <div className="crm-activity-grid">
            {activities.map((activity) => <article className="crm-activity" key={activity.id}><div><span className="status-pill">{t(`crm.activity.${activity.type}`)}</span><strong>{activity.subject}</strong><p>{ownerName(activity.assignee)} · {dateLabel(activity.scheduledFor)}</p></div>{canActivity && <Button disabled={busy} variant="secondary" onClick={() => completeActivity(activity)}>{t("crm.complete")}</Button>}</article>)}
          </div>}
          <Pagination page={activityMeta.page} totalPages={activityMeta.totalPages} total={activityMeta.total} onChange={(page) => { if (!writeRequest.current) setActivityPage(page); }} />
        </section>
      </>}
      {form?.kind === "lead" && <LeadForm owners={options.owners} busy={busy} onClose={() => { if (!writeRequest.current) setForm(null); }} onSubmit={(body) => void mutate("crm.manage", (signal) => sendCommand("/crm/leads", { method: "POST", signal, body: JSON.stringify(body) }))} />}
      {form?.kind === "qualify" && <QualifyForm lead={form.lead} currencies={options.currencies} busy={busy} onClose={() => { if (!writeRequest.current) setForm(null); }} onSubmit={(body) => void mutate("crm.manage", (signal) => sendCommand(`/crm/leads/${form.lead.id}/qualify`, { method: "POST", signal, body: JSON.stringify(body) }))} />}
      {form?.kind === "activity" && <ActivityForm owners={options.owners} busy={busy} onClose={() => { if (!writeRequest.current) setForm(null); }} onSubmit={(body) => void mutate("crm.activities.manage", (signal) => sendCommand("/crm/activities", { method: "POST", signal, body: JSON.stringify({ ...body, parentType: form.parentType, parentId: form.parentId }) }))} />}
      {form?.kind === "convert" && <ConvertForm lead={form.lead} customers={options.customers} busy={busy} onClose={() => { if (!writeRequest.current) setForm(null); }} onSubmit={(body) => void mutate("crm.convert", (signal) => sendCommand(`/crm/leads/${form.lead.id}/convert`, { method: "POST", signal, body: JSON.stringify(body) }))} />}
    </div>
  );
}

function LeadForm({ owners, busy, onClose, onSubmit }: { owners: Owner[]; busy: boolean; onClose: () => void; onSubmit: (body: Record<string, unknown> & { displayName: string }) => void }) {
  const { t } = useI18n();
  const save = (form: HTMLFormElement) => {
    if (busy) return;
    const data = new FormData(form);
    const displayName = String(data.get("displayName") ?? "").trim();
    const ownerEmployeeId = String(data.get("ownerEmployeeId") ?? "");
    onSubmit({ kind: data.get("kind"), displayName, contactName: data.get("contactName") || null, phone: data.get("phone") || null, email: data.get("email") || null, source: data.get("source"), summary: data.get("summary") || null, ownerEmployeeId });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); save(event.currentTarget); };
  return <Modal title={t("crm.createLeadTitle")} onClose={onClose}><form onSubmit={submit}><fieldset className="crm-form" disabled={busy}><label><span>{t("crm.kind")}</span><select name="kind"><option value="ORGANIZATION">{t("crm.kind.ORGANIZATION")}</option><option value="INDIVIDUAL">{t("crm.kind.INDIVIDUAL")}</option></select></label><label><span>{t("crm.displayName")}</span><input name="displayName" required maxLength={200} autoFocus /></label><label><span>{t("crm.contactName")}</span><input name="contactName" maxLength={160} /></label><label><span>{t("crm.phone")}</span><input name="phone" type="tel" autoComplete="tel" dir="ltr" maxLength={40} /></label><label><span>{t("crm.email")}</span><input name="email" type="email" dir="ltr" maxLength={320} /></label><label><span>{t("crm.source")}</span><select name="source"><option value="MANUAL">{t("crm.source.MANUAL")}</option><option value="REFERRAL">{t("crm.source.REFERRAL")}</option><option value="WEBSITE">{t("crm.source.WEBSITE")}</option><option value="OTHER">{t("crm.source.OTHER")}</option></select></label><label><span>{t("crm.owner")}</span><select name="ownerEmployeeId" required defaultValue=""><option value="" disabled>—</option>{owners.map((owner) => <option value={owner.id} key={owner.id}>{owner.nameAr}</option>)}</select></label><label className="full"><span>{t("crm.summary")}</span><textarea name="summary" maxLength={1000} /></label><div className="modal-actions full"><Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={busy} onClick={(event) => { event.preventDefault(); const form = event.currentTarget.form; if (form?.reportValidity()) save(form); }}>{t("crm.create")}</Button></div></fieldset></form></Modal>;
}

function QualifyForm({ lead, currencies, busy, onClose, onSubmit }: { lead: Lead; currencies: Options["currencies"]; busy: boolean; onClose: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const [hasAmount, setHasAmount] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; const data = new FormData(event.currentTarget); const amount = String(data.get("estimatedAmount") ?? ""); const currencyId = String(data.get("currencyId") ?? ""); onSubmit({ version: lead.version, title: String(data.get("title") ?? "").trim(), expectedCloseDate: data.get("expectedCloseDate") || null, estimatedAmount: amount || null, currencyId: amount ? currencyId : null, probabilityBps: Math.round(Number(data.get("probability")) * 100) }); };
  return <Modal title={t("crm.qualifyTitle")} onClose={onClose}><form onSubmit={submit}><fieldset className="crm-form" disabled={busy}><label className="full"><span>{t("crm.opportunityTitle")}</span><input name="title" defaultValue={lead.displayName} required maxLength={200} autoFocus /></label><label><span>{t("crm.expectedClose")}</span><input name="expectedCloseDate" type="date" /></label><label><span>{t("crm.probabilityBps")}</span><input name="probability" type="number" min="0" max="100" defaultValue="30" required /></label><label><span>{t("crm.estimatedAmount")}</span><input name="estimatedAmount" onChange={(event) => setHasAmount(event.target.value !== "")} type="number" min="0" step="0.0001" dir="ltr" /></label><label><span>{t("crm.currency")}</span><select name="currencyId" required={hasAmount} defaultValue=""><option value="">—</option>{currencies.map((currency) => <option value={currency.id} key={currency.id}>{currency.code}</option>)}</select></label><div className="modal-actions full"><Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={busy}>{t("crm.qualify")}</Button></div></fieldset></form></Modal>;
}

function ActivityForm({ owners, busy, onClose, onSubmit }: { owners: Owner[]; busy: boolean; onClose: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; const data = new FormData(event.currentTarget); const scheduled = String(data.get("scheduledFor") ?? ""); onSubmit({ type: data.get("type"), subject: String(data.get("subject") ?? "").trim(), details: data.get("details") || null, assignedEmployeeId: data.get("assignedEmployeeId"), scheduledFor: scheduled ? new Date(scheduled).toISOString() : null }); };
  return <Modal title={t("crm.activityTitle")} onClose={onClose}><form onSubmit={submit}><fieldset className="crm-form" disabled={busy}><label><span>{t("crm.activityType")}</span><select name="type"><option value="CALL">{t("crm.activity.CALL")}</option><option value="MEETING">{t("crm.activity.MEETING")}</option><option value="TASK">{t("crm.activity.TASK")}</option><option value="NOTE">{t("crm.activity.NOTE")}</option></select></label><label><span>{t("crm.owner")}</span><select name="assignedEmployeeId" required defaultValue=""><option value="" disabled>—</option>{owners.map((owner) => <option value={owner.id} key={owner.id}>{owner.nameAr}</option>)}</select></label><label className="full"><span>{t("crm.subject")}</span><input name="subject" required maxLength={200} autoFocus /></label><label><span>{t("crm.scheduledFor")}</span><input name="scheduledFor" type="datetime-local" /></label><label className="full"><span>{t("crm.details")}</span><textarea name="details" maxLength={1000} /></label><div className="modal-actions full"><Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={busy}>{t("crm.addActivity")}</Button></div></fieldset></form></Modal>;
}

function ConvertForm({ lead, customers, busy, onClose, onSubmit }: { lead: Lead; customers: Options["customers"]; busy: boolean; onClose: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; const data = new FormData(event.currentTarget); onSubmit(mode === "EXISTING" ? { version: lead.version, mode, customerId: data.get("customerId") } : { version: lead.version, mode, receivableAccountId: data.get("receivableAccountId"), nameAr: data.get("nameAr"), nameEn: data.get("nameEn") || null, phone: lead.phone, email: lead.email }); };
  return <Modal title={t("crm.convertTitle")} description={t("crm.legalBlocked")} onClose={onClose}><form onSubmit={submit}><fieldset className="crm-form" disabled={busy}><label className="full"><span>{t("crm.conversionMode")}</span><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="EXISTING">{t("crm.mode.EXISTING")}</option><option value="NEW">{t("crm.mode.NEW")}</option></select></label>{mode === "EXISTING" ? <label className="full"><span>{t("crm.customer")}</span><select name="customerId" required defaultValue=""><option value="" disabled>—</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.code} · {customer.nameAr}</option>)}</select></label> : <><label><span>{t("crm.receivableAccountId")}</span><input name="receivableAccountId" required pattern="[1-9][0-9]*" dir="ltr" /></label><label><span>{t("crm.customerNameAr")}</span><input name="nameAr" defaultValue={lead.displayName} required maxLength={200} /></label><label><span>{t("crm.customerNameEn")}</span><input name="nameEn" maxLength={200} /></label></>}<div className="modal-actions full"><Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={busy}>{t("crm.convert")}</Button></div></fieldset></form></Modal>;
}
