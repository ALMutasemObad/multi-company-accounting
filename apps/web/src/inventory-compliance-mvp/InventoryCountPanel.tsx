import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, idempotencyKey } from "../api";
import { activeIntlLocale, localizedCopyFor, useI18n } from "../i18n";
import { inventoryCountCopy } from "../i18n/locales/inventory-count";
import type { ListResponse, Warehouse } from "../types";
import { Button, EmptyState, Modal, Spinner } from "../ui";
import "./inventory-count.css";

type Notice = (message: string, tone?: "success" | "error") => void;
type CountStatus = "DRAFT" | "SUBMITTED" | "APPROVED";
type CountSession = {
  id: string; warehouseId: string; countDate: string; snapshotAt: string; status: CountStatus; version: number;
  cutoff: { receipt: { id: string; number: string } | null; issue: { id: string; number: string } | null };
  approvedByName: string | null;
};
type CountLine = {
  id: string; code: string; title: string; unitCode: string; location: string | null; shelf: string | null;
  bookQuantity: string; countedQuantity: string | null; varianceQuantity: string | null; varianceReason: string | null; version: number;
};
type Summary = { total: number; counted: number; remaining: number; surplus: number; shortage: number; conflicts: number };
type Draft = { quantity: string; reason: string; version: number };
type InventoryCountLocalizedCopy = { [Key in keyof typeof inventoryCountCopy.ar]: string };
const emptySummary: Summary = { total: 0, counted: 0, remaining: 0, surplus: 0, shortage: 0, conflicts: 0 };
const today = () => new Date().toISOString().slice(0, 10);

