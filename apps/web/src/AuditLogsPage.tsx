import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, downloadFile } from "./api";
import type { AuditLog, AuditOptions, ListResponse } from "./types";
import { Button, EmptyState, Modal, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Filters = { search: string; userId: string; action: string; entityType: string; dateFrom: string; dateTo: string };
type TargetView = "admin" | "settings" | "customers" | "suppliers" | "receipts" | "payments" | "journals" | "fiscal" | "accounts" | "treasury";
const emptyFilters: Filters = { search: "", userId: "", action: "", entityType: "", dateFrom: "", dateTo: "" };

const actionLabels: Record<string, string> = {
  USER_CREATED: "إنشاء مستخدم", USER_UPDATED: "تعديل مستخدم", USER_DISABLED: "تعطيل مستخدم", USER_ROLES_REPLACED: "تغيير أدوار مستخدم",
  ROLE_CREATED: "إنشاء دور", ROLE_UPDATED: "تعديل دور", ROLE_PERMISSIONS_REPLACED: "تغيير صلاحيات دور", ROLE_DEACTIVATED: "تعطيل دور",
  RECEIPT_CREATED: "إنشاء سند قبض", RECEIPT_UPDATED: "تعديل سند قبض", POST_RECEIPT: "ترحيل سند قبض", RECEIPT_CANCELLED: "إلغاء سند قبض", REVERSE_RECEIPT: "عكس سند قبض",
  PAYMENT_CREATED: "إنشاء سند صرف", PAYMENT_UPDATED: "تعديل سند صرف", POST_PAYMENT: "ترحيل سند صرف", PAYMENT_CANCELLED: "إلغاء سند صرف", REVERSE_PAYMENT: "عكس سند صرف",
  MANUAL_JOURNAL_CREATED: "إنشاء قيد يومية", MANUAL_JOURNAL_UPDATED: "تعديل قيد يومية", POST_MANUAL_JOURNAL: "ترحيل قيد يومية", MANUAL_JOURNAL_CANCELLED: "إلغاء قيد يومية", REVERSE_MANUAL_JOURNAL: "عكس قيد يومية",
  DOCUMENT_PRINT_ARCHIVED: "أرشفة نسخة طباعة", DOCUMENT_PDF_PRINTED: "طباعة مستند PDF", AUDIT_LOG_EXPORTED: "تصدير سجل التدقيق",
  COMPANY_UPDATED: "تعديل الشركة", COMPANY_SETTING_UPDATED: "تعديل إعدادات الشركة",
  FISCAL_YEAR_CREATED: "إنشاء سنة مالية", FISCAL_YEAR_UPDATED: "تعديل سنة مالية", FISCAL_PERIOD_UPDATED: "تعديل فترة مالية", CLOSE_PERIOD: "إغلاق فترة مالية", REOPEN_PERIOD: "إعادة فتح فترة مالية",
  ACCOUNT_CREATED: "إنشاء حساب", ACCOUNT_UPDATED: "تعديل حساب", ACCOUNT_DEACTIVATED: "تعطيل حساب", COST_CENTER_CREATED: "إنشاء مركز تكلفة", COST_CENTER_UPDATED: "تعديل مركز تكلفة", COST_CENTER_DEACTIVATED: "تعطيل مركز تكلفة",
  CUSTOMER_CREATED: "إنشاء عميل", CUSTOMER_UPDATED: "تعديل عميل", CUSTOMER_DEACTIVATED: "تعطيل عميل", CUSTOMER_ADDRESS_CREATED: "إضافة عنوان عميل", CUSTOMER_ADDRESS_UPDATED: "تعديل عنوان عميل", CUSTOMER_ADDRESS_DELETED: "حذف عنوان عميل",
  SUPPLIER_CREATED: "إنشاء مورد", SUPPLIER_UPDATED: "تعديل مورد", SUPPLIER_DEACTIVATED: "تعطيل مورد", SUPPLIER_ADDRESS_CREATED: "إضافة عنوان مورد", SUPPLIER_ADDRESS_UPDATED: "تعديل عنوان مورد", SUPPLIER_ADDRESS_DELETED: "حذف عنوان مورد",
  CASH_BANK_ACCOUNT_CREATED: "إنشاء حساب خزينة", CASH_BANK_ACCOUNT_UPDATED: "تعديل حساب خزينة", CASH_BANK_ACCOUNT_DEACTIVATED: "تعطيل حساب خزينة", PAYMENT_METHOD_CREATED: "إنشاء طريقة دفع", PAYMENT_METHOD_UPDATED: "تعديل طريقة دفع", PAYMENT_METHOD_DEACTIVATED: "تعطيل طريقة دفع",
};
const entityLabels: Record<string, string> = { USER: "مستخدم", ROLE: "دور", RECEIPT: "سند قبض", PAYMENT: "سند صرف", MANUAL_JOURNAL: "قيد يومية", ACCOUNTING_DOCUMENT: "مستند محاسبي", COMPANY: "شركة", CUSTOMER: "عميل", CUSTOMER_ADDRESS: "عنوان عميل", SUPPLIER: "مورد", SUPPLIER_ADDRESS: "عنوان مورد", ACCOUNT: "حساب", COST_CENTER: "مركز تكلفة", CASH_BANK_ACCOUNT: "حساب خزينة", PAYMENT_METHOD: "طريقة دفع", FISCAL_YEAR: "سنة مالية", FISCAL_PERIOD: "فترة مالية", AUDIT_LOG: "سجل التدقيق" };
const targetFor = (entityType: string): TargetView | null => ({ USER: "admin", ROLE: "admin", COMPANY: "settings", CUSTOMER: "customers", SUPPLIER: "suppliers", RECEIPT: "receipts", PAYMENT: "payments", MANUAL_JOURNAL: "journals", FISCAL_YEAR: "fiscal", FISCAL_PERIOD: "fiscal", ACCOUNT: "accounts", COST_CENTER: "accounts", CASH_BANK_ACCOUNT: "treasury", PAYMENT_METHOD: "treasury" } as Record<string, TargetView>)[entityType] ?? null;

export function AuditLogsPage({ notify, onNavigate }: { notify: Notice; onNavigate: (view: TargetView) => void }) {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [options, setOptions] = useState<AuditOptions>({ actions: [], entityTypes: [], users: [] });
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const queryFor = useCallback((includePage = true) => {
    const query = new URLSearchParams();
    if (includePage) { query.set("page", String(page)); query.set("pageSize", "25"); }
    for (const [key, value] of Object.entries(applied)) if (value) query.set(key, value);
    return query;
  }, [applied, page]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await api<ListResponse<AuditLog>>(`/audit-logs?${queryFor()}`); setRows(result.data); setMeta(result.meta); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل سجل التدقيق."); }
    finally { setLoading(false); }
  }, [queryFor]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void api<AuditOptions>("/audit-logs/options").then(setOptions).catch(() => undefined); }, []);

  function submit(event: FormEvent) { event.preventDefault(); if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) { notify("تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.", "error"); return; } setPage(1); setApplied(draft); }
  function clear() { setDraft(emptyFilters); setApplied(emptyFilters); setPage(1); }
  async function exportCsv() {
    setExporting(true);
    try { await downloadFile(`/audit-logs/export.csv?${queryFor(false)}`, "audit-logs.csv"); notify("تم تجهيز ملف سجل التدقيق للتنزيل."); await load(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "تعذر تصدير سجل التدقيق.", "error"); }
    finally { setExporting(false); }
  }

  return <section className="workspace-page audit-page">
    <header className="page-heading"><div><span className="section-kicker">الحوكمة والمراجعة</span><h1>سجل التدقيق</h1><p>تتبّع العمليات المالية والإدارية داخل الشركة مع تفاصيل الفاعل والكيان والتوقيت.</p></div><Button variant="secondary" icon="arrowDown" disabled={exporting} onClick={() => void exportCsv()}>{exporting ? "جارٍ التصدير…" : "تصدير CSV"}</Button></header>
    <form className="audit-filters" onSubmit={submit}>
      <label className="audit-search"><span>بحث</span><input value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="الإجراء أو الكيان أو المعرّف أو المستخدم" /></label>
      <label><span>المستخدم</span><select value={draft.userId} onChange={(event) => setDraft({ ...draft, userId: event.target.value })}><option value="">كل المستخدمين</option>{options.users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label>
      <label><span>الإجراء</span><select value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })}><option value="">كل الإجراءات</option>{options.actions.map((action) => <option key={action} value={action}>{actionLabels[action] ?? action}</option>)}</select></label>
      <label><span>نوع الكيان</span><select value={draft.entityType} onChange={(event) => setDraft({ ...draft, entityType: event.target.value })}><option value="">كل الكيانات</option>{options.entityTypes.map((entity) => <option key={entity} value={entity}>{entityLabels[entity] ?? entity}</option>)}</select></label>
      <label><span>من تاريخ</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} /></label>
      <label><span>إلى تاريخ</span><input type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} /></label>
      <div className="audit-filter-actions"><Button type="submit">تطبيق</Button><Button type="button" variant="ghost" onClick={clear}>مسح</Button></div>
    </form>
    {error ? <div className="error-panel"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>إعادة المحاولة</Button></div> : loading ? <Spinner label="جارٍ تحميل سجل التدقيق" /> : !rows.length ? <EmptyState title="لا توجد أحداث مطابقة" description="غيّر معايير البحث أو النطاق الزمني لعرض أحداث أخرى." /> : <>
      <div className="data-table-wrap"><table className="data-table audit-table"><thead><tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>الكيان</th><th>المعرّف</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="audit-time">{new Date(row.createdAt).toLocaleString("ar-SA")}</td><td><strong>{row.actor.name}</strong><small dir="ltr">{row.actor.email}</small></td><td><span className="audit-action">{actionLabels[row.action] ?? row.action}</span><small dir="ltr">{row.action}</small></td><td>{entityLabels[row.entityType] ?? row.entityType}</td><td dir="ltr">#{row.entityId}</td><td><Button variant="ghost" onClick={() => setSelected(row)}>التفاصيل</Button></td></tr>)}</tbody></table></div>
      <Pagination {...meta} page={page} onChange={setPage} />
    </>}
    {selected && <AuditDetails item={selected} onClose={() => setSelected(null)} onNavigate={(view) => { setSelected(null); onNavigate(view); }} />}
  </section>;
}

