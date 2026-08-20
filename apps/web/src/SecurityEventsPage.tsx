import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { ListResponse, SecurityEvent, SecurityEventOptions, SecurityEventSummary, SecuritySeverity } from "./types";
import { Button, EmptyState, Icon, Modal, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Filters = { search: string; userId: string; eventType: string; severity: string; unacknowledgedOnly: string; dateFrom: string; dateTo: string };
const emptyFilters: Filters = { search: "", userId: "", eventType: "", severity: "", unacknowledgedOnly: "", dateFrom: "", dateTo: "" };
const severityLabels: Record<SecuritySeverity, string> = { INFO: "معلومات", WARNING: "تحذير", HIGH: "مرتفع", CRITICAL: "حرج" };
const eventLabels: Record<string, string> = {
  LOGIN_SUCCEEDED: "تسجيل دخول ناجح", LOGIN_FAILED: "محاولة دخول فاشلة", ACCOUNT_LOCKED: "قفل الحساب",
  LOCKED_ACCOUNT_LOGIN_ATTEMPT: "محاولة دخول إلى حساب مقفل", DISABLED_ACCOUNT_LOGIN_ATTEMPT: "محاولة دخول إلى حساب معطل",
  COMPANY_CONTEXT_SELECTED: "اختيار سياق الشركة", LOGOUT: "تسجيل خروج", SESSION_REVOKED: "إلغاء جلسة",
};

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
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل سجل الأمان."); }
    finally { setLoading(false); }
  }, [queryFor]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void api<SecurityEventOptions>("/security-events/options").then(setOptions).catch(() => undefined); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) { notify("تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.", "error"); return; }
    setPage(1); setApplied(draft);
  }
  async function acknowledge(item: SecurityEvent) {
    try {
      const updated = await api<SecurityEvent>(`/security-events/${item.id}/acknowledge`, { method: "POST" });
      setSelected(updated); notify("تم الإقرار بالتنبيه الأمني ومتابعته."); await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "تعذر الإقرار بالتنبيه.", "error"); }
  }

  return <section className="workspace-page security-page">
    <header className="page-heading"><div><span className="section-kicker">الأمان والمراقبة</span><h1>سجل الأمان</h1><p>راقب محاولات الدخول وقفل الحسابات والجلسات، وتابع التنبيهات الحرجة دون عرض أي أسرار مصادقة.</p></div></header>
    {summary && <div className="metric-grid security-metrics">
      <article className="metric-card negative"><div className="metric-icon"><Icon name="audit" /></div><span>تنبيهات غير مقر بها</span><strong>{summary.unacknowledgedAlerts}</strong><small>تتطلب المراجعة</small></article>
      <article className="metric-card negative"><div className="metric-icon"><Icon name="ban" /></div><span>أحداث حرجة خلال 24 ساعة</span><strong>{summary.last24Hours.critical}</strong><small>{summary.latestCriticalAt ? `آخر حدث: ${new Date(summary.latestCriticalAt).toLocaleString("ar-SA")}` : "لا توجد أحداث حرجة"}</small></article>
      <article className="metric-card neutral"><div className="metric-icon"><Icon name="audit" /></div><span>أحداث مرتفعة خلال 24 ساعة</span><strong>{summary.last24Hours.high}</strong><small>مؤشرات تستحق الانتباه</small></article>
      <article className="metric-card"><div className="metric-icon"><Icon name="check" /></div><span>أحداث معلوماتية خلال 24 ساعة</span><strong>{summary.last24Hours.info}</strong><small>نشاط اعتيادي مسجل</small></article>
    </div>}
    <form className="audit-filters" onSubmit={submit}>
      <label className="audit-search"><span>بحث</span><input value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="نوع الحدث أو المستخدم أو البريد أو عنوان IP" /></label>
      <label><span>المستخدم</span><select value={draft.userId} onChange={(event) => setDraft({ ...draft, userId: event.target.value })}><option value="">كل المستخدمين</option>{options.users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label>
      <label><span>نوع الحدث</span><select value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}><option value="">كل الأحداث</option>{options.eventTypes.map((eventType) => <option key={eventType} value={eventType}>{eventLabels[eventType] ?? eventType}</option>)}</select></label>
      <label><span>الخطورة</span><select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="">كل الدرجات</option>{Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>حالة التنبيه</span><select value={draft.unacknowledgedOnly} onChange={(event) => setDraft({ ...draft, unacknowledgedOnly: event.target.value })}><option value="">الكل</option><option value="true">تنبيهات غير مقر بها</option></select></label>
      <label><span>من تاريخ</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} /></label>
      <label><span>إلى تاريخ</span><input type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} /></label>
      <div className="audit-filter-actions"><Button type="submit">تطبيق</Button><Button type="button" variant="ghost" onClick={() => { setDraft(emptyFilters); setApplied(emptyFilters); setPage(1); }}>مسح</Button></div>
    </form>
    {error ? <div className="error-panel"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>إعادة المحاولة</Button></div> : loading ? <Spinner label="جارٍ تحميل سجل الأمان" /> : !rows.length ? <EmptyState title="لا توجد أحداث مطابقة" description="غيّر المرشحات أو النطاق الزمني لعرض أحداث أخرى." /> : <>
      <div className="data-table-wrap"><table className="data-table security-table"><thead><tr><th>الوقت</th><th>الخطورة</th><th>الحدث</th><th>المستخدم</th><th>عنوان IP</th><th>الحالة</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="audit-time">{new Date(row.createdAt).toLocaleString("ar-SA")}</td><td><span className={`severity-chip ${row.severity.toLowerCase()}`}>{severityLabels[row.severity]}</span></td><td><strong>{eventLabels[row.eventType] ?? row.eventType}</strong><small dir="ltr">{row.eventType}</small></td><td>{row.user ? <><strong>{row.user.name}</strong><small dir="ltr">{row.user.email}</small></> : row.email ?? "—"}</td><td dir="ltr">{row.ipAddress ?? "—"}</td><td>{row.acknowledgedAt ? <span className="status-chip posted">تم الإقرار</span> : ["HIGH", "CRITICAL"].includes(row.severity) ? <span className="status-chip draft">بانتظار المراجعة</span> : <span className="status-chip">مسجل</span>}</td><td><Button variant="ghost" onClick={() => setSelected(row)}>التفاصيل</Button></td></tr>)}</tbody></table></div>
      <Pagination {...meta} page={page} onChange={setPage} />
    </>}
    {selected && <Modal title={eventLabels[selected.eventType] ?? selected.eventType} description={`حدث أمني #${selected.id}`} onClose={() => setSelected(null)} wide>
      <dl className="detail-grid audit-detail-grid"><div><dt>الخطورة</dt><dd><span className={`severity-chip ${selected.severity.toLowerCase()}`}>{severityLabels[selected.severity]}</span></dd></div><div><dt>الوقت</dt><dd>{new Date(selected.createdAt).toLocaleString("ar-SA")}</dd></div><div><dt>المستخدم</dt><dd>{selected.user?.name ?? "غير معروف"}<small dir="ltr">{selected.email}</small></dd></div><div><dt>عنوان IP</dt><dd dir="ltr">{selected.ipAddress ?? "—"}</dd></div><div className="full"><dt>معلومات الجهاز</dt><dd dir="ltr">{selected.userAgent ?? "—"}</dd></div>{selected.acknowledgedAt && <div className="full"><dt>الإقرار</dt><dd>{selected.acknowledgedBy?.name} — {new Date(selected.acknowledgedAt).toLocaleString("ar-SA")}</dd></div>}</dl>
      <section className="audit-details-json"><h3>تفاصيل آمنة</h3><pre dir="ltr">{JSON.stringify(selected.details ?? {}, null, 2)}</pre></section>
      <div className="form-actions">{!selected.acknowledgedAt && ["HIGH", "CRITICAL"].includes(selected.severity) && <Button onClick={() => void acknowledge(selected)}>إقرار التنبيه</Button>}<Button variant="ghost" onClick={() => setSelected(null)}>إغلاق</Button></div>
    </Modal>}
  </section>;
}
