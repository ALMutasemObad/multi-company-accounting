import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, downloadFile } from "../api";
import { activeIntlLocale, localizedCopyFor, useI18n } from "../i18n";
import { inventoryCountCopy } from "../i18n/locales/inventory-count";
import type { InventoryItem, ListResponse, ResolvedInventoryBarcode, UnitOfMeasure, Warehouse } from "../types";
import { Button, EmptyState, Modal, Spinner } from "../ui";
import "./inventory-count.css";
import { inventoryClientId, inventoryRequestKey } from "./inventory-client-id";

type Notice = (message: string, tone?: "success" | "error") => void;
type CountStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "SETTLED";
type CountSession = {
  id: string; warehouseId: string; countDate: string; snapshotAt: string; status: CountStatus; version: number;
  cutoff: { receipt: { id: string; number: string } | null; issue: { id: string; number: string } | null };
  approvedByName: string | null;
  settlement: { date: string; settledAt: string; surplusMovementId: string | null; shortageMovementId: string | null } | null;
};
type CountLine = {
  id: string; inventoryItemId: string; code: string; barcode: string | null; title: string; unitCode: string; location: string | null; shelf: string | null;
  bookQuantity: string; bookUnitCostBase: string; countedQuantity: string | null; varianceQuantity: string | null; varianceReason: string | null; version: number;
};
type Summary = { total: number; counted: number; remaining: number; surplus: number; shortage: number; conflicts: number };
type VarianceReasonCode = "" | "DAMAGED" | "MISSING" | "MISPLACED" | "BOOK_ERROR" | "UNRECORDED_RECEIPT" | "UNRECORDED_ISSUE" | "DUPLICATE_COUNT" | "OTHER";
type Draft = { quantity: string; reasonCode: VarianceReasonCode; reasonDetails: string; version: number };
type InventoryCountLocalizedCopy = { [Key in keyof typeof inventoryCountCopy.ar]: string };
const emptySummary: Summary = { total: 0, counted: 0, remaining: 0, surplus: 0, shortage: 0, conflicts: 0 };
const today = () => new Date().toISOString().slice(0, 10);
const quantityPattern = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/u;
const normalizeQuantity = (value: string) => value
  .replace(/[\u0660-\u0669]/gu, (digit) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(digit)))
  .replace(/[\u06f0-\u06f9]/gu, (digit) => String("\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9".indexOf(digit)))
  .replace(/[\u066c,\s]/gu, "")
  .replace(/\u066b/gu, ".");
const varianceReasonCodes: Exclude<VarianceReasonCode, "">[] = ["DAMAGED", "MISSING", "MISPLACED", "BOOK_ERROR", "UNRECORDED_RECEIPT", "UNRECORDED_ISSUE", "DUPLICATE_COUNT", "OTHER"];
const countEntryPermission = "inventory_counts.enter";
const countManagePermission = "inventory_counts.manage";
function parseVarianceReason(value: string | null): Pick<Draft, "reasonCode" | "reasonDetails"> {
  if (!value) return { reasonCode: "", reasonDetails: "" };
  const [code, ...details] = value.split(":");
  if (varianceReasonCodes.includes(code as Exclude<VarianceReasonCode, "">)) return { reasonCode: code as VarianceReasonCode, reasonDetails: details.join(":").trim() };
  return { reasonCode: "OTHER", reasonDetails: value };
}
function serializeVarianceReason(draft: Draft) {
  if (!draft.reasonCode) return null;
  return draft.reasonCode === "OTHER" ? `OTHER: ${draft.reasonDetails.trim()}` : draft.reasonCode;
}

