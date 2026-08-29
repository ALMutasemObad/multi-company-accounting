import {
  activeIntlLocale,
  hasTranslation,
  translate as t,
  type TranslationKey } from "./i18n";
import { FormEvent,
  useCallback,
  useEffect,
  useState } from "react";
import { api } from "./api";
import type { ListResponse,
  SecurityEvent,
  SecurityEventOptions,
  SecurityEventSummary,
  SecuritySeverity } from "./types";
import { Button,
  EmptyState,
  Icon,
  Modal,
  Pagination,
  Spinner,
  PageHeader,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Filters = { search: string; userId: string; eventType: string; severity: string; unacknowledgedOnly: string; dateFrom: string; dateTo: string };
const emptyFilters: Filters = { search: "", userId: "", eventType: "", severity: "", unacknowledgedOnly: "", dateFrom: "", dateTo: "" };
const severityCodes: SecuritySeverity[] = ["INFO", "WARNING", "HIGH", "CRITICAL"];
const severityLabel = (severity: SecuritySeverity) => t(`security.severity.${severity}` as TranslationKey);
function eventLabel(eventType: string) {
  const key = `security.event.${eventType}`;
  return hasTranslation(key) ? t(key) : eventType;
}
export function SecurityEventsPage({ notify }: { notify: Notice }) {
  const [rows, setRows] = useState<SecurityEvent[]>([]);
  const [summary, setSummary] = useState<SecurityEventSummary | null>(null);
  const [options, setOptions] = useState<SecurityEventOptions>({ eventTypes: [], users: [] });
  const [meta, setMeta] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<SecurityEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const queryFor = useCallback(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25" });
    for (const [key, value] of Object.entries(applied)) if (value) query.set(key, value);
    return query;
  }, [applied, page]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [events, overview] = await Promise.all([api<ListResponse<SecurityEvent>>(`/security-events?${queryFor()}`), api<SecurityEventSummary>("/security-events/summary")]);
      setRows(events.data); setMeta(events.meta); setSummary(overview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.security-events.001")); }
    finally { setLoading(false); }
  }, [queryFor]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void api<SecurityEventOptions>("/security-events/options").then(setOptions).catch(() => undefined); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) { notify(t("pages.audit-logs.002"), "error"); return; }
    setPage(1); setApplied(draft);
  }
  async function acknowledge(item: SecurityEvent) {
    try {
      const updated = await api<SecurityEvent>(`/security-events/${item.id}/acknowledge`, { method: "POST" });
      setSelected(updated); notify(t("pages.security-events.003")); await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.security-events.004"), "error"); }
  }

  return <section className="workspace-page security-page">
    <PageHeader kicker={t("pages.security-events.005")} title={t("pages.security-events.006")} description={t("pages.security-events.007")} />
    {summary && <div className="metric-grid security-metrics">
      <article className="metric-card negative"><div className="metric-icon"><Icon name="audit" /></div><span>{t("pages.security-events.008")}</span><strong>{summary.unacknowledgedAlerts}</strong><small>{t("pages.security-events.009")}</small></article>
      <article className="metric-card negative"><div className="metric-icon"><Icon name="ban" /></div><span>{t("pages.security-events.010")}</span><strong>{summary.last24Hours.critical}</strong><small>{summary.latestCriticalAt ? t("pages.security-events.011", { value1: new Date(summary.latestCriticalAt).toLocaleString(activeIntlLocale()) }) : t("pages.security-events.012")}</small></article>
      <article className="metric-card neutral"><div className="metric-icon"><Icon name="audit" /></div><span>{t("pages.security-events.013")}</span><strong>{summary.last24Hours.high}</strong><small>{t("pages.security-events.014")}</small></article>
      <article className="metric-card"><div className="metric-icon"><Icon name="check" /></div><span>{t("pages.security-events.015")}</span><strong>{summary.last24Hours.info}</strong><small>{t("pages.security-events.016")}</small></article>
    </div>}
    <form className="audit-filters" onSubmit={submit}>
      <label className="audit-search"><span>{t("pages.accounts.026")}</span><input value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder={t("pages.security-events.018")} /></label>
      <label><span>{t("pages.admin.021")}</span><select value={draft.userId} onChange={(event) => setDraft({ ...draft, userId: event.target.value })}><option value="">{t("pages.audit-logs.013")}</option>{options.users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label>
      <label><span>{t("pages.security-events.021")}</span><select value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}><option value="">{t("pages.security-events.022")}</option>{options.eventTypes.map((eventType) => <option key={eventType} value={eventType}>{eventLabel(eventType)}</option>)}</select></label>
      <label><span>{t("pages.security-events.023")}</span><select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="">{t("pages.security-events.024")}</option>{severityCodes.map((value) => <option key={value} value={value}>{severityLabel(value)}</option>)}</select></label>
      <label><span>{t("pages.security-events.025")}</span><select value={draft.unacknowledgedOnly} onChange={(event) => setDraft({ ...draft, unacknowledgedOnly: event.target.value })}><option value="">{t("pages.customers.020")}</option><option value="true">{t("pages.security-events.008")}</option></select></label>
      <label><span>{t("pages.audit-logs.018")}</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} /></label>
      <label><span>{t("pages.audit-logs.019")}</span><input type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} /></label>
      <div className="audit-filter-actions"><Button type="submit">{t("pages.audit-logs.020")}</Button><Button type="button" variant="ghost" onClick={() => { setDraft(emptyFilters); setApplied(emptyFilters); setPage(1); }}>{t("pages.audit-logs.021")}</Button></div>
    </form>
    {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{t("pages.accounts.030")}</Button></div> : loading ? <Spinner label={t("pages.security-events.032")} /> : !rows.length ? <EmptyState title={t("pages.audit-logs.024")} description={t("pages.security-events.034")} /> : <>
      <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table security-table"><thead><tr><th>{t("pages.audit-logs.026")}</th><th>{t("pages.security-events.023")}</th><th>{t("pages.security-events.036")}</th><th>{t("pages.admin.021")}</th><th>{t("pages.security-events.037")}</th><th>{t("pages.accounts.043")}</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="audit-time">{new Date(row.createdAt).toLocaleString(activeIntlLocale())}</td><td><span className={`severity-chip ${row.severity.toLowerCase()}`}>{severityLabel(row.severity)}</span></td><td><strong>{eventLabel(row.eventType)}</strong><small dir="ltr">{row.eventType}</small></td><td>{row.user ? <><strong>{row.user.name}</strong><small dir="ltr">{row.user.email}</small></> : row.email ?? "—"}</td><td dir="ltr">{row.ipAddress ?? "—"}</td><td>{row.acknowledgedAt ? <span className="status-chip posted">{t("pages.security-events.039")}</span> : ["HIGH", "CRITICAL"].includes(row.severity) ? <span className="status-chip draft">{t("pages.security-events.040")}</span> : <span className="status-chip">{t("pages.security-events.041")}</span>}</td><td><Button variant="ghost" onClick={() => setSelected(row)}>{t("pages.audit-logs.029")}</Button></td></tr>)}</tbody></table></div>
      <Pagination {...meta} page={page} onChange={setPage} />
    </>}
    {selected && <Modal title={eventLabel(selected.eventType)} description={t("pages.security-events.043", { value1: selected.id })} onClose={() => setSelected(null)} wide>
      <dl className="detail-grid audit-detail-grid"><div><dt>{t("pages.security-events.023")}</dt><dd><span className={`severity-chip ${selected.severity.toLowerCase()}`}>{severityLabel(selected.severity)}</span></dd></div><div><dt>{t("pages.audit-logs.026")}</dt><dd>{new Date(selected.createdAt).toLocaleString(activeIntlLocale())}</dd></div><div><dt>{t("pages.admin.021")}</dt><dd>{selected.user?.name ?? t("pages.security-events.044")}<small dir="ltr">{selected.email}</small></dd></div><div><dt>{t("pages.security-events.037")}</dt><dd dir="ltr">{selected.ipAddress ?? "—"}</dd></div><div className="full"><dt>{t("pages.security-events.045")}</dt><dd dir="ltr">{selected.userAgent ?? "—"}</dd></div>{selected.acknowledgedAt && <div className="full"><dt>{t("pages.security-events.046")}</dt><dd>{selected.acknowledgedBy?.name} — {new Date(selected.acknowledgedAt).toLocaleString(activeIntlLocale())}</dd></div>}</dl>
      <section className="audit-details-json"><h3>{t("pages.security-events.047")}</h3><pre dir="ltr">{JSON.stringify(selected.details ?? {}, null, 2)}</pre></section>
      <div className="form-actions">{!selected.acknowledgedAt && ["HIGH", "CRITICAL"].includes(selected.severity) && <Button onClick={() => void acknowledge(selected)}>{t("pages.security-events.048")}</Button>}<Button variant="ghost" onClick={() => setSelected(null)}>{t("pages.audit-logs.037")}</Button></div>
    </Modal>}
  </section>;
}