export function InventoryCountPanel({ notify }: { notify: Notice }) {
  const { locale } = useI18n();
  const copy = localizedCopyFor(inventoryCountCopy, locale, "ar");
  const statusLabel: Record<CountStatus, string> = { DRAFT: copy.statusDraft, SUBMITTED: copy.statusSubmitted, APPROVED: copy.statusApproved };
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [sessions, setSessions] = useState<CountSession[]>([]);
  const [session, setSession] = useState<CountSession | null>(null);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const quantityInputs = useRef(new Map<string, HTMLInputElement>());

  const loadReferences = useCallback(async () => {
    try {
      const [warehouseResult, sessionResult] = await Promise.all([
        api<ListResponse<Warehouse>>("/warehouses?page=1&pageSize=100&active=true"),
        api<{ data: CountSession[] }>("/inventory-count-sessions"),
      ]);
      setWarehouses(warehouseResult.data); setSessions(sessionResult.data);
      setSession((current) => current ?? sessionResult.data[0] ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.sessionsLoadError); }
    finally { setLoading(false); }
  }, [copy.sessionsLoadError]);

  const loadLines = useCallback(async () => {
    if (!session) { setLines([]); setSummary(emptySummary); return; }
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "50", ...(submittedSearch ? { search: submittedSearch } : {}) });
      const result = await api<{ data: CountLine[]; summary: Summary }>(`/inventory-count-sessions/${session.id}/lines?${query}`);
      setLines(result.data); setSummary(result.summary); setConflicts(new Set());
      setDrafts(Object.fromEntries(result.data.map((line) => [line.id, { quantity: line.countedQuantity ?? "", reason: line.varianceReason ?? "", version: line.version }])));
      setDirty(new Set());
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.linesLoadError); }
    finally { setLoading(false); }
  }, [copy.linesLoadError, page, session, submittedSearch]);

  useEffect(() => { void loadReferences(); }, [loadReferences]);
  useEffect(() => { void loadLines(); }, [loadLines]);

  const saveRows = useCallback(async (ids?: string[]) => {
    if (!session || session.status !== "DRAFT") return false;
    const targets = (ids ?? [...dirty]).filter((id) => dirty.has(id) && drafts[id]?.quantity.trim());
    if (!targets.length) return true;
    setSaving(true); setError("");
    try {
      const result = await api<{ conflicts: Array<{ lineId: string }>; summary: Summary }>(`/inventory-count-sessions/${session.id}/counts`, {
        method: "POST",
        body: JSON.stringify({ rows: targets.map((id) => ({ lineId: id, expectedVersion: drafts[id]!.version, countedQuantity: drafts[id]!.quantity.trim(), varianceReason: drafts[id]!.reason.trim() || null })) }),
      });
      const conflicting = new Set(result.conflicts.map((value) => value.lineId));
      setConflicts(conflicting); setSummary(result.summary);
      if (conflicting.size) { notify(copy.concurrentConflict, "error"); return false; }
      notify(targets.length === 1 ? copy.savedOne : copy.savedMany.replace("{count}", targets.length.toLocaleString(activeIntlLocale())));
      await loadLines(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.saveError); return false; }
    finally { setSaving(false); }
  }, [copy.concurrentConflict, copy.saveError, copy.savedMany, copy.savedOne, dirty, drafts, loadLines, notify, session]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveRows(); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [saveRows]);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }));
    setDirty((current) => new Set(current).add(id));
    setConflicts((current) => { const next = new Set(current); next.delete(id); return next; });
  }
  async function enterSave(event: KeyboardEvent<HTMLInputElement>, index: number, lineId: string) {
    if (event.key !== "Enter") return; event.preventDefault();
    if (await saveRows([lineId])) quantityInputs.current.get(lines[index + 1]?.id ?? "")?.focus();
  }
  async function transition(action: "submit" | "approve", approverName?: string) {
    if (!session) return;
    try {
      const updated = await api<CountSession>(`/inventory-count-sessions/${session.id}/${action}`, { method: "POST", body: JSON.stringify({ expectedVersion: session.version, ...(approverName ? { approverName } : {}) }) });
      setSession(updated); setSessions((current) => current.map((value) => value.id === updated.id ? updated : value)); setShowApprove(false);
      notify(action === "submit" ? copy.submitted : copy.approved); await loadLines();
    } catch (cause) { notify(cause instanceof Error ? cause.message : copy.transitionError, "error"); }
  }

  return <div className="inventory-count-workspace">
    <div className="toolbar treasury-filters inventory-catalog-toolbar">
      <select aria-label={copy.sessionLabel} value={session?.id ?? ""} onChange={(event) => { setPage(1); setSession(sessions.find((value) => value.id === event.target.value) ?? null); }}><option value="">{copy.chooseSession}</option>{sessions.map((value) => <option key={value.id} value={value.id}>{value.countDate} · {statusLabel[value.status]} · #{value.id}</option>)}</select>
      <form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedSearch(search.trim()); }}><input aria-label={copy.searchLabel} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} /><button type="submit">{copy.search}</button></form>
      <Button icon="plus" onClick={() => setShowCreate(true)}>{copy.newSession}</Button>
    </div>
    {session && <><div className="detail-grid"><div><span>{copy.state}</span><strong>{statusLabel[session.status]}</strong></div><div><span>{copy.countDate}</span><strong dir="ltr">{session.countDate}</strong></div><div><span>{copy.lastReceipt}</span><strong dir="ltr">{session.cutoff.receipt?.number ?? "—"}</strong></div><div><span>{copy.lastIssue}</span><strong dir="ltr">{session.cutoff.issue?.number ?? "—"}</strong></div></div><div className="summary-cards"><SummaryCard label={copy.totalItems} value={summary.total} /><SummaryCard label={copy.counted} value={summary.counted} /><SummaryCard label={copy.remaining} value={summary.remaining} /><SummaryCard label={copy.surplus} value={summary.surplus} /><SummaryCard label={copy.shortage} value={summary.shortage} /><SummaryCard label={copy.conflicts} value={conflicts.size || summary.conflicts} /></div></>}
    {conflicts.size > 0 && <div className="inline-notice" role="alert">{copy.conflictAlert}<Button variant="secondary" onClick={() => void loadLines()}>{copy.reload}</Button></div>}
    {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void loadLines()}>{copy.retry}</Button></div> : loading ? <Spinner label={copy.loading} /> : !session ? <EmptyState title={copy.noSession} description={copy.noSessionDescription} /> : !lines.length ? <EmptyState title={copy.noLines} description={copy.noLinesDescription} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={copy.tableLabel}><table className="data-table"><thead><tr><th>{copy.item}</th><th>{copy.location}</th><th>{copy.shelf}</th><th>{copy.bookQuantity}</th><th>{copy.countedQuantity}</th><th>{copy.variance}</th><th>{copy.varianceReason}</th></tr></thead><tbody>{lines.map((line, index) => { const draft = drafts[line.id]; const variance = draft?.quantity ? Number(draft.quantity) - Number(line.bookQuantity) : line.varianceQuantity === null ? null : Number(line.varianceQuantity); return <tr key={line.id} className={conflicts.has(line.id) ? "row-conflict" : dirty.has(line.id) ? "row-pending" : ""}><td><strong>{line.title}</strong><small dir="ltr">{line.code} · {line.unitCode}</small></td><td>{line.location ?? "—"}</td><td>{line.shelf ?? "—"}</td><td dir="ltr">{Number(line.bookQuantity).toLocaleString(activeIntlLocale(), { maximumFractionDigits: 6 })}</td><td><input ref={(node) => { if (node) quantityInputs.current.set(line.id, node); else quantityInputs.current.delete(line.id); }} aria-label={copy.countedQuantityFor.replace("{title}", line.title)} dir="ltr" inputMode="decimal" value={draft?.quantity ?? ""} disabled={session.status !== "DRAFT" || saving} onChange={(event) => updateDraft(line.id, { quantity: event.target.value })} onKeyDown={(event) => void enterSave(event, index, line.id)} pattern="[0-9]{1,13}([.][0-9]{1,6})?" /></td><td dir="ltr" className={variance && variance !== 0 ? "variance-cell" : ""}>{variance === null ? "—" : variance.toLocaleString(activeIntlLocale(), { maximumFractionDigits: 6 })}</td><td><input aria-label={copy.varianceReasonFor.replace("{title}", line.title)} value={draft?.reason ?? ""} disabled={session.status !== "DRAFT" || saving} required={Boolean(variance)} onChange={(event) => updateDraft(line.id, { reason: event.target.value })} maxLength={500} placeholder={variance ? copy.reasonRequired : "—"} /></td></tr>; })}</tbody></table></div>}
    {session && <div className="form-actions"><Button variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy.previous}</Button><span>{copy.page.replace("{page}", page.toLocaleString(activeIntlLocale()))}</span><Button variant="ghost" disabled={lines.length < 50} onClick={() => setPage((value) => value + 1)}>{copy.next}</Button>{session.status === "DRAFT" && <><Button variant="secondary" disabled={saving || dirty.size === 0} onClick={() => void saveRows()}>{saving ? copy.saving : copy.save.replace("{count}", dirty.size.toLocaleString(activeIntlLocale()))}</Button><Button disabled={summary.remaining > 0 || dirty.size > 0 || conflicts.size > 0} onClick={() => void transition("submit")}>{copy.submit}</Button></>}{session.status === "SUBMITTED" && <Button onClick={() => setShowApprove(true)}>{copy.approveCount}</Button>}</div>}
    {showCreate && <CreateSessionForm copy={copy} warehouses={warehouses} onClose={() => setShowCreate(false)} onSaved={async (created) => { setShowCreate(false); await loadReferences(); setSession(created); notify(copy.created); }} />}
    {showApprove && session && <ApproveForm copy={copy} onClose={() => setShowApprove(false)} onApprove={(name) => transition("approve", name)} />}
  </div>;
}