export function InventoryCountPanel({ notify, canEnter, canManage }: { notify: Notice; canEnter: boolean; canManage: boolean }) {
  const { locale } = useI18n();
  const copy = localizedCopyFor(inventoryCountCopy, locale, "ar");
  const statusLabel: Record<CountStatus, string> = { DRAFT: copy.statusDraft, SUBMITTED: copy.statusSubmitted, APPROVED: copy.statusApproved, SETTLED: copy.statusSettled };
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
  const [showSettle, setShowSettle] = useState(false);
  const [invalidRows, setInvalidRows] = useState<Set<string>>(new Set());
  const quantityInputs = useRef(new Map<string, HTMLInputElement>());
  const reasonInputs = useRef(new Map<string, HTMLElement>());

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
    if (!session || !canManage) { setLines([]); setSummary(emptySummary); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "50", ...(submittedSearch ? { search: submittedSearch } : {}) });
      const result = await api<{ data: CountLine[]; summary: Summary }>(`/inventory-count-sessions/${session.id}/lines?${query}`);
      setLines(result.data); setSummary(result.summary); setConflicts(new Set());
      setDrafts(Object.fromEntries(result.data.map((line) => [line.id, { quantity: line.countedQuantity ?? "", ...parseVarianceReason(line.varianceReason), version: line.version }])));
      setDirty(new Set());
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.linesLoadError); }
    finally { setLoading(false); }
  }, [canManage, copy.linesLoadError, page, session, submittedSearch]);

  useEffect(() => { void loadReferences(); }, [loadReferences]);
  useEffect(() => { void loadLines(); }, [loadLines]);

  const saveRows = useCallback(async (ids?: string[]) => {
    if (!session || session.status !== "DRAFT") return false;
    const targets = (ids ?? [...dirty]).filter((id) => dirty.has(id));
    if (!targets.length) return true;
    const invalidQuantityId = targets.find((id) => !quantityPattern.test(drafts[id]?.quantity.trim() ?? ""));
    if (invalidQuantityId) {
      setInvalidRows(new Set([invalidQuantityId])); setError(copy.invalidQuantity);
      quantityInputs.current.get(invalidQuantityId)?.focus(); return false;
    }
    const missingReasonId = targets.find((id) => {
      const line = lines.find((value) => value.id === id);
      const draft = drafts[id];
      return line && draft && Number(draft.quantity) !== Number(line.bookQuantity) && (!draft.reasonCode || (draft.reasonCode === "OTHER" && !draft.reasonDetails.trim()));
    });
    if (missingReasonId) {
      setInvalidRows(new Set([missingReasonId])); setError(copy.varianceReasonMissing);
      reasonInputs.current.get(missingReasonId)?.focus(); return false;
    }
    setInvalidRows(new Set());
    setSaving(true); setError("");
    try {
      const result = await api<{ conflicts: Array<{ lineId: string }>; summary: Summary }>(`/inventory-count-sessions/${session.id}/counts`, {
        method: "POST",
        body: JSON.stringify({ rows: targets.map((id) => ({ lineId: id, expectedVersion: drafts[id]!.version, countedQuantity: drafts[id]!.quantity.trim(), varianceReason: serializeVarianceReason(drafts[id]!) })) }),
      });
      const conflicting = new Set(result.conflicts.map((value) => value.lineId));
      setConflicts(conflicting); setSummary(result.summary);
      if (conflicting.size) { notify(copy.concurrentConflict, "error"); return false; }
      notify(targets.length === 1 ? copy.savedOne : copy.savedMany.replace("{count}", targets.length.toLocaleString(activeIntlLocale())));
      await loadLines(); return true;
    } catch (cause) {
      setError(cause instanceof ApiError && cause.reason === "INVALID_VARIANCE_REASON"
        ? copy.varianceReasonMissing
        : cause instanceof ApiError && cause.reason === "INVALID_COUNT"
          ? copy.invalidQuantity
          : cause instanceof Error ? cause.message : copy.saveError);
      return false;
    }
    finally { setSaving(false); }
  }, [copy.concurrentConflict, copy.invalidQuantity, copy.saveError, copy.savedMany, copy.savedOne, copy.varianceReasonMissing, dirty, drafts, lines, loadLines, notify, session]);

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
    setInvalidRows((current) => { const next = new Set(current); next.delete(id); return next; });
    setError("");
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
      {canManage && <form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedSearch(search.trim()); }}><input aria-label={copy.searchLabel} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} /><button type="submit">{copy.search}</button></form>}
      {canManage && <Button icon="plus" onClick={() => setShowCreate(true)}>{copy.newSession}</Button>}
    </div>
    {!canEnter && !canManage && <div className="inline-notice neutral inventory-count-access-notice" role="status">
      <strong>{copy.noCountAccess}</strong>
      <ul>
        <li><code dir="ltr">{countEntryPermission}</code> — {copy.countEntryPermissionDescription}</li>
        <li><code dir="ltr">{countManagePermission}</code> — {copy.countManagePermissionDescription}</li>
      </ul>
      <p>{copy.permissionsRefreshHint}</p>
    </div>}
    {canManage && session && <><div className="detail-grid"><div><span>{copy.state}</span><strong>{statusLabel[session.status]}</strong></div><div><span>{copy.countDate}</span><strong dir="ltr">{session.countDate}</strong></div><div><span>{copy.lastReceipt}</span><strong dir="ltr">{session.cutoff?.receipt?.number ?? "—"}</strong></div><div><span>{copy.lastIssue}</span><strong dir="ltr">{session.cutoff?.issue?.number ?? "—"}</strong></div></div><div className="summary-cards"><SummaryCard label={copy.totalItems} value={summary.total} /><SummaryCard label={copy.counted} value={summary.counted} /><SummaryCard label={copy.remaining} value={summary.remaining} /><SummaryCard label={copy.surplus} value={summary.surplus} /><SummaryCard label={copy.shortage} value={summary.shortage} /><SummaryCard label={copy.conflicts} value={conflicts.size || summary.conflicts} /></div></>}
    {canEnter && session?.status === "DRAFT" && <QuickCountStation copy={copy} session={session} notify={notify} onSaved={canManage ? loadLines : async () => undefined} />}
    {conflicts.size > 0 && <div className="inline-notice" role="alert">{copy.conflictAlert}<Button variant="secondary" onClick={() => void loadLines()}>{copy.reload}</Button></div>}
    {error && <div className="error-panel" role="alert"><p>{error}</p>{lines.length === 0 && <Button variant="secondary" onClick={() => void loadLines()}>{copy.retry}</Button>}</div>}
    {canManage && (loading ? <Spinner label={copy.loading} /> : !session ? <EmptyState title={copy.noSession} description={copy.noSessionDescription} /> : !lines.length ? <EmptyState title={copy.noLines} description={copy.noLinesDescription} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={copy.tableLabel}><table className="data-table"><thead><tr><th>{copy.item}</th><th>{copy.location}</th><th>{copy.shelf}</th><th>{copy.bookQuantity}</th><th>{copy.countedQuantity}</th><th>{copy.variance}</th><th>{copy.varianceReason}</th></tr></thead><tbody>{lines.map((line, index) => {
      const draft = drafts[line.id];
      const variance = draft?.quantity ? Number(draft.quantity) - Number(line.bookQuantity) : line.varianceQuantity === null ? null : Number(line.varianceQuantity);
      return <tr key={line.id} className={conflicts.has(line.id) || invalidRows.has(line.id) ? "row-conflict" : dirty.has(line.id) ? "row-pending" : ""}>
        <td><strong>{line.title}</strong><small dir="ltr">{line.barcode ?? "—"} · {line.unitCode}</small></td>
        <td>{line.location ?? "—"}</td><td>{line.shelf ?? "—"}</td>
        <td dir="ltr">{Number(line.bookQuantity).toLocaleString(activeIntlLocale(), { maximumFractionDigits: 6 })}</td>
        <td><input ref={(node) => { if (node) quantityInputs.current.set(line.id, node); else quantityInputs.current.delete(line.id); }} aria-label={copy.countedQuantityFor.replace("{title}", line.title)} dir="ltr" inputMode="decimal" value={draft?.quantity ?? ""} disabled={session.status !== "DRAFT" || saving} onChange={(event) => updateDraft(line.id, { quantity: normalizeQuantity(event.target.value) })} onKeyDown={(event) => void enterSave(event, index, line.id)} pattern="[0-9]{1,13}([.][0-9]{1,6})?" /></td>
        <td dir="ltr" className={variance && variance !== 0 ? "variance-cell" : ""}>{variance === null ? "—" : variance.toLocaleString(activeIntlLocale(), { maximumFractionDigits: 6 })}</td>
        <td><select ref={(node) => { if (node) reasonInputs.current.set(line.id, node); else reasonInputs.current.delete(line.id); }} aria-label={copy.varianceReasonFor.replace("{title}", line.title)} value={draft?.reasonCode ?? ""} disabled={session.status !== "DRAFT" || saving || !variance} required={Boolean(variance)} onChange={(event) => updateDraft(line.id, { reasonCode: event.target.value as VarianceReasonCode, reasonDetails: event.target.value === "OTHER" ? draft?.reasonDetails ?? "" : "" })}><option value="">{variance ? copy.chooseReason : "—"}</option>{varianceReasonCodes.map((code) => <option key={code} value={code}>{copy[`reason${code}` as keyof InventoryCountLocalizedCopy]}</option>)}</select>{draft?.reasonCode === "OTHER" && <input aria-label={copy.otherReasonDetails} value={draft.reasonDetails} disabled={session.status !== "DRAFT" || saving} required maxLength={460} placeholder={copy.otherReasonDetails} onChange={(event) => updateDraft(line.id, { reasonDetails: event.target.value })} />}</td>
      </tr>;
    })}</tbody></table></div>)}
    {canManage && session?.status === "DRAFT" && (summary.remaining > 0 || dirty.size > 0 || conflicts.size > 0) && <div className="inline-notice neutral" role="status">{`${copy.remaining}: ${summary.remaining.toLocaleString(activeIntlLocale())} · ${copy.save.replace("{count}", dirty.size.toLocaleString(activeIntlLocale()))} · ${copy.conflicts}: ${conflicts.size.toLocaleString(activeIntlLocale())}`}</div>}
    {canManage && session && <div className="form-actions inventory-count-actions"><Button variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy.previous}</Button><span>{copy.page.replace("{page}", page.toLocaleString(activeIntlLocale()))}</span><Button variant="ghost" disabled={lines.length < 50} onClick={() => setPage((value) => value + 1)}>{copy.next}</Button><Button variant="secondary" onClick={() => void downloadFile(`/inventory-count-sessions/${session.id}/report.xlsx`, `inventory-count-${session.id}.xlsx`)}>{copy.downloadReport}</Button><Button variant="secondary" onClick={() => window.print()}>{copy.printReport}</Button>{session.status === "DRAFT" && <><Button variant="secondary" disabled={saving || dirty.size === 0} onClick={() => void saveRows()}>{saving ? copy.saving : copy.save.replace("{count}", dirty.size.toLocaleString(activeIntlLocale()))}</Button><Button disabled={summary.remaining > 0 || dirty.size > 0 || conflicts.size > 0} onClick={() => void transition("submit")}>{copy.submit}</Button></>}{session.status === "SUBMITTED" && <Button onClick={() => setShowApprove(true)}>{copy.approveCount}</Button>}{session.status === "APPROVED" && <Button onClick={() => setShowSettle(true)}>{copy.settleCount}</Button>}</div>}
    {showCreate && <CreateSessionForm copy={copy} warehouses={warehouses} onClose={() => setShowCreate(false)} onSaved={async (created) => { setShowCreate(false); await loadReferences(); setSession(created); notify(copy.created); }} />}
    {showApprove && session && <ApproveForm copy={copy} onClose={() => setShowApprove(false)} onApprove={(name) => transition("approve", name)} />}
    {showSettle && session && <SettleForm copy={copy} session={session} lines={lines} onClose={() => setShowSettle(false)} onSettled={async (updated) => { setShowSettle(false); setSession(updated); setSessions((current) => current.map((value) => value.id === updated.id ? updated : value)); notify(copy.settled); await loadLines(); }} />}
  </div>;
}

