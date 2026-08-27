import {
  activeIntlLocale,
  translate as t,
  type TranslationKey } from "./i18n";
import { FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import { api,
  idempotencyKey } from "./api";
import { validateFiscalPeriods } from "./domain";
import type { FinancialCloseReadiness,
  FinancialCloseRun,
  FiscalPeriod,
  FiscalYear,
  ListResponse } from "./types";
import { Button,
  EmptyState,
  Modal,
  Pagination,
  Spinner,
  PageHeader,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type PeriodDraft = { periodNumber: number; name: string; startDate: string; endDate: string };
const todayYear = new Date().getFullYear();
const newYear = () => ({
  name: t("pages.fiscal.001", { value1: todayYear }),
  startDate: `${todayYear}-01-01`,
  endDate: `${todayYear}-12-31`,
  periods: Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const end = new Date(Date.UTC(todayYear, index + 1, 0)).getUTCDate();
    return { periodNumber: index + 1, name: t("pages.fiscal.002", { value1: index + 1 }), startDate: `${todayYear}-${month}-01`, endDate: `${todayYear}-${month}-${end}` };
  }),
});

export function FiscalPage({ notify }: { notify: Notice }) {
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingYear, setEditingYear] = useState<FiscalYear | null>(null);
  const [editingPeriod, setEditingPeriod] = useState<FiscalPeriod | null>(null);
  const [closingPeriod, setClosingPeriod] = useState<FiscalPeriod | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api<ListResponse<FiscalYear>>(`/fiscal-years?page=${page}&pageSize=10`);
      setYears(result.data); setMeta(result.meta);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.fiscal.003")); }
    finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => years.map((year) => ({ ...year, periods: status ? year.periods.filter((period) => period.status === status) : year.periods })).filter((year) => !status || year.periods.length), [years, status]);

  async function reopenPeriod(period: FiscalPeriod) {
    const reason = window.prompt(t("pages.fiscal.005"));
    if (!reason || reason.trim().length < 10) return;
    try {
      await api(`/fiscal-periods/${period.id}/reopen`, {
        method: "POST", idempotencyKey: idempotencyKey("reopen", period.id),
        body: JSON.stringify({ version: period.version, reason: reason.trim() }),
      });
      notify(t("pages.fiscal.007"));
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.fiscal.008"), "error"); await load(); }
  }

  return <section className="workspace-page">
    <PageHeader kicker={t("pages.accounts.013")} title={t("pages.fiscal.010")} description={t("pages.fiscal.011")} actions={<Button icon="plus" onClick={() => setCreating(true)}>{t("pages.fiscal.012")}</Button>} />
    <div className="toolbar fiscal-filters"><select aria-label={t("pages.fiscal.013")} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{t("pages.fiscal.014")}</option><option value="OPEN">{t("pages.fiscal.015")}</option><option value="REOPENED">{t("pages.fiscal.016")}</option><option value="CLOSED">{t("pages.fiscal.017")}</option></select></div>
    {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{t("pages.accounts.030")}</Button></div>
      : loading ? <Spinner label={t("pages.fiscal.019")} />
      : visible.length === 0 ? <EmptyState title={t("pages.fiscal.020")} description={t("pages.fiscal.021")} action={<Button icon="plus" onClick={() => setCreating(true)}>{t("pages.fiscal.022")}</Button>} />
      : <>{visible.map((year) => <article className="fiscal-year-card" key={year.id}>
        <header><div><h2>{year.name}</h2><p>{new Date(year.startDate).toLocaleDateString(activeIntlLocale())} — {new Date(year.endDate).toLocaleDateString(activeIntlLocale())}</p></div><Button variant="ghost" icon="edit" onClick={() => setEditingYear(year)}>{t("pages.fiscal.023")}</Button></header>
        <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("pages.fiscal.024")}</th><th>{t("pages.dashboard.013")}</th><th>{t("pages.dashboard.014")}</th><th>{t("pages.accounts.043")}</th><th>{t("pages.fiscal.028")}</th></tr></thead><tbody>{year.periods.map((period) => <tr key={period.id}><td><strong>{period.periodNumber}. {period.name}</strong>{period.reopenReason && <small>{t("pages.fiscal.029")}{period.reopenReason}</small>}</td><td>{new Date(period.startDate).toLocaleDateString(activeIntlLocale())}</td><td>{new Date(period.endDate).toLocaleDateString(activeIntlLocale())}</td><td><span className={`status-chip ${period.status.toLowerCase()}`}>{period.status === "CLOSED" ? t("pages.fiscal.017") : period.status === "REOPENED" ? t("pages.fiscal.016") : t("pages.fiscal.015")}</span></td><td className="row-actions"><Button variant="ghost" icon="edit" onClick={() => setEditingPeriod(period)}>{t("pages.accounts.048")}</Button>{period.status === "CLOSED" ? <Button variant="secondary" icon="reverse" onClick={() => void reopenPeriod(period)}>{t("pages.fiscal.031")}</Button> : <Button variant="secondary" icon="check" onClick={() => setClosingPeriod(period)}>{t("pages.audit-logs.037")}</Button>}</td></tr>)}</tbody></table></div>
      </article>)}<Pagination {...meta} page={page} onChange={setPage} /></>}
    {creating && <YearForm onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); notify(t("pages.fiscal.033")); await load(); }} />}
    {editingYear && <YearEdit year={editingYear} onClose={() => setEditingYear(null)} onSaved={async () => { setEditingYear(null); notify(t("pages.fiscal.034")); await load(); }} />}
    {editingPeriod && <PeriodEdit period={editingPeriod} onClose={() => setEditingPeriod(null)} onSaved={async () => { setEditingPeriod(null); notify(t("pages.fiscal.035")); await load(); }} />}
    {closingPeriod && <CloseWorkspace period={closingPeriod} notify={notify} onClose={() => setClosingPeriod(null)} onClosed={async () => { setClosingPeriod(null); await load(); }} />}
  </section>;
}

