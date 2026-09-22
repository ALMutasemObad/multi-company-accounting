import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, downloadFile } from "../api";
import { allows } from "../authorization";
import { useAuthorization } from "../authorization-context";
import { inventoryPermissionPolicies } from "../inventory-permission-policies";
import { activeIntlLocale, localizedCopyFor, useI18n } from "../i18n";
import { externalStockPositionsCopy } from "../i18n/locales/external-stock-positions";
import type { InventoryItem, ListResponse, Warehouse } from "../types";
import { Button, EmptyState, Modal, Spinner } from "../ui";
import { inventoryRequestKey } from "./inventory-client-id";

type Notice = (message: string, tone?: "success" | "error") => void;
type PositionType = "THIRD_PARTY_HELD_BY_US" | "OWNED_HELD_BY_THIRD_PARTY" | "OWNED_IN_TRANSIT";
type Party = { id: string; code: string; nameAr: string; isActive: boolean };
type Position = {
  id: string; positionType: PositionType; quantity: string; inventoryValueBase: string | null;
  externalLocation: string | null; transitOrigin: string | null; transitDestination: string | null;
  item: { id: string; code: string; nameAr: string; unitCode: string };
  party: Party; warehouse: { id: string; code: string; nameAr: string } | null;
  lastEvent: { id: string; effectiveDate: string; sourceReference: string; reversed: boolean } | null;
};
const today = () => new Date().toISOString().slice(0, 10);

