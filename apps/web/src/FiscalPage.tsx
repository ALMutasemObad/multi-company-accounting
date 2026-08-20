import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, idempotencyKey } from "./api";
import { validateFiscalPeriods } from "./domain";
import type { FiscalPeriod, FiscalYear, ListResponse } from "./types";
import { Button, EmptyState, Modal, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type PeriodDraft = { periodNumber: number; name: string; startDate: string; endDate: string };
const todayYear = new Date().getFullYear();
const newYear = () => ({
  name: `السنة المالية ${todayYear}`,
  startDate: `${todayYear}-01-01`,
  endDate: `${todayYear}-12-31`,
  periods: Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const end = new Date(Date.UTC(todayYear, index + 1, 0)).getUTCDate();
    return { periodNumber: index + 1, name: `الفترة ${index + 1}`, startDate: `${todayYear}-${month}-01`, endDate: `${todayYear}-${month}-${end}` };
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

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api<ListResponse<FiscalYear>>(`/fiscal-years?page=${page}&pageSize=10`);
      setYears(result.data); setMeta(result.meta);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل السنوات المالية."); }
    finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => years.map((year) => ({ ...year, periods: status ? year.periods.filter((period) => period.status === status) : year.periods })).filter((year) => !status || year.periods.length), [years, status]);

  async function periodCommand(period: FiscalPeriod, operation: "close" | "reopen") {
    if (operation === "close" && !window.confirm(`تأكيد إغلاق الفترة «${period.name}» بعد مراجعة جميع الأرصدة؟`)) return;
    const reason = operation === "reopen" ? window.prompt("سبب إعادة فتح الفترة (10 أحرف على الأقل):") : "";
    if (operation === "reopen" && (!reason || reason.trim().length < 10)) return;
    try {
      await api(`/fiscal-periods/${period.id}/${operation}`, {
        method: "POST", idempotencyKey: idempotencyKey(operation, period.id),
        body: JSON.stringify(operation === "close"
          ? { version: period.version, reviewConfirmed: true, requirePeriodCloseDocument: false }
          : { version: period.version, reason: reason!.trim() }),
      });
      notify(operation === "close" ? "تم إغلاق الفترة المالية بنجاح." : "تمت إعادة فتح الفترة المالية.");
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "تعذر تنفيذ الإجراء.", "error"); await load(); }
  }

  return <section className="workspace-page">
    <header className="page-heading"><div><span className="section-kicker">الإعداد المحاسبي</span><h1>السنوات والفترات المالية</h1><p>إدارة التقويم المالي، ومتابعة حالة الفترات، وإغلاقها وإعادة فتحها وفق ترتيبها الزمني.</p></div><Button icon="plus" onClick={() => setCreating(true)}>سنة مالية جديدة</Button></header>
    <div className="toolbar fiscal-filters"><select aria-label="تصفية حالة الفترات" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل حالات الفترات</option><option value="OPEN">مفتوحة</option><option value="REOPENED">معاد فتحها</option><option value="CLOSED">مغلقة</option></select></div>
    {error ? <div className="error-panel"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>إعادة المحاولة</Button></div>
      : loading ? <Spinner label="جارٍ تحميل التقويم المالي" />
      : visible.length === 0 ? <EmptyState title="لا توجد سنوات مالية" description="أنشئ سنة مالية وحدد فتراتها لتتمكن من تسجيل المستندات والقيود." action={<Button icon="plus" onClick={() => setCreating(true)}>إنشاء سنة مالية</Button>} />
      : <>{visible.map((year) => <article className="fiscal-year-card" key={year.id}>
        <header><div><h2>{year.name}</h2><p>{new Date(year.startDate).toLocaleDateString("ar-SA")} — {new Date(year.endDate).toLocaleDateString("ar-SA")}</p></div><Button variant="ghost" icon="edit" onClick={() => setEditingYear(year)}>تعديل السنة</Button></header>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>الفترة</th><th>من</th><th>إلى</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{year.periods.map((period) => <tr key={period.id}><td><strong>{period.periodNumber}. {period.name}</strong>{period.reopenReason && <small>سبب إعادة الفتح: {period.reopenReason}</small>}</td><td>{new Date(period.startDate).toLocaleDateString("ar-SA")}</td><td>{new Date(period.endDate).toLocaleDateString("ar-SA")}</td><td><span className={`status-chip ${period.status.toLowerCase()}`}>{period.status === "CLOSED" ? "مغلقة" : period.status === "REOPENED" ? "معاد فتحها" : "مفتوحة"}</span></td><td className="row-actions"><Button variant="ghost" icon="edit" onClick={() => setEditingPeriod(period)}>تعديل</Button>{period.status === "CLOSED" ? <Button variant="secondary" icon="reverse" onClick={() => void periodCommand(period, "reopen")}>إعادة فتح</Button> : <Button variant="secondary" icon="check" onClick={() => void periodCommand(period, "close")}>إغلاق</Button>}</td></tr>)}</tbody></table></div>
      </article>)}<Pagination {...meta} page={page} onChange={setPage} /></>}
    {creating && <YearForm onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); notify("تم إنشاء السنة المالية وفتراتها."); await load(); }} />}
    {editingYear && <YearEdit year={editingYear} onClose={() => setEditingYear(null)} onSaved={async () => { setEditingYear(null); notify("تم تحديث السنة المالية."); await load(); }} />}
    {editingPeriod && <PeriodEdit period={editingPeriod} onClose={() => setEditingPeriod(null)} onSaved={async () => { setEditingPeriod(null); notify("تم تحديث الفترة المالية."); await load(); }} />}
  </section>;
}

function YearForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const initial = newYear(); const [name, setName] = useState(initial.name); const [startDate, setStartDate] = useState(initial.startDate); const [endDate, setEndDate] = useState(initial.endDate); const [periods, setPeriods] = useState<PeriodDraft[]>(initial.periods); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  function change(index: number, patch: Partial<PeriodDraft>) { setPeriods((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  async function submit(event: FormEvent) { event.preventDefault(); const errors = validateFiscalPeriods(startDate, endDate, periods); if (!name.trim()) errors.unshift("أدخل اسم السنة المالية."); if (errors.length) { setError(errors.join(" ")); return; } setSaving(true); setError(""); try { await api("/fiscal-years", { method: "POST", body: JSON.stringify({ name: name.trim(), startDate, endDate, periods }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إنشاء السنة."); } finally { setSaving(false); } }
  return <Modal title="سنة مالية جديدة" description="أدخل حدود السنة وفتراتها. تم تجهيز 12 فترة شهرية ويمكن تعديلها." onClose={onClose} wide><form className="document-form" onSubmit={submit}>{error && <div className="form-error">{error}</div>}<div className="form-grid"><label><span>اسم السنة</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label><label><span>البداية</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></label><label><span>النهاية</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></label></div><div className="subsection-heading"><h3>الفترات المالية</h3><Button type="button" variant="secondary" icon="plus" onClick={() => setPeriods((items) => [...items, { periodNumber: items.length + 1, name: `الفترة ${items.length + 1}`, startDate: "", endDate: "" }])}>إضافة فترة</Button></div><div className="period-editor">{periods.map((period, index) => <div key={index}><input aria-label="رقم الفترة" type="number" min="1" value={period.periodNumber} onChange={(e) => change(index, { periodNumber: Number(e.target.value) })} /><input aria-label="اسم الفترة" value={period.name} onChange={(e) => change(index, { name: e.target.value })} required /><input aria-label="بداية الفترة" type="date" value={period.startDate} onChange={(e) => change(index, { startDate: e.target.value })} required /><input aria-label="نهاية الفترة" type="date" value={period.endDate} onChange={(e) => change(index, { endDate: e.target.value })} required /><Button type="button" variant="ghost" icon="trash" aria-label="حذف الفترة" disabled={periods.length === 1} onClick={() => setPeriods((items) => items.filter((_, i) => i !== index))} /></div>)}</div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "إنشاء السنة"}</Button></div></form></Modal>;
}

function YearEdit({ year, onClose, onSaved }: { year: FiscalYear; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(year.name); const [startDate, setStartDate] = useState(year.startDate); const [endDate, setEndDate] = useState(year.endDate); const [error, setError] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); try { await api(`/fiscal-years/${year.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim(), startDate, endDate }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر التحديث."); } }
  return <Modal title="تعديل السنة المالية" onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error">{error}</div>}<label><span>الاسم</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label><div className="form-grid"><label><span>البداية</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label><label><span>النهاية</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label></div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit">حفظ</Button></div></form></Modal>;
}

function PeriodEdit({ period, onClose, onSaved }: { period: FiscalPeriod; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(period.name); const [startDate, setStartDate] = useState(period.startDate); const [endDate, setEndDate] = useState(period.endDate); const [error, setError] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); try { await api(`/fiscal-periods/${period.id}`, { method: "PATCH", body: JSON.stringify({ version: period.version, name: name.trim(), startDate, endDate }) }); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر التحديث."); } }
  return <Modal title="تعديل الفترة المالية" onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error">{error}</div>}<label><span>الاسم</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label><div className="form-grid"><label><span>البداية</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label><label><span>النهاية</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label></div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit">حفظ</Button></div></form></Modal>;
}