function AuditDetails({ item, onClose, onNavigate }: { item: AuditLog; onClose: () => void; onNavigate: (view: TargetView) => void }) {
  const target = targetFor(item.entityType);
  return <Modal title={actionLabels[item.action] ?? item.action} description={`حدث التدقيق #${item.id}`} onClose={onClose} wide>
    <dl className="detail-grid audit-detail-grid"><div><dt>التاريخ والوقت</dt><dd>{new Date(item.createdAt).toLocaleString("ar-SA")}</dd></div><div><dt>المستخدم</dt><dd>{item.actor.name}<small dir="ltr">{item.actor.email}</small></dd></div><div><dt>نوع الكيان</dt><dd>{entityLabels[item.entityType] ?? item.entityType}</dd></div><div><dt>معرّف الكيان</dt><dd dir="ltr">{item.entityId}</dd></div><div className="full"><dt>رمز الإجراء</dt><dd dir="ltr">{item.action}</dd></div></dl>
    <section className="audit-details-json"><h3>البيانات التفصيلية</h3>{item.details ? <pre dir="ltr">{JSON.stringify(item.details, null, 2)}</pre> : <p>لم تُسجل بيانات إضافية لهذا الحدث.</p>}</section>
    <div className="form-actions">{target && <Button variant="secondary" onClick={() => onNavigate(target)}>فتح الوحدة المرتبطة</Button>}<Button variant="ghost" onClick={onClose}>إغلاق</Button></div>
  </Modal>;
}