function SummaryCard({ label, value }: { label: string; value: number }) { return <div className="summary-card"><span>{label}</span><strong>{value.toLocaleString(activeIntlLocale())}</strong></div>; }

function QuickCountStation({ copy, session, notify, onSaved }: { copy: InventoryCountLocalizedCopy; session: CountSession; notify: Notice; onSaved: () => Promise<void> }) {
  const codeRef = useRef<HTMLInputElement>(null); const quantityRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState(""); const [quantity, setQuantity] = useState(""); const [locationReference, setLocationReference] = useState("");
  const [item, setItem] = useState<ResolvedInventoryBarcode["inventoryItem"] | InventoryItem | null>(null);
  const [countedSoFar, setCountedSoFar] = useState<string | null>(null); const [unknownBarcode, setUnknownBarcode] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  async function resolve(event: FormEvent) {
    event.preventDefault(); const value = code.trim(); if (!value) return;
    setBusy(true); setError(""); setUnknownBarcode(""); setItem(null);
    try {
      const resolved = await api<ResolvedInventoryBarcode>("/inventory-barcodes/resolve", { method: "POST", body: JSON.stringify({ value }) });
      setItem(resolved.inventoryItem); queueMicrotask(() => quantityRef.current?.focus());
    } catch {
      setUnknownBarcode(value); setError(copy.unknownCode);
    } finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!item || !quantityPattern.test(quantity)) { setError(copy.invalidQuantity); quantityRef.current?.focus(); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ duplicate: boolean; line: { countedQuantity: string | null } }>(`/inventory-count-sessions/${session.id}/entries`, { method: "POST", body: JSON.stringify({ inventoryItemId: item.id, quantity, locationReference: locationReference.trim() || null, entryKey: inventoryClientId() }) });
      setCountedSoFar(result.line.countedQuantity); notify(copy.entrySaved); setCode(""); setQuantity(""); setItem(null); await onSaved(); queueMicrotask(() => codeRef.current?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.saveError); }
    finally { setBusy(false); }
  }
  return <section className="quick-count-station" aria-labelledby="quick-count-title"><div className="quick-count-heading"><div><h3 id="quick-count-title">{copy.stationTitle}</h3><p>{copy.stationDescription}</p></div><small>{copy.blindCountNote}</small></div>{error && <div className="form-error" role="alert">{error}</div>}<form className="quick-count-grid" onSubmit={item ? save : resolve}><label><span>{copy.barcodeOrCode}</span><input ref={codeRef} dir="ltr" autoComplete="off" value={code} onChange={(event) => { setCode(event.target.value); setItem(null); setError(""); setUnknownBarcode(""); }} autoFocus /></label><label><span>{copy.locationReference}</span><input value={locationReference} onChange={(event) => setLocationReference(event.target.value)} maxLength={200} placeholder={copy.locationReferenceHint} /></label>{item && <><div className="quick-count-item"><strong>{item.nameAr}</strong><span dir="ltr">{code}</span>{countedSoFar !== null && <small>{copy.countedSoFar}: {countedSoFar}</small>}</div><label><span>{copy.batchQuantity}</span><input ref={quantityRef} dir="ltr" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(normalizeQuantity(event.target.value))} /></label></>}<Button type="submit" disabled={busy || !code.trim() || (Boolean(item) && !quantity)}>{item ? copy.addAndNext : copy.resolve}</Button></form>{unknownBarcode && <QuickAddBook copy={copy} barcode={unknownBarcode} onClose={() => { setUnknownBarcode(""); setError(""); queueMicrotask(() => codeRef.current?.focus()); }} onCreated={(created) => { setItem(created); setUnknownBarcode(""); setError(""); notify(copy.addedAndReady); queueMicrotask(() => quantityRef.current?.focus()); }} />}</section>;
}

