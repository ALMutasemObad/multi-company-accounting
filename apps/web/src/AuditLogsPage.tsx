import {
  dictionaries,
  translate as t,
  type TranslationKey } from "./i18n";
import { FormEvent,
  useCallback,
  useEffect,
  useState } from "react";
import { api,
  downloadFile } from "./api";
import type { AuditLog,
  AuditOptions,
  ListResponse } from "./types";
import { Button,
  EmptyState,
  Modal,
  Pagination,
  Spinner,
  PageHeader,
} from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Filters = { search: string; userId: string; action: string; entityType: string; dateFrom: string; dateTo: string };
type TargetView = "admin" | "settings" | "customers" | "suppliers" | "receipts" | "payments" | "journals" | "fiscal" | "accounts" | "treasury" | "inventory";
const emptyFilters: Filters = { search: "", userId: "", action: "", entityType: "", dateFrom: "", dateTo: "" };

function codedLabel(scope: "action" | "entity", code: string) {
  const key = `audit.${scope}.${code}`;
  return Object.hasOwn(dictionaries.ar, key) ? t(key as TranslationKey) : code;
}
const actionLabel = (code: string) => codedLabel("action", code);
const entityLabel = (code: string) => codedLabel("entity", code);
const targetFor = (entityType: string): TargetView | null => ({ USER: "admin", ROLE: "admin", COMPANY: "settings", CUSTOMER: "customers", SUPPLIER: "suppliers", RECEIPT: "receipts", PAYMENT: "payments", MANUAL_JOURNAL: "journals", FISCAL_YEAR: "fiscal", FISCAL_PERIOD: "fiscal", ACCOUNT: "accounts", COST_CENTER: "accounts", CASH_BANK_ACCOUNT: "treasury", PAYMENT_METHOD: "treasury", WAREHOUSE: "inventory" } as Record<string, TargetView>)[entityType] ?? null;

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
    catch (cause) { setError(cause instanceof Error ? cause.message : t("pages.audit-logs.001")); }
    finally { setLoading(false); }
  }, [queryFor]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void api<AuditOptions>("/audit-logs/options").then(setOptions).catch(() => undefined); }, []);

  function submit(event: FormEvent) { event.preventDefault(); if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) { notify(t("pages.audit-logs.002"), "error"); return; } setPage(1); setApplied(draft); }
  function clear() { setDraft(emptyFilters); setApplied(emptyFilters); setPage(1); }
  async function exportCsv() {
    setExporting(true);
    try { await downloadFile(`/audit-logs/export.csv?${queryFor(false)}`, "audit-logs.csv"); notify(t("pages.audit-logs.003")); await load(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : t("pages.audit-logs.004"), "error"); }
    finally { setExporting(false); }
  }

  return <section className="workspace-page audit-page">
    <PageHeader kicker={t("pages.audit-logs.005")} title={t("pages.audit-logs.006")} description={t("pages.audit-logs.007")} actions={<Button variant="secondary" icon="arrowDown" disabled={exporting} onClick={() => void exportCsv()}>{exporting ? t("pages.audit-logs.008") : t("pages.audit-logs.009")}</Button>} />
    <form className="audit-filters" onSubmit={submit}>
      <label className="audit-search"><span>{t("pages.accounts.026")}</span><input value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder={t("pages.audit-logs.011")} /></label>
      <label><span>{t("pages.admin.021")}</span><select value={draft.userId} onChange={(event) => setDraft({ ...draft, userId: event.target.value })}><option value="">{t("pages.audit-logs.013")}</option>{options.users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label>
      <label><span>{t("pages.audit-logs.014")}</span><select value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })}><option value="">{t("pages.audit-logs.015")}</option>{options.actions.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}</select></label>
      <label><span>{t("pages.audit-logs.016")}</span><select value={draft.entityType} onChange={(event) => setDraft({ ...draft, entityType: event.target.value })}><option value="">{t("pages.audit-logs.017")}</option>{options.entityTypes.map((entity) => <option key={entity} value={entity}>{entityLabel(entity)}</option>)}</select></label>
      <label><span>{t("pages.audit-logs.018")}</span><input type="date" value={draft.dateFrom} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })} /></label>
      <label><span>{t("pages.audit-logs.019")}</span><input type="date" value={draft.dateTo} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })} /></label>
      <div className="audit-filter-actions"><Button type="submit">{t("pages.audit-logs.020")}</Button><Button type="button" variant="ghost" onClick={clear}>{t("pages.audit-logs.021")}</Button></div>
    </form>
    {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{t("pages.accounts.030")}</Button></div> : loading ? <Spinner label={t("pages.audit-logs.023")} /> : !rows.length ? <EmptyState title={t("pages.audit-logs.024")} description={t("pages.audit-logs.025")} /> : <>
      <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table audit-table"><thead><tr><th>{t("pages.audit-logs.026")}</th><th>{t("pages.admin.021")}</th><th>{t("pages.audit-logs.014")}</th><th>{t("pages.audit-logs.027")}</th><th>{t("pages.audit-logs.028")}</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="audit-time">{new Date(row.createdAt).toLocaleString()}</td><td><strong>{row.actor.name}</strong><small dir="ltr">{row.actor.email}</small></td><td><span className="audit-action">{actionLabel(row.action)}</span><small dir="ltr">{row.action}</small></td><td>{entityLabel(row.entityType)}</td><td dir="ltr">#{row.entityId}</td><td><Button variant="ghost" onClick={() => setSelected(row)}>{t("pages.audit-logs.029")}</Button></td></tr>)}</tbody></table></div>
      <Pagination {...meta} page={page} onChange={setPage} />
    </>}
    {selected && <AuditDetails item={selected} onClose={() => setSelected(null)} onNavigate={(view) => { setSelected(null); onNavigate(view); }} />}
  </section>;
}

function AuditDetails({ item, onClose, onNavigate }: { item: AuditLog; onClose: () => void; onNavigate: (view: TargetView) => void }) {
  const target = targetFor(item.entityType);
  return <Modal title={actionLabel(item.action)} description={t("pages.audit-logs.030", { value1: item.id })} onClose={onClose} wide>
    <dl className="detail-grid audit-detail-grid"><div><dt>{t("pages.audit-logs.031")}</dt><dd>{new Date(item.createdAt).toLocaleString()}</dd></div><div><dt>{t("pages.admin.021")}</dt><dd>{item.actor.name}<small dir="ltr">{item.actor.email}</small></dd></div><div><dt>{t("pages.audit-logs.016")}</dt><dd>{entityLabel(item.entityType)}</dd></div><div><dt>{t("pages.audit-logs.032")}</dt><dd dir="ltr">{item.entityId}</dd></div><div className="full"><dt>{t("pages.audit-logs.033")}</dt><dd dir="ltr">{item.action}</dd></div></dl>
    <section className="audit-details-json"><h3>{t("pages.audit-logs.034")}</h3>{item.details ? <pre dir="ltr">{JSON.stringify(item.details, null, 2)}</pre> : <p>{t("pages.audit-logs.035")}</p>}</section>
    <div className="form-actions">{target && <Button variant="secondary" onClick={() => onNavigate(target)}>{t("pages.audit-logs.036")}</Button>}<Button variant="ghost" onClick={onClose}>{t("pages.audit-logs.037")}</Button></div>
  </Modal>;
}