export function ExternalStockPositionsPanel({ notify }: { notify: Notice }) {
  const { locale } = useI18n();
  const copy = localizedCopyFor(externalStockPositionsCopy, locale, "ar");
  const { permissionSet } = useAuthorization();
  const canCreate = allows(permissionSet, inventoryPermissionPolicies.createMovement);
  const canReverse = allows(permissionSet, inventoryPermissionPolicies.reverseMovement);
  const [positions, setPositions] = useState<Position[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [filter, setFilter] = useState<PositionType | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showParty, setShowParty] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [adjust, setAdjust] = useState<{ position: Position; eventType: "INCREASE" | "DECREASE" } | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams(filter ? { positionType: filter } : {});
      const [p, partiesResult, itemResult, warehouseResult] = await Promise.all([
        api<{ data: Position[] }>(`/external-stock-positions?${query}`),
        api<{ data: Party[] }>("/external-inventory-parties"),
        api<ListResponse<InventoryItem>>("/inventory-items?page=1&pageSize=100&active=true"),
        api<ListResponse<Warehouse>>("/warehouses?page=1&pageSize=100&active=true"),
      ]);
      setPositions(p.data); setParties(partiesResult.data.filter((party) => party.isActive));
      setItems(itemResult.data.map((row) => ({ ...row, code: row.primaryBarcode?.value ?? "—" }))); setWarehouses(warehouseResult.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.loadError); }
    finally { setLoading(false); }
  }, [copy.loadError, filter]);
  useEffect(() => { void load(); }, [load]);
  async function reverse(position: Position) {
    if (!position.lastEvent || !canReverse) return;
    try {
      await api(`/external-stock-position-events/${position.lastEvent.id}/reverse`, { method: "POST", idempotencyKey: inventoryRequestKey("external-stock-reversal"), body: "{}" });
      notify(copy.reverseSuccess); await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : copy.reverseError, "error"); }
  }
  async function downloadReport() {
    try {
      const query = new URLSearchParams(filter ? { positionType: filter } : {});
      await downloadFile(`/external-stock-positions.xlsx?${query}`, "external-stock-positions.xlsx");
      notify(copy.reportDownloaded);
    } catch (cause) { notify(cause instanceof Error ? cause.message : copy.loadError, "error"); }
  }
  return <>
    <div className="inline-notice neutral">{copy.notice}</div>
    <div className="toolbar treasury-filters inventory-catalog-toolbar"><select aria-label={copy.typeFilter} value={filter} onChange={(event) => setFilter(event.target.value as PositionType | "")}><option value="">{copy.allTypes}</option>{Object.entries(copy.types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><Button variant="secondary" icon="document" disabled={loading} onClick={() => void downloadReport()}>{copy.downloadReport}</Button>{canCreate && <><Button variant="secondary" icon="plus" onClick={() => setShowParty(true)}>{copy.addParty}</Button><Button icon="plus" disabled={!parties.length || !items.length} onClick={() => setShowCreate(true)}>{copy.addPosition}</Button></>}</div>
    {!parties.length && !loading && <div className="inline-notice neutral">{copy.partyRequired}</div>}
    {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{copy.retry}</Button></div> : loading ? <Spinner label={copy.loading} /> : !positions.length ? <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={copy.tableLabel}><table className="data-table"><thead><tr><th>{copy.type}</th><th>{copy.item}</th><th>{copy.party}</th><th>{copy.locationRoute}</th><th>{copy.quantity}</th><th>{copy.value}</th><th>{copy.lastReference}</th><th>{copy.actions}</th></tr></thead><tbody>{positions.map((position) => <tr key={position.id}><td><span className="status-chip active">{copy.types[position.positionType]}</span></td><td><strong>{position.item.nameAr}</strong><small dir="ltr">{position.item.code}</small></td><td><strong>{position.party.nameAr}</strong><small dir="ltr">{position.party.code}</small></td><td>{position.warehouse ? `${position.warehouse.code} — ${position.warehouse.nameAr}` : position.externalLocation ?? `${position.transitOrigin} ← ${position.transitDestination}`}</td><td><strong dir="ltr">{Number(position.quantity).toLocaleString(activeIntlLocale(), { maximumFractionDigits: 6 })}</strong> <span className="code-pill" dir="ltr">{position.item.unitCode}</span></td><td dir="ltr">{position.inventoryValueBase === null ? copy.unvalued : Number(position.inventoryValueBase).toLocaleString(activeIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td><td><strong dir="ltr">{position.lastEvent?.sourceReference ?? "—"}</strong>{position.lastEvent && <small dir="ltr">{position.lastEvent.effectiveDate}</small>}</td><td><div className="inline-actions">{canCreate && <><Button variant="ghost" onClick={() => setAdjust({ position, eventType: "INCREASE" })}>{copy.increase}</Button><Button variant="ghost" disabled={Number(position.quantity) <= 0} onClick={() => setAdjust({ position, eventType: "DECREASE" })}>{copy.decrease}</Button></>}{canReverse && position.lastEvent && !position.lastEvent.reversed && <Button variant="ghost" icon="reverse" onClick={() => void reverse(position)}>{copy.reverseLatest}</Button>}</div></td></tr>)}</tbody></table></div>}
    {showParty && <PartyForm onClose={() => setShowParty(false)} onSaved={async () => { setShowParty(false); notify(copy.partyCreated); await load(); }} />}
    {showCreate && <PositionForm parties={parties} items={items} warehouses={warehouses} onClose={() => setShowCreate(false)} onSaved={async () => { setShowCreate(false); notify(copy.positionCreated); await load(); }} />}
    {adjust && <AdjustmentForm {...adjust} onClose={() => setAdjust(null)} onSaved={async () => { setAdjust(null); notify(copy.positionUpdated); await load(); }} />}
  </>;
}

function PartyForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const { locale } = useI18n(); const copy = localizedCopyFor(externalStockPositionsCopy, locale, "ar");
  const [code, setCode] = useState(""); const [nameAr, setNameAr] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { await api("/external-inventory-parties", { method: "POST", body: JSON.stringify({ code, nameAr }) }); await onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : copy.partySaveError); } finally { setSaving(false); } }
  return <Modal title={copy.partyTitle} description={copy.partyDescription} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><label><span>{copy.code}</span><input dir="ltr" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={40} required /></label><label><span>{copy.partyName}</span><input value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={200} required /></label></div><Actions saving={saving} onClose={onClose} /></form></Modal>;
}