function QuickAddBook({ copy, barcode, onClose, onCreated }: { copy: InventoryCountLocalizedCopy; barcode: string; onClose: () => void; onCreated: (item: InventoryItem) => void }) {
  const [units, setUnits] = useState<UnitOfMeasure[]>([]); const [unitId, setUnitId] = useState(""); const [title, setTitle] = useState(""); const [author, setAuthor] = useState(""); const [publisher, setPublisher] = useState(""); const [year, setYear] = useState(""); const [edition, setEdition] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { void api<ListResponse<UnitOfMeasure>>("/units-of-measure?page=1&pageSize=100&active=true").then((result) => { setUnits(result.data); setUnitId(result.data[0]?.id ?? ""); }).catch((cause) => setError(cause instanceof Error ? cause.message : copy.createError)); }, [copy.createError]);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { const created = await api<InventoryItem>("/inventory-items", { method: "POST", body: JSON.stringify({ unitOfMeasureId: unitId, nameAr: title.trim(), author: author.trim() || null, publisher: publisher.trim() || null, publicationYear: year ? Number(year) : null, edition: edition.trim() || null, primaryBarcodeValue: barcode, primaryBarcodeSymbology: /^\d{13}$/u.test(barcode) ? "EAN_13" : "CODE_128" }) }); onCreated(created); } catch (cause) { setError(cause instanceof Error ? cause.message : copy.createError); } finally { setSaving(false); } }
  return <Modal title={copy.quickAddTitle} description={barcode} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><label><span>{copy.titleRequired}</span><input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required /></label><label><span>{copy.unitOfMeasure}</span><select value={unitId} onChange={(event) => setUnitId(event.target.value)} required>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} — {unit.nameAr}</option>)}</select></label><label><span>{copy.author}</span><input value={author} onChange={(event) => setAuthor(event.target.value)} /></label><label><span>{copy.publisher}</span><input value={publisher} onChange={(event) => setPublisher(event.target.value)} /></label><label><span>{copy.publicationYear}</span><input type="number" min="1000" max="9999" value={year} onChange={(event) => setYear(event.target.value)} /></label><label><span>{copy.edition}</span><input value={edition} onChange={(event) => setEdition(event.target.value)} /></label></div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{copy.cancel}</Button><Button type="submit" disabled={saving || !unitId || !title.trim()}>{saving ? copy.creating : copy.quickAdd}</Button></div></form></Modal>;
}