function SummaryCard({ label, value }: { label: string; value: number }) { return <div className="summary-card"><span>{label}</span><strong>{value.toLocaleString(activeIntlLocale())}</strong></div>; }

function CreateSessionForm({ copy, warehouses, onClose, onSaved }: { copy: InventoryCountLocalizedCopy; warehouses: Warehouse[]; onClose: () => void; onSaved: (session: CountSession) => Promise<void> }) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? ""); const [countDate, setCountDate] = useState(today()); const [committee, setCommittee] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); const names = committee.split(/[\u060c,\n]/u).map((name) => name.trim()).filter(Boolean); if (!names.length) { setError(copy.committeeRequired); return; } setSaving(true); setError(""); try { const created = await api<CountSession>("/inventory-count-sessions", { method: "POST", idempotencyKey: idempotencyKey("inventory-count", crypto.randomUUID()), body: JSON.stringify({ warehouseId, countDate, committee: names.map((name) => ({ name, role: copy.committeeDefaultRole })) }) }); await onSaved(created); } catch (cause) { setError(cause instanceof Error ? cause.message : copy.createError); } finally { setSaving(false); } }
  return <Modal title={copy.createTitle} description={copy.createDescription} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><label><span>{copy.warehouse}</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.nameAr}</option>)}</select></label><label><span>{copy.countDate}</span><input type="date" value={countDate} onChange={(event) => setCountDate(event.target.value)} required /></label><label className="full"><span>{copy.committeeNames}</span><textarea value={committee} onChange={(event) => setCommittee(event.target.value)} rows={3} placeholder={copy.committeePlaceholder} required /></label></div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{copy.cancel}</Button><Button type="submit" disabled={saving || !warehouseId}>{saving ? copy.creating : copy.create}</Button></div></form></Modal>;
}

function ApproveForm({ copy, onClose, onApprove }: { copy: InventoryCountLocalizedCopy; onClose: () => void; onApprove: (name: string) => Promise<void> }) {
  const [name, setName] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { await onApprove(name.trim()); } finally { setSaving(false); } }
  return <Modal title={copy.approvalTitle} description={copy.approvalDescription} onClose={onClose}><form className="document-form" onSubmit={submit}><label><span>{copy.approverName}</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required /></label><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{copy.cancel}</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? copy.approving : copy.approve}</Button></div></form></Modal>;
}