function CloseWorkspace({ period, notify, onClose, onClosed }: { period: FiscalPeriod; notify: Notice; onClose: () => void; onClosed: () => void }) {
  const [readiness, setReadiness] = useState<FinancialCloseReadiness | null>(null);
  const [run, setRun] = useState<FinancialCloseRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [returning, setReturning] = useState(false);
  const [returnReason, setReturnReason] = useState("");

  const loadClose = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [readinessResult, runResult] = await Promise.all([
        api<FinancialCloseReadiness>(`/fiscal-periods/${period.id}/close-readiness`),
        api<{ run: FinancialCloseRun | null }>(`/fiscal-periods/${period.id}/close-run`),
      ]);
      setReadiness(readinessResult); setRun(runResult.run);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("financialClose.loadError")); }
    finally { setLoading(false); }
  }, [period.id]);
  useEffect(() => { void loadClose(); }, [loadClose]);

  async function updateRun(operation: "start" | "refresh" | "submit" | "return") {
    if (!readiness) return;
    setWorking(operation); setError("");
    try {
      if (operation === "submit") {
        await api("/approval-requests", {
          method: "POST",
          idempotencyKey: idempotencyKey("financial-close-approval", run!.id),
          body: JSON.stringify({
            subjectType: "FINANCIAL_CLOSE_RUN",
            subjectId: run!.id,
            subjectVersion: run!.version,
          }),
        });
        await loadClose();
        notify(t("financialClose.submitSuccess"));
        return;
      }
      const path = operation === "start"
        ? `/fiscal-periods/${period.id}/close-run`
        : `/financial-close-runs/${run!.id}/${operation}`;
      const body = operation === "start"
        ? { version: readiness.periodVersion }
        : operation === "return"
          ? { version: run!.version, reason: returnReason.trim() }
          : { version: run!.version };
      const result = await api<{ run: FinancialCloseRun }>(path, {
        method: "POST",
        idempotencyKey: idempotencyKey(`financial-close-${operation}`, run?.id ?? period.id),
        body: JSON.stringify(body),
      });
      setRun(result.run); setReadiness(result.run.checklist); setReturning(false); setReturnReason("");
      notify(t(`financialClose.${operation}Success` as TranslationKey));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("financialClose.actionError")); }
    finally { setWorking(""); }
  }

  async function finalizeClose() {
    if (!run || !readiness || !window.confirm(t("financialClose.finalConfirm"))) return;
    setWorking("close"); setError("");
    try {
      await api(`/fiscal-periods/${period.id}/close`, {
        method: "POST",
        idempotencyKey: idempotencyKey("financial-close-final", run.id),
        body: JSON.stringify({ version: readiness.periodVersion, closeRunId: run.id, closeRunVersion: run.version }),
      });
      notify(t("financialClose.closeSuccess"));
      await onClosed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("financialClose.actionError")); }
    finally { setWorking(""); }
  }

  const visibleReadiness = run?.status === "REVIEWED" || run?.status === "AWAITING_APPROVAL" ? run.checklist : readiness;
  const statusLabel = run?.status === "CLOSED"
    ? t("financialClose.closed")
    : run?.status === "REVIEWED"
      ? t("financialClose.reviewed")
      : run?.status === "AWAITING_APPROVAL"
        ? t("financialClose.awaitingApproval")
        : t("financialClose.preparing");
  return <Modal title={`${t("financialClose.title")} — ${period.name}`} description={t("financialClose.description")} onClose={onClose} wide>
    <div className="financial-close-workspace">
      {loading ? <Spinner label={t("financialClose.loading")} /> : error && !visibleReadiness ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void loadClose()}>{t("common.retry")}</Button></div> : <>
        {error && <div className="form-error" role="alert">{error}</div>}
        {visibleReadiness && <>
          <div className={`close-readiness-banner ${visibleReadiness.ready ? "ready" : "blocked"}`}>
            <div><strong>{visibleReadiness.ready ? t("financialClose.ready") : t("financialClose.blocked")}</strong><span>{visibleReadiness.isYearEnd ? t("financialClose.yearEnd") : t("financialClose.monthEnd")}</span></div>
            {run && <div className="close-run-badge"><span>{t("financialClose.cycle", { value1: run.cycle })}</span><strong>{statusLabel}</strong></div>}
          </div>
          <div className="close-checklist">
            {visibleReadiness.items.map((item) => <article className={item.status === "PASS" ? "pass" : "blocked"} key={item.code}>
              <span className="close-check-icon" aria-hidden="true">{item.status === "PASS" ? "✓" : "!"}</span>
              <div><strong>{t(`financialClose.item.${item.code}` as TranslationKey)}</strong><small>{item.status === "PASS" ? t("financialClose.pass") : t("financialClose.blockedCount", { value1: item.count })}</small></div>
            </article>)}
          </div>
          <p className="close-checked-at">{t("financialClose.checkedAt", { value1: new Date(visibleReadiness.checkedAt).toLocaleString(activeIntlLocale()) })}</p>
          {!run && <div className="close-empty-note">{t("financialClose.noRun")}</div>}
          {run?.status === "AWAITING_APPROVAL" && <div className="close-empty-note">{t("financialClose.awaitingApprovalDescription")} <a href="#approvals">{t("financialClose.openApprovals")}</a></div>}
          {run?.closePack && <div className="close-pack-note"><strong>{t("financialClose.snapshot")}</strong><code>{run.closePackHashSha256?.slice(0, 12)}</code></div>}
          {returning && <div className="close-return-panel"><label><span>{t("financialClose.returnReason")}</span><textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} rows={3} /></label><div className="row-actions"><Button variant="ghost" onClick={() => setReturning(false)}>{t("financialClose.cancelReturn")}</Button><Button variant="danger" disabled={returnReason.trim().length < 10 || Boolean(working)} onClick={() => void updateRun("return")}>{t("financialClose.confirmReturn")}</Button></div></div>}
          <div className="form-actions close-actions">
            <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
            {!run && <Button disabled={Boolean(working)} onClick={() => void updateRun("start")}>{working ? t("common.loading") : t("financialClose.start")}</Button>}
            {run?.status === "PREPARING" && <><Button variant="secondary" disabled={Boolean(working)} onClick={() => void updateRun("refresh")}>{t("financialClose.refresh")}</Button><Button disabled={!visibleReadiness.ready || Boolean(working)} onClick={() => void updateRun("submit")}>{t("financialClose.submitApproval")}</Button></>}
            {run?.status === "REVIEWED" && <><Button variant="secondary" disabled={Boolean(working)} onClick={() => setReturning(true)}>{t("financialClose.return")}</Button><Button disabled={Boolean(working)} onClick={() => void finalizeClose()}>{t("financialClose.finalize")}</Button></>}
          </div>
        </>}
      </>}
    </div>
  </Modal>;
}
function YearForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const initial = newYear(); const [name, setName] = useState(initial.name); const [startDate, setStartDate] = useState(initial.startDate); const [endDate, setEndDate] = useState(initial.endDate); const [periods, setPeriods] = useState<PeriodDraft[]>(initial.periods); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  function change(index: number, patch: Partial<PeriodDraft>) { setPeriods((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  async function submit(event: FormEvent) { event.preventDefault(); const errors = validateFiscalPeriods(startDate, endDate, periods); if (!name.trim()) errors.unshift(t("pages.fiscal.036")); if (errors.length) { setError(errors.join(" ")); return; } setSaving(true); setError(""); try { await api("/fiscal-years", { method: "POST", body: JSON.stringify({ name: name.trim(), startDate, endDate, periods }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.fiscal.037")); } finally { setSaving(false); } }
  return <Modal title={t("pages.fiscal.012")} description={t("pages.fiscal.038")} onClose={onClose} wide><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><label><span>{t("pages.fiscal.039")}</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label><label><span>{t("pages.fiscal.040")}</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></label><label><span>{t("pages.fiscal.041")}</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></label></div><div className="subsection-heading"><h3>{t("pages.fiscal.042")}</h3><Button type="button" variant="secondary" icon="plus" onClick={() => setPeriods((items) => [...items, { periodNumber: items.length + 1, name: t("pages.fiscal.002", { value1: items.length + 1 }), startDate: "", endDate: "" }])}>{t("pages.fiscal.043")}</Button></div><div className="period-editor">{periods.map((period, index) => <div key={index}><input aria-label={t("pages.fiscal.044")} type="number" min="1" value={period.periodNumber} onChange={(e) => change(index, { periodNumber: Number(e.target.value) })} /><input aria-label={t("pages.fiscal.045")} value={period.name} onChange={(e) => change(index, { name: e.target.value })} required /><input aria-label={t("pages.fiscal.046")} type="date" value={period.startDate} onChange={(e) => change(index, { startDate: e.target.value })} required /><input aria-label={t("pages.fiscal.047")} type="date" value={period.endDate} onChange={(e) => change(index, { endDate: e.target.value })} required /><Button type="button" variant="ghost" icon="trash" aria-label={t("pages.fiscal.048")} disabled={periods.length === 1} onClick={() => setPeriods((items) => items.filter((_, i) => i !== index))} /></div>)}</div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit" disabled={saving}>{saving ? t("pages.accounts.066") : t("pages.fiscal.051")}</Button></div></form></Modal>;
}
function YearEdit({ year, onClose, onSaved }: { year: FiscalYear; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(year.name); const [startDate, setStartDate] = useState(year.startDate); const [endDate, setEndDate] = useState(year.endDate); const [error, setError] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); try { await api(`/fiscal-years/${year.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim(), startDate, endDate }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.fiscal.052")); } }
  return <Modal title={t("pages.fiscal.053")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<label><span>{t("pages.fiscal.054")}</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label><div className="form-grid"><label><span>{t("pages.fiscal.040")}</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label><label><span>{t("pages.fiscal.041")}</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label></div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit">{t("pages.accounts.067")}</Button></div></form></Modal>;
}
function PeriodEdit({ period, onClose, onSaved }: { period: FiscalPeriod; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(period.name); const [startDate, setStartDate] = useState(period.startDate); const [endDate, setEndDate] = useState(period.endDate); const [error, setError] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); try { await api(`/fiscal-periods/${period.id}`, { method: "PATCH", body: JSON.stringify({ version: period.version, name: name.trim(), startDate, endDate }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.fiscal.052")); } }
  return <Modal title={t("pages.fiscal.056")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<label><span>{t("pages.fiscal.054")}</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label><div className="form-grid"><label><span>{t("pages.fiscal.040")}</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label><label><span>{t("pages.fiscal.041")}</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label></div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("pages.accounts.065")}</Button><Button type="submit">{t("pages.accounts.067")}</Button></div></form></Modal>;
}