function CreateSessionForm({ copy, warehouses, onClose, onSaved }: { copy: InventoryCountLocalizedCopy; warehouses: Warehouse[]; onClose: () => void; onSaved: (session: CountSession) => Promise<void> }) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? ""); const [countDate, setCountDate] = useState(today()); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { const created = await api<CountSession>("/inventory-count-sessions", { method: "POST", idempotencyKey: inventoryRequestKey("inventory-count"), body: JSON.stringify({ warehouseId, countDate }) }); await onSaved(created); } catch (cause) { setError(cause instanceof Error ? cause.message : copy.createError); } finally { setSaving(false); } }
  return <Modal title={copy.createTitle} description={copy.createDescription} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><label><span>{copy.warehouse}</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.nameAr}</option>)}</select></label><label><span>{copy.countDate}</span><input type="date" value={countDate} onChange={(event) => setCountDate(event.target.value)} required /></label></div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{copy.cancel}</Button><Button type="submit" disabled={saving || !warehouseId}>{saving ? copy.creating : copy.create}</Button></div></form></Modal>;
}

function ApproveForm({ copy, onClose, onApprove }: { copy: InventoryCountLocalizedCopy; onClose: () => void; onApprove: (name: string) => Promise<void> }) {
  const [name, setName] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { await onApprove(name.trim()); } finally { setSaving(false); } }
  return <Modal title={copy.approvalTitle} description={copy.approvalDescription} onClose={onClose}><form className="document-form" onSubmit={submit}><label><span>{copy.approverName}</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required /></label><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{copy.cancel}</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? copy.approving : copy.approve}</Button></div></form></Modal>;
}