function PositionForm({ parties, items, warehouses, onClose, onSaved }: { parties: Party[]; items: InventoryItem[]; warehouses: Warehouse[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { locale } = useI18n(); const copy = localizedCopyFor(externalStockPositionsCopy, locale, "ar");
  const [type, setType] = useState<PositionType>("THIRD_PARTY_HELD_BY_US"); const [item, setItem] = useState(items[0]?.id ?? ""); const [party, setParty] = useState(parties[0]?.id ?? ""); const [warehouse, setWarehouse] = useState(warehouses[0]?.id ?? "");
  const [location, setLocation] = useState(""); const [origin, setOrigin] = useState(""); const [destination, setDestination] = useState("");
  const [quantity, setQuantity] = useState(""); const [value, setValue] = useState(""); const [reference, setReference] = useState(""); const [date, setDate] = useState(today()); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const valued = type !== "THIRD_PARTY_HELD_BY_US";
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { await api("/external-stock-positions/events", { method: "POST", idempotencyKey: inventoryRequestKey("external-stock"), body: JSON.stringify({ positionType: type, inventoryItemId: item, custodyPartyId: party, warehouseId: type === "THIRD_PARTY_HELD_BY_US" ? warehouse : null, externalLocation: type === "OWNED_HELD_BY_THIRD_PARTY" ? location : null, transitOrigin: type === "OWNED_IN_TRANSIT" ? origin : null, transitDestination: type === "OWNED_IN_TRANSIT" ? destination : null, eventType: "INCREASE", quantity, inventoryValueBase: valued ? value : null, sourceReference: reference, effectiveDate: date }) }); await onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : copy.positionSaveError); } finally { setSaving(false); } }
  return <Modal title={copy.positionTitle} description={copy.positionDescription} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><label><span>{copy.typeFilter}</span><select value={type} onChange={(event) => setType(event.target.value as PositionType)}>{Object.entries(copy.types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>{copy.item}</span><select value={item} onChange={(event) => setItem(event.target.value)} required>{items.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.nameAr}</option>)}</select></label><label><span>{copy.party}</span><select value={party} onChange={(event) => setParty(event.target.value)} required>{parties.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.nameAr}</option>)}</select></label>{type === "THIRD_PARTY_HELD_BY_US" && <label><span>{copy.warehouse}</span><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} required>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.nameAr}</option>)}</select></label>}{type === "OWNED_HELD_BY_THIRD_PARTY" && <label><span>{copy.externalLocation}</span><input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={300} required /></label>}{type === "OWNED_IN_TRANSIT" && <><label><span>{copy.origin}</span><input value={origin} onChange={(event) => setOrigin(event.target.value)} maxLength={300} required /></label><label><span>{copy.destination}</span><input value={destination} onChange={(event) => setDestination(event.target.value)} maxLength={300} required /></label></>}<AmountFields valued={valued} quantity={quantity} value={value} date={date} reference={reference} setQuantity={setQuantity} setValue={setValue} setDate={setDate} setReference={setReference} /></div><Actions saving={saving} onClose={onClose} /></form></Modal>;
}

function AdjustmentForm({ position, eventType, onClose, onSaved }: { position: Position; eventType: "INCREASE" | "DECREASE"; onClose: () => void; onSaved: () => Promise<void> }) {
  const { locale } = useI18n(); const copy = localizedCopyFor(externalStockPositionsCopy, locale, "ar");
  const [quantity, setQuantity] = useState(""); const [value, setValue] = useState(""); const [reference, setReference] = useState(""); const [date, setDate] = useState(today()); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const valued = position.positionType !== "THIRD_PARTY_HELD_BY_US";
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { await api("/external-stock-positions/events", { method: "POST", idempotencyKey: inventoryRequestKey("external-stock"), body: JSON.stringify({ positionId: position.id, eventType, quantity, inventoryValueBase: valued ? value : null, sourceReference: reference, effectiveDate: date }) }); await onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : copy.updateError); } finally { setSaving(false); } }
  return <Modal title={copy.adjustTitle.replace("{action}", eventType === "INCREASE" ? copy.increase : copy.decrease)} description={`${position.item.nameAr} · ${position.party.nameAr}`} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><AmountFields valued={valued} quantity={quantity} value={value} date={date} reference={reference} setQuantity={setQuantity} setValue={setValue} setDate={setDate} setReference={setReference} /></div><Actions saving={saving} onClose={onClose} /></form></Modal>;
}

function AmountFields({ valued, quantity, value, date, reference, setQuantity, setValue, setDate, setReference }: { valued: boolean; quantity: string; value: string; date: string; reference: string; setQuantity: (v: string) => void; setValue: (v: string) => void; setDate: (v: string) => void; setReference: (v: string) => void }) {
  const { locale } = useI18n(); const copy = localizedCopyFor(externalStockPositionsCopy, locale, "ar");
  return <><label><span>{copy.quantity}</span><input dir="ltr" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} pattern="[0-9]{1,13}([.][0-9]{1,6})?" required /></label>{valued && <label><span>{copy.totalCost}</span><input dir="ltr" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} pattern="[0-9]{1,15}([.][0-9]{1,4})?" required /></label>}<label><span>{copy.movementDate}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label><span>{copy.documentReference}</span><input dir="ltr" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={100} required /></label></>;
}
function Actions({ saving, onClose }: { saving: boolean; onClose: () => void }) { const { locale } = useI18n(); const copy = localizedCopyFor(externalStockPositionsCopy, locale, "ar"); return <div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{copy.cancel}</Button><Button type="submit" disabled={saving}>{saving ? copy.saving : copy.save}</Button></div>; }