function SettleForm({ copy, session, lines, onClose, onSettled }: { copy: InventoryCountLocalizedCopy; session: CountSession; lines: CountLine[]; onClose: () => void; onSettled: (session: CountSession) => Promise<void> }) {
  const needsCost = lines.filter((line) => Number(line.varianceQuantity) > 0 && Number(line.bookUnitCostBase) <= 0);
  const [settlementDate, setSettlementDate] = useState(today());
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (needsCost.some((line) => !costs[line.inventoryItemId] || Number(costs[line.inventoryItemId]) <= 0)) { setError(copy.surplusCostRequired); return; }
    setSaving(true); setError("");
    try {
      await api(`/inventory-count-sessions/${session.id}/settle`, {
        method: "POST",
        idempotencyKey: inventoryRequestKey(`inventory-count-settle-${session.id}`),
        body: JSON.stringify({ expectedVersion: session.version, settlementDate, surplusUnitCosts: costs }),
      });
      const updated = await api<CountSession>(`/inventory-count-sessions/${session.id}`);
      await onSettled(updated);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.reason === "COUNT_MOVED_SINCE_SNAPSHOT" ? copy.movedSinceSnapshot : cause instanceof ApiError && cause.reason === "MISSING_SURPLUS_COST" ? copy.surplusCostRequired : cause instanceof Error ? cause.message : copy.settlementError);
    } finally { setSaving(false); }
  }
  return <Modal title={copy.settlementTitle} description={copy.settlementDescription} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><label><span>{copy.settlementDate}</span><input type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} required /></label>{needsCost.map((line) => <label key={line.id}><span>{copy.surplusUnitCost.replace("{title}", line.title)}</span><input dir="ltr" inputMode="decimal" value={costs[line.inventoryItemId] ?? ""} onChange={(event) => setCosts((current) => ({ ...current, [line.inventoryItemId]: normalizeQuantity(event.target.value) }))} required /></label>)}</div><div className="inline-notice neutral">{copy.settlementNotice}</div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{copy.cancel}</Button><Button type="submit" disabled={saving}>{saving ? copy.settling : copy.confirmSettlement}</Button></div></form></Modal>;
}
