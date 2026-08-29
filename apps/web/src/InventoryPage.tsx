import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, downloadFile, idempotencyKey } from "./api";
import { Can, useAuthorization } from "./authorization-context";
import {
  barcodePermissionPolicies,
  canManageInventoryItemBarcodes,
  canPrintInventoryBarcode,
  canViewInventoryBarcodes,
  inventoryBarcodeLabelFilename,
  inventoryBarcodeSymbologies,
} from "./barcode";
import { activeIntlLocale, localizedReferenceName, translate as t } from "./i18n";
import type { InventoryBalance, InventoryBarcodeSymbology, InventoryItem, InventoryItemBarcode, InventoryMovement, InventoryMovementType, ListResponse, UnitOfMeasure, Warehouse } from "./types";
import { Button, EmptyState, Icon, Modal, PageHeader, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Tab = "balances" | "movements" | "warehouses" | "units" | "items";
type PageMeta = { page: number; pageSize: number; total: number; totalPages: number };

const emptyMeta: PageMeta = { page: 1, pageSize: 10, total: 0, totalPages: 0 };

export function InventoryPage({ notify }: { notify: Notice }) {
  const [tab, setTab] = useState<Tab>("warehouses");
  return <section className="workspace-page">
    <PageHeader kicker={t("inventory.kicker")} title={t("inventory.title")} description={t("inventory.description")} />
    <div className="section-tabs" role="tablist" aria-label={t("inventory.tabs.label")}>
      {(["warehouses", "balances", "movements", "units", "items"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{t(`inventory.tabs.${value}`)}</button>)}
    </div>
    {tab === "balances" && <BalancesPanel notify={notify} />}
    {tab === "movements" && <MovementsPanel notify={notify} />}
    {tab === "warehouses" && <WarehousesPanel notify={notify} />}
    {tab === "units" && <UnitsPanel notify={notify} />}
    {tab === "items" && <ItemsPanel notify={notify} />}
  </section>;
}

const movementTypes: InventoryMovementType[] = ["OPENING_BALANCE", "RECEIPT", "ISSUE", "TRANSFER", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"];
const movementTypeLabel = (value: InventoryMovementType) => t(`inventory.movements.types.${value}`);
const quantityLabel = (value: string) => Number(value).toLocaleString(activeIntlLocale(), { maximumFractionDigits: 6 });

function BalancesPanel({ notify }: { notify: Notice }) {
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [catalog, setCatalog] = useState<InventoryItem[]>([]);
  const [meta, setMeta] = useState<PageMeta>(emptyMeta);
  const [page, setPage] = useState(1);
  const [warehouseId, setWarehouseId] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [nonZero, setNonZero] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [valuationBalance, setValuationBalance] = useState<InventoryBalance | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: "10", nonZero: String(nonZero), ...(warehouseId ? { warehouseId } : {}), ...(inventoryItemId ? { inventoryItemId } : {}) });
    try {
      const [result, warehouseResult, itemResult] = await Promise.all([
        api<ListResponse<InventoryBalance>>(`/inventory-balances?${query}`),
        api<ListResponse<Warehouse>>("/warehouses?page=1&pageSize=100&active=true"),
        api<ListResponse<InventoryItem>>("/inventory-items?page=1&pageSize=100&active=true"),
      ]);
      setBalances(result.data);
      setMeta(result.meta);
      setWarehouses(warehouseResult.data);
      setCatalog(itemResult.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.balances.loadError"));
    } finally {
      setLoading(false);
    }
  }, [inventoryItemId, nonZero, page, warehouseId]);

  useEffect(() => { void load(); }, [load]);
  return <>
    <div className="toolbar treasury-filters inventory-catalog-toolbar">
      <select aria-label={t("inventory.balances.warehouse")} value={warehouseId} onChange={(event) => { setPage(1); setWarehouseId(event.target.value); }}><option value="">{t("inventory.balances.allWarehouses")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {localizedReferenceName(warehouse)}</option>)}</select>
      <select aria-label={t("inventory.balances.item")} value={inventoryItemId} onChange={(event) => { setPage(1); setInventoryItemId(event.target.value); }}><option value="">{t("inventory.balances.allItems")}</option>{catalog.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)}</option>)}</select>
      <label className="checkbox-line"><input type="checkbox" checked={nonZero} onChange={(event) => { setPage(1); setNonZero(event.target.checked); }} />{t("inventory.balances.nonZero")}</label>
    </div>
    {error ? <ErrorPanel error={error} retry={load} /> : loading ? <Spinner label={t("inventory.balances.loading")} /> : !balances.length ? <EmptyState title={t("inventory.balances.emptyTitle")} description={t("inventory.balances.emptyDescription")} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("inventory.balances.warehouse")}</th><th>{t("inventory.balances.item")}</th><th>{t("inventory.balances.onHand")}</th><th>{t("inventory.balances.value")}</th><th>{t("inventory.balances.averageCost")}</th><th>{t("inventory.balances.valuationStatus")}</th><th>{t("inventory.actions")}</th></tr></thead><tbody>{balances.map((balance) => <tr key={balance.id}><td><strong>{localizedReferenceName(balance.warehouse)}</strong><small dir="ltr">{balance.warehouse.code}</small></td><td><strong>{localizedReferenceName(balance.inventoryItem)}</strong><small dir="ltr">{balance.inventoryItem.code}</small></td><td><strong dir="ltr">{quantityLabel(balance.onHand)}</strong> <span className="code-pill" dir="ltr">{balance.inventoryItem.unitOfMeasure.code}</span></td><td dir="ltr">{balance.isValuationInitialized ? Number(balance.inventoryValueBase).toLocaleString(activeIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—"}</td><td dir="ltr">{balance.isValuationInitialized ? Number(balance.averageUnitCostBase).toLocaleString(activeIntlLocale(), { maximumFractionDigits: 8 }) : "—"}</td><td><span className={`status-chip ${balance.isValuationInitialized ? "active" : "inactive"}`}>{t(balance.isValuationInitialized ? "inventory.balances.valued" : "inventory.balances.requiresValuation")}</span></td><td>{!balance.isValuationInitialized && <Button variant="ghost" onClick={() => setValuationBalance(balance)}>{t("inventory.balances.initializeValuation")}</Button>}</td></tr>)}</tbody></table></div>}
    <Pagination {...meta} page={page} onChange={setPage} />
    {valuationBalance && <ValuationInitializationForm balance={valuationBalance} onClose={() => setValuationBalance(null)} onSaved={async () => { setValuationBalance(null); notify(t("inventory.balances.valuationInitialized")); await load(); }} />}
  </>;
}

function ValuationInitializationForm({ balance, onClose, onSaved }: { balance: InventoryBalance; onClose: () => void; onSaved: () => void }) {
  const [unitCostBase, setUnitCostBase] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/inventory-balances/${balance.id}/initialize-valuation`, {
        method: "POST",
        idempotencyKey: idempotencyKey("inventory-valuation", crypto.randomUUID()),
        body: JSON.stringify({ version: balance.version, unitCostBase, reason: reason.trim() }),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.balances.valuationError"));
    } finally {
      setSaving(false);
    }
  }

  return <Modal title={t("inventory.balances.initializeValuation")} description={`${localizedReferenceName(balance.inventoryItem)} · ${localizedReferenceName(balance.warehouse)}`} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="inline-notice neutral">{t("inventory.balances.valuationNotice", { quantity: quantityLabel(balance.onHand) })}</div><div className="form-grid"><label><span>{t("inventory.balances.unitCostBase")}</span><input dir="ltr" inputMode="decimal" value={unitCostBase} onChange={(event) => setUnitCostBase(event.target.value)} pattern="[0-9]{1,11}([.][0-9]{1,8})?" required /></label><label className="full"><span>{t("inventory.balances.valuationReason")}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} rows={3} required /></label></div><FormActions saving={saving} onClose={onClose} /></form></Modal>;
}

function MovementsPanel({ notify }: { notify: Notice }) {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [catalog, setCatalog] = useState<InventoryItem[]>([]);
  const [meta, setMeta] = useState<PageMeta>(emptyMeta);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<InventoryMovement | null>(null);
  const [reversing, setReversing] = useState<InventoryMovement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: "10", ...(typeFilter ? { movementType: typeFilter } : {}), ...(submittedSearch ? { search: submittedSearch } : {}) });
    try {
      const [result, warehouseResult, itemResult] = await Promise.all([
        api<ListResponse<InventoryMovement>>(`/inventory-movements?${query}`),
        api<ListResponse<Warehouse>>("/warehouses?page=1&pageSize=100&active=true"),
        api<ListResponse<InventoryItem>>("/inventory-items?page=1&pageSize=100&active=true"),
      ]);
      setMovements(result.data);
      setMeta(result.meta);
      setWarehouses(warehouseResult.data);
      setCatalog(itemResult.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.movements.loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, submittedSearch, typeFilter]);

  useEffect(() => { void load(); }, [load]);
  async function showDetail(id: string) {
    try { setDetail(await api<InventoryMovement>(`/inventory-movements/${id}`)); }
    catch (cause) { notify(cause instanceof Error ? cause.message : t("inventory.movements.loadError"), "error"); }
  }

  return <>
    <div className="toolbar treasury-filters inventory-catalog-toolbar">
      <SearchBox value={search} label={t("inventory.movements.search")} onChange={setSearch} onSubmit={() => { setPage(1); setSubmittedSearch(search.trim()); }} />
      <select aria-label={t("inventory.movements.type")} value={typeFilter} onChange={(event) => { setPage(1); setTypeFilter(event.target.value); }}><option value="">{t("inventory.movements.allTypes")}</option>{movementTypes.map((value) => <option key={value} value={value}>{movementTypeLabel(value)}</option>)}</select>
      <Button icon="plus" disabled={!warehouses.length || !catalog.length} onClick={() => setCreating(true)}>{t("inventory.movements.create")}</Button>
    </div>
    {!loading && (!warehouses.length || !catalog.length) && <div className="inline-notice neutral">{t("inventory.movements.referencesRequired")}</div>}
    {error ? <ErrorPanel error={error} retry={load} /> : loading ? <Spinner label={t("inventory.movements.loading")} /> : !movements.length ? <EmptyState title={t("inventory.movements.emptyTitle")} description={t("inventory.movements.emptyDescription")} action={warehouses.length && catalog.length ? <Button icon="plus" onClick={() => setCreating(true)}>{t("inventory.movements.create")}</Button> : undefined} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("inventory.movements.number")}</th><th>{t("inventory.movements.date")}</th><th>{t("inventory.movements.type")}</th><th>{t("inventory.movements.description")}</th><th>{t("inventory.movements.lineCount")}</th><th>{t("inventory.actions")}</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td><strong dir="ltr">{movement.movementNumber}</strong>{movement.externalReference && <small dir="ltr">{movement.externalReference}</small>}</td><td dir="ltr">{movement.movementDate}</td><td><span className="status-chip active">{movementTypeLabel(movement.movementType)}</span></td><td>{movement.description}</td><td>{movement.lineCount}</td><td><Button variant="ghost" onClick={() => void showDetail(movement.id)}>{t("inventory.movements.view")}</Button></td></tr>)}</tbody></table></div>}
    <Pagination {...meta} page={page} onChange={setPage} />
    {creating && <MovementForm warehouses={warehouses} catalog={catalog} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); notify(t("inventory.movements.created")); await load(); }} />}
    {detail && <MovementDetail movement={detail} onClose={() => setDetail(null)} onReverse={() => { setDetail(null); setReversing(detail); }} />}
    {reversing && <MovementReversalForm movement={reversing} onClose={() => setReversing(null)} onSaved={async () => { setReversing(null); notify(t("inventory.movements.reversed")); await load(); }} />}
  </>;
}

type MovementLineDraft = { inventoryItemId: string; fromWarehouseId: string; toWarehouseId: string; quantity: string; unitCostBase: string };
const emptyMovementLine = (): MovementLineDraft => ({ inventoryItemId: "", fromWarehouseId: "", toWarehouseId: "", quantity: "", unitCostBase: "" });

function MovementForm({ warehouses, catalog, onClose, onSaved }: { warehouses: Warehouse[]; catalog: InventoryItem[]; onClose: () => void; onSaved: () => void }) {
  const [movementType, setMovementType] = useState<InventoryMovementType>("RECEIPT");
  const [movementDate, setMovementDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [lines, setLines] = useState<MovementLineDraft[]>([emptyMovementLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inbound = ["OPENING_BALANCE", "RECEIPT", "ADJUSTMENT_IN"].includes(movementType);
  const outbound = ["ISSUE", "ADJUSTMENT_OUT"].includes(movementType);
  const updateLine = (index: number, patch: Partial<MovementLineDraft>) => setLines((current) => current.map((line, currentIndex) => currentIndex === index ? { ...line, ...patch } : line));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = {
        movementType,
        movementDate,
        description: description.trim(),
        externalReference: externalReference.trim() || null,
        lines: lines.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity,
          ...(inbound ? { unitCostBase: line.unitCostBase } : {}),
          ...(!inbound ? { fromWarehouseId: line.fromWarehouseId } : {}),
          ...(!outbound ? { toWarehouseId: line.toWarehouseId } : {}),
        })),
      };
      await api("/inventory-movements", { method: "POST", idempotencyKey: idempotencyKey("inventory-movement", crypto.randomUUID()), body: JSON.stringify(body) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.movements.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return <Modal title={t("inventory.movements.create")} description={t("inventory.movements.formDescription")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><label><span>{t("inventory.movements.type")}</span><select value={movementType} onChange={(event) => { setMovementType(event.target.value as InventoryMovementType); setLines([emptyMovementLine()]); }}>{movementTypes.map((value) => <option key={value} value={value}>{movementTypeLabel(value)}</option>)}</select></label><label><span>{t("inventory.movements.date")}</span><input type="date" value={movementDate} onChange={(event) => setMovementDate(event.target.value)} required /></label><label className="full"><span>{t("inventory.movements.description")}</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} required /></label><label className="full"><span>{t("inventory.movements.externalReference")}</span><input dir="ltr" value={externalReference} onChange={(event) => setExternalReference(event.target.value)} maxLength={100} /></label></div><div className="line-editor"><div className="line-editor-header"><h3>{t("inventory.movements.lines")}</h3><Button type="button" variant="secondary" icon="plus" onClick={() => setLines((current) => [...current, emptyMovementLine()])}>{t("inventory.movements.addLine")}</Button></div>{lines.map((line, index) => <div className="form-grid inventory-movement-line" key={index}><label><span>{t("inventory.balances.item")}</span><select value={line.inventoryItemId} onChange={(event) => updateLine(index, { inventoryItemId: event.target.value })} required><option value="">{t("inventory.movements.selectItem")}</option>{catalog.map((item) => <option key={item.id} value={item.id}>{item.code} — {localizedReferenceName(item)} ({item.unitOfMeasure.code})</option>)}</select></label>{!inbound && <label><span>{t("inventory.movements.fromWarehouse")}</span><select value={line.fromWarehouseId} onChange={(event) => updateLine(index, { fromWarehouseId: event.target.value })} required><option value="">{t("inventory.movements.selectWarehouse")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {localizedReferenceName(warehouse)}</option>)}</select></label>}{!outbound && <label><span>{t("inventory.movements.toWarehouse")}</span><select value={line.toWarehouseId} onChange={(event) => updateLine(index, { toWarehouseId: event.target.value })} required><option value="">{t("inventory.movements.selectWarehouse")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {localizedReferenceName(warehouse)}</option>)}</select></label>}<label><span>{t("inventory.movements.quantity")}</span><input dir="ltr" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} pattern="[0-9]{1,13}([.][0-9]{1,6})?" required /></label>{inbound && <label><span>{t("inventory.movements.unitCostBase")}</span><input dir="ltr" inputMode="decimal" value={line.unitCostBase} onChange={(event) => updateLine(index, { unitCostBase: event.target.value })} pattern="[0-9]{1,11}([.][0-9]{1,8})?" required /></label>}{lines.length > 1 && <div className="form-actions"><Button type="button" variant="ghost" icon="ban" onClick={() => setLines((current) => current.filter((_, currentIndex) => currentIndex !== index))}>{t("inventory.movements.removeLine")}</Button></div>}</div>)}</div><div className="inline-notice neutral">{t("inventory.movements.immutableNotice")}</div><FormActions saving={saving} onClose={onClose} /></form></Modal>;
}

function MovementDetail({ movement, onClose, onReverse }: { movement: InventoryMovement; onClose: () => void; onReverse: () => void }) {
  const canReverse = movement.source === null && movement.reversalOf === null && movement.status === "POSTED";
  return <Modal title={movement.movementNumber} description={`${movementTypeLabel(movement.movementType)} · ${movement.movementDate}`} onClose={onClose}><div className="detail-grid"><div><span>{t("inventory.movements.description")}</span><strong>{movement.description}</strong></div><div><span>{t("inventory.movements.status")}</span><strong>{t(`inventory.movements.statuses.${movement.status}`)}</strong></div><div><span>{t("inventory.movements.externalReference")}</span><strong dir="ltr">{movement.externalReference || "—"}</strong></div><div><span>{t("inventory.movements.createdBy")}</span><strong>{movement.createdByName}</strong></div>{movement.accounting && <><div><span>{t("inventory.movements.accountingDocument")}</span><strong dir="ltr">{movement.accounting.documentNumber}</strong></div><div><span>{t("inventory.movements.offsetAccount")}</span><strong>{movement.accounting.offsetAccount ? `${movement.accounting.offsetAccount.code} — ${movement.accounting.offsetAccount.nameAr}` : "—"}</strong></div></>}{movement.reversalOf && <div><span>{t("inventory.movements.reversalOf")}</span><strong dir="ltr">{movement.reversalOf.movementNumber}</strong></div>}{movement.reversedBy && <div><span>{t("inventory.movements.reversedBy")}</span><strong dir="ltr">{movement.reversedBy.movementNumber}</strong></div>}</div><div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>#</th><th>{t("inventory.balances.item")}</th><th>{t("inventory.movements.route")}</th><th>{t("inventory.movements.quantity")}</th><th>{t("inventory.movements.unitCostBase")}</th><th>{t("inventory.movements.totalCostBase")}</th></tr></thead><tbody>{movement.lines?.map((line) => <tr key={line.id}><td>{line.lineNumber}</td><td><strong>{line.inventoryItemName}</strong><small dir="ltr">{line.inventoryItemCode}</small></td><td>{line.fromWarehouseName || t("inventory.movements.externalSource")} → {line.toWarehouseName || t("inventory.movements.externalDestination")}</td><td><strong dir="ltr">{quantityLabel(line.quantity)}</strong> <span className="code-pill" dir="ltr">{line.unitOfMeasureCode}</span></td><td dir="ltr">{line.isCostInitialized ? Number(line.unitCostBase).toLocaleString(activeIntlLocale(), { maximumFractionDigits: 8 }) : "—"}</td><td dir="ltr">{line.isCostInitialized ? Number(line.totalCostBase).toLocaleString(activeIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—"}</td></tr>)}</tbody></table></div><div className="form-actions">{canReverse && <Button variant="danger" icon="reverse" onClick={onReverse}>{t("inventory.movements.reverse")}</Button>}<Button onClick={onClose}>{t("inventory.cancel")}</Button></div></Modal>;
}

function MovementReversalForm({ movement, onClose, onSaved }: { movement: InventoryMovement; onClose: () => void; onSaved: () => void }) {
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/inventory-movements/${movement.id}/reverse`, {
        method: "POST",
        idempotencyKey: idempotencyKey("inventory-movement-reversal", crypto.randomUUID()),
        body: JSON.stringify({ version: movement.version, reversalDate, reason: reason.trim() }),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.movements.reverseError"));
    } finally {
      setSaving(false);
    }
  }
  return <Modal title={t("inventory.movements.reverseTitle", { value1: movement.movementNumber })} description={t("inventory.movements.reverseDescription")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="inline-notice neutral">{t("inventory.movements.reverseNotice")}</div><div className="form-grid"><label><span>{t("inventory.movements.reversalDate")}</span><input type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} required /></label><label className="full"><span>{t("inventory.movements.reversalReason")}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} rows={3} required /></label></div><FormActions saving={saving} onClose={onClose} /></form></Modal>;
}

function WarehousesPanel({ notify }: { notify: Notice }) {
  const [items, setItems] = useState<Warehouse[]>([]);
  const [meta, setMeta] = useState<PageMeta>(emptyMeta);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Warehouse | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<ListResponse<Warehouse>>(`/warehouses?${listQuery(page, submittedSearch, status)}`);
      setItems(result.data);
      setMeta(result.meta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, status, submittedSearch]);

  useEffect(() => { void load(); }, [load]);

  async function deactivate(item: Warehouse) {
    const reason = window.prompt(t("inventory.deactivatePrompt", { name: localizedReferenceName(item) }));
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/warehouses/${item.id}/deactivate`, { method: "POST", body: JSON.stringify({ version: item.version, reason: reason.trim() }) });
      notify(t("inventory.deactivated"));
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("inventory.deactivateError"), "error");
    }
  }

  return <>
    <CatalogToolbar search={search} status={status} searchLabel={t("inventory.search")} createLabel={t("inventory.create")} onSearch={setSearch} onSubmit={() => { setPage(1); setSubmittedSearch(search.trim()); }} onStatus={(value) => { setPage(1); setStatus(value); }} onCreate={() => setForm("new")} />
    {error ? <ErrorPanel error={error} retry={load} /> : loading ? <Spinner label={t("inventory.loading")} /> : !items.length ? <EmptyState title={t("inventory.emptyTitle")} description={t("inventory.emptyDescription")} action={<Button icon="plus" onClick={() => setForm("new")}>{t("inventory.create")}</Button>} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("inventory.code")}</th><th>{t("inventory.name")}</th><th>{t("inventory.address")}</th><th>{t("inventory.status")}</th><th>{t("inventory.actions")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong dir="ltr">{item.code}</strong></td><td><strong>{localizedReferenceName(item)}</strong>{item.nameEn && <small dir="ltr">{item.nameEn}</small>}</td><td>{item.address || "—"}</td><td><Status active={item.isActive} /></td><td><div className="inline-actions"><Button variant="ghost" icon="edit" onClick={() => setForm(item)}>{t("inventory.edit")}</Button>{item.isActive && <Button variant="ghost" icon="ban" onClick={() => void deactivate(item)}>{t("inventory.deactivate")}</Button>}</div></td></tr>)}</tbody></table></div>}
    <Pagination {...meta} page={page} onChange={setPage} />
    {form && <WarehouseForm warehouse={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={async () => { const created = form === "new"; setForm(null); notify(t(created ? "inventory.created" : "inventory.updated")); await load(); }} />}
  </>;
}

function UnitsPanel({ notify }: { notify: Notice }) {
  const [items, setItems] = useState<UnitOfMeasure[]>([]);
  const [meta, setMeta] = useState<PageMeta>(emptyMeta);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<UnitOfMeasure | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<ListResponse<UnitOfMeasure>>(`/units-of-measure?${listQuery(page, submittedSearch, status)}`);
      setItems(result.data);
      setMeta(result.meta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.units.loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, status, submittedSearch]);

  useEffect(() => { void load(); }, [load]);

  async function deactivate(item: UnitOfMeasure) {
    const reason = window.prompt(t("inventory.units.deactivatePrompt", { name: localizedReferenceName(item) }));
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/units-of-measure/${item.id}/deactivate`, { method: "POST", body: JSON.stringify({ version: item.version, reason: reason.trim() }) });
      notify(t("inventory.units.deactivated"));
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("inventory.units.deactivateError"), "error");
    }
  }

  return <>
    <CatalogToolbar search={search} status={status} searchLabel={t("inventory.units.search")} createLabel={t("inventory.units.create")} onSearch={setSearch} onSubmit={() => { setPage(1); setSubmittedSearch(search.trim()); }} onStatus={(value) => { setPage(1); setStatus(value); }} onCreate={() => setForm("new")} />
    {error ? <ErrorPanel error={error} retry={load} /> : loading ? <Spinner label={t("inventory.units.loading")} /> : !items.length ? <EmptyState title={t("inventory.units.emptyTitle")} description={t("inventory.units.emptyDescription")} action={<Button icon="plus" onClick={() => setForm("new")}>{t("inventory.units.create")}</Button>} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("inventory.code")}</th><th>{t("inventory.units.name")}</th><th>{t("inventory.units.decimals")}</th><th>{t("inventory.status")}</th><th>{t("inventory.actions")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong dir="ltr">{item.code}</strong></td><td><strong>{localizedReferenceName(item)}</strong>{item.nameEn && <small dir="ltr">{item.nameEn}</small>}</td><td>{item.decimalPlaces}</td><td><Status active={item.isActive} /></td><td><div className="inline-actions"><Button variant="ghost" icon="edit" onClick={() => setForm(item)}>{t("inventory.edit")}</Button>{item.isActive && <Button variant="ghost" icon="ban" onClick={() => void deactivate(item)}>{t("inventory.deactivate")}</Button>}</div></td></tr>)}</tbody></table></div>}
    <Pagination {...meta} page={page} onChange={setPage} />
    {form && <UnitForm unit={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={async () => { const created = form === "new"; setForm(null); notify(t(created ? "inventory.units.created" : "inventory.units.updated")); await load(); }} />}
  </>;
}

function ItemsPanel({ notify }: { notify: Notice }) {
  const { permissionSet } = useAuthorization();
  const canViewBarcodes = canViewInventoryBarcodes(permissionSet);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [meta, setMeta] = useState<PageMeta>(emptyMeta);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<InventoryItem | "new" | null>(null);
  const [barcodeItem, setBarcodeItem] = useState<InventoryItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = listQuery(page, submittedSearch, status);
      if (unitFilter) query.set("unitOfMeasureId", unitFilter);
      const [result, unitResult] = await Promise.all([
        api<ListResponse<InventoryItem>>(`/inventory-items?${query}`),
        api<ListResponse<UnitOfMeasure>>("/units-of-measure?page=1&pageSize=100&active=true"),
      ]);
      setItems(result.data);
      setMeta(result.meta);
      setUnits(unitResult.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.items.loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, status, submittedSearch, unitFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canViewBarcodes) setBarcodeItem(null);
  }, [canViewBarcodes]);

  async function deactivate(item: InventoryItem) {
    const reason = window.prompt(t("inventory.items.deactivatePrompt", { name: localizedReferenceName(item) }));
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/inventory-items/${item.id}/deactivate`, { method: "POST", body: JSON.stringify({ version: item.version, reason: reason.trim() }) });
      notify(t("inventory.items.deactivated"));
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("inventory.items.deactivateError"), "error");
    }
  }

  return <>
    <div className="toolbar treasury-filters inventory-catalog-toolbar">
      <SearchBox value={search} label={t("inventory.items.search")} onChange={setSearch} onSubmit={() => { setPage(1); setSubmittedSearch(search.trim()); }} />
      <select aria-label={t("inventory.status")} value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">{t("inventory.status")}</option><option value="true">{t("inventory.active")}</option><option value="false">{t("inventory.inactive")}</option></select>
      <select aria-label={t("inventory.items.unitFilter")} value={unitFilter} onChange={(event) => { setPage(1); setUnitFilter(event.target.value); }}><option value="">{t("inventory.items.allUnits")}</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} — {localizedReferenceName(unit)}</option>)}</select>
      <Button icon="plus" disabled={!units.length} onClick={() => setForm("new")}>{t("inventory.items.create")}</Button>
    </div>
    {!loading && !units.length && <div className="inline-notice neutral">{t("inventory.items.unitRequired")}</div>}
    {error ? <ErrorPanel error={error} retry={load} /> : loading ? <Spinner label={t("inventory.items.loading")} /> : !items.length ? <EmptyState title={t("inventory.items.emptyTitle")} description={t("inventory.items.emptyDescription")} action={units.length ? <Button icon="plus" onClick={() => setForm("new")}>{t("inventory.items.create")}</Button> : undefined} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("inventory.code")}</th><th>{t("inventory.items.name")}</th><th>{t("inventory.items.unit")}</th><th>{t("inventory.items.description")}</th><th>{t("inventory.status")}</th><th>{t("inventory.actions")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong dir="ltr">{item.code}</strong></td><td><strong>{localizedReferenceName(item)}</strong>{item.nameEn && <small dir="ltr">{item.nameEn}</small>}</td><td><span className="code-pill" dir="ltr">{item.unitOfMeasure.code}</span><small>{localizedReferenceName(item.unitOfMeasure)}</small></td><td>{item.description || "—"}</td><td><Status active={item.isActive} /></td><td><div className="inline-actions"><Button variant="ghost" icon="edit" onClick={() => setForm(item)}>{t("inventory.edit")}</Button><Can policy={barcodePermissionPolicies.view}><Button variant="ghost" icon="inventory" onClick={() => setBarcodeItem(item)}>{t("inventory.barcodes.manage")}</Button></Can>{item.isActive && <Button variant="ghost" icon="ban" onClick={() => void deactivate(item)}>{t("inventory.deactivate")}</Button>}</div></td></tr>)}</tbody></table></div>}
    <Pagination {...meta} page={page} onChange={setPage} />
    {form && <ItemForm item={form === "new" ? null : form} units={units} onClose={() => setForm(null)} onSaved={async () => { const created = form === "new"; setForm(null); notify(t(created ? "inventory.items.created" : "inventory.items.updated")); await load(); }} />}
    {barcodeItem && canViewBarcodes && <BarcodeManager item={barcodeItem} notify={notify} onClose={() => setBarcodeItem(null)} />}
  </>;
}

function BarcodeManager({ item, notify, onClose }: { item: InventoryItem; notify: Notice; onClose: () => void }) {
  const { permissionSet } = useAuthorization();
  const canView = canViewInventoryBarcodes(permissionSet);
  const canManage = canManageInventoryItemBarcodes(permissionSet, item.isActive);
  const [barcodes, setBarcodes] = useState<InventoryItemBarcode[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyBarcodeId, setBusyBarcodeId] = useState("");
  const [downloadingBarcodeId, setDownloadingBarcodeId] = useState("");

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "25",
        ...(status ? { active: status } : {}),
      });
      const result = await api<ListResponse<InventoryItemBarcode>>(`/inventory-items/${item.id}/barcodes?${query}`);
      setBarcodes(result.data);
      setMeta(result.meta);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.barcodes.loadError"));
    } finally {
      setLoading(false);
    }
  }, [canView, item.id, page, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!canView) onClose(); }, [canView, onClose]);

  async function setPrimary(barcode: InventoryItemBarcode) {
    if (!canManage || busyBarcodeId) return;
    setBusyBarcodeId(barcode.id);
    setCommandError("");
    try {
      await api(`/inventory-items/${item.id}/barcodes/${barcode.id}/set-primary`, {
        method: "POST",
        body: JSON.stringify({ version: barcode.version }),
      });
      notify(t("inventory.barcodes.primarySet"));
      await load();
    } catch (cause) {
      setCommandError(cause instanceof Error ? cause.message : t("inventory.barcodes.actionError"));
    } finally {
      setBusyBarcodeId("");
    }
  }

  async function deactivate(barcode: InventoryItemBarcode) {
    if (!canManage || busyBarcodeId) return;
    const reason = window.prompt(t("inventory.barcodes.deactivatePrompt", { value: barcode.value }));
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setCommandError(t("inventory.barcodes.reasonTooShort"));
      return;
    }
    setBusyBarcodeId(barcode.id);
    setCommandError("");
    try {
      await api(`/inventory-items/${item.id}/barcodes/${barcode.id}/deactivate`, {
        method: "POST",
        body: JSON.stringify({ version: barcode.version, reason: reason.trim() }),
      });
      notify(t("inventory.barcodes.deactivated"));
      await load();
    } catch (cause) {
      setCommandError(cause instanceof Error ? cause.message : t("inventory.barcodes.actionError"));
    } finally {
      setBusyBarcodeId("");
    }
  }

  async function downloadLabel(barcode: InventoryItemBarcode) {
    if (!canPrintInventoryBarcode(permissionSet, item.isActive, barcode.isActive)
      || busyBarcodeId
      || downloadingBarcodeId) return;
    setDownloadingBarcodeId(barcode.id);
    setCommandError("");
    try {
      await downloadFile(
        `/inventory-items/${encodeURIComponent(item.id)}/barcodes/${encodeURIComponent(barcode.id)}/label.png`,
        inventoryBarcodeLabelFilename(item.id, barcode.id),
      );
      notify(t("inventory.barcodes.labelDownloaded"));
    } catch (cause) {
      setCommandError(cause instanceof Error ? cause.message : t("inventory.barcodes.labelDownloadError"));
    } finally {
      setDownloadingBarcodeId("");
    }
  }

  return <Modal title={t("inventory.barcodes.title", { item: localizedReferenceName(item) })} description={t("inventory.barcodes.description", { code: item.code })} onClose={onClose} wide>
    <div className="barcode-manager-toolbar">
      <select aria-label={t("inventory.barcodes.statusFilter")} value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
        <option value="">{t("inventory.barcodes.all")}</option>
        <option value="true">{t("inventory.active")}</option>
        <option value="false">{t("inventory.inactive")}</option>
      </select>
      {canManage && <Button icon="plus" onClick={() => setCreating((value) => !value)}>{creating ? t("common.cancel") : t("inventory.barcodes.add")}</Button>}
    </div>
    {creating && canManage && <BarcodeCreateForm itemId={item.id} canManage={canManage} onCancel={() => setCreating(false)} onCreated={async () => { notify(t("inventory.barcodes.created")); await load(); setCreating(false); }} />}
    {commandError && <div className="inline-notice" role="alert">{commandError}</div>}
    {error ? <ErrorPanel error={error} retry={load} /> : loading ? <Spinner label={t("inventory.barcodes.loading")} /> : !barcodes.length ? <EmptyState title={t("inventory.barcodes.emptyTitle")} description={t("inventory.barcodes.emptyDescription")} /> : <div className="data-table-wrap flat barcode-table" role="region" tabIndex={0} aria-label={t("inventory.barcodes.tableLabel")}><table className="data-table"><thead><tr><th>{t("inventory.barcodes.value")}</th><th>{t("inventory.barcodes.symbology")}</th><th>{t("inventory.barcodes.primary")}</th><th>{t("inventory.status")}</th><th>{t("inventory.actions")}</th></tr></thead><tbody>{barcodes.map((barcode) => <tr key={barcode.id}><td><strong dir="ltr">{barcode.value}</strong></td><td><span className="code-pill" dir="ltr">{t(`inventory.barcodes.symbologies.${barcode.symbology}`)}</span></td><td><span className={`status-chip ${barcode.isPrimary ? "active" : "inactive"}`}>{t(barcode.isPrimary ? "inventory.barcodes.primaryYes" : "inventory.barcodes.primaryNo")}</span></td><td><Status active={barcode.isActive} /></td><td><div className="inline-actions">{canPrintInventoryBarcode(permissionSet, item.isActive, barcode.isActive) && <Button variant="ghost" icon="print" disabled={Boolean(busyBarcodeId || downloadingBarcodeId)} onClick={() => void downloadLabel(barcode)}>{downloadingBarcodeId === barcode.id ? t("inventory.barcodes.labelDownloading") : t("inventory.barcodes.downloadLabel")}</Button>}{canManage && barcode.isActive && !barcode.isPrimary && <Button variant="ghost" icon="check" disabled={Boolean(busyBarcodeId || downloadingBarcodeId)} onClick={() => void setPrimary(barcode)}>{t("inventory.barcodes.setPrimary")}</Button>}{canManage && barcode.isActive && <Button variant="ghost" icon="ban" disabled={Boolean(busyBarcodeId || downloadingBarcodeId)} onClick={() => void deactivate(barcode)}>{t("inventory.barcodes.deactivate")}</Button>}</div></td></tr>)}</tbody></table></div>}
    <Pagination {...meta} page={page} onChange={setPage} />
  </Modal>;
}

function BarcodeCreateForm({ itemId, canManage, onCancel, onCreated }: { itemId: string; canManage: boolean; onCancel: () => void; onCreated: () => Promise<void> }) {
  const [symbology, setSymbology] = useState<InventoryBarcodeSymbology>("CODE_128");
  const [value, setValue] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError("");
    try {
      await api<InventoryItemBarcode>(`/inventory-items/${itemId}/barcodes`, {
        method: "POST",
        body: JSON.stringify({ symbology, value: value.trim(), isPrimary }),
      });
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.barcodes.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return <form className="barcode-create-form" onSubmit={submit}>
    <div className="barcode-create-copy"><strong>{t("inventory.barcodes.createTitle")}</strong><span>{t("inventory.barcodes.createDescription")}</span></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-grid">
      <label><span>{t("inventory.barcodes.symbology")}</span><select value={symbology} onChange={(event) => setSymbology(event.target.value as InventoryBarcodeSymbology)}>{inventoryBarcodeSymbologies.map((option) => <option key={option} value={option}>{t(`inventory.barcodes.symbologies.${option}`)}</option>)}</select></label>
      <label><span>{t("inventory.barcodes.value")}</span><input dir="ltr" inputMode="text" autoComplete="off" maxLength={255} value={value} onChange={(event) => setValue(event.target.value)} required /></label>
      <label className="checkbox-line"><input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} />{t("inventory.barcodes.makePrimary")}</label>
    </div>
    <div className="form-actions"><Button type="button" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button><Button type="submit" disabled={saving || !value.trim()}>{saving ? t("common.saving") : t("inventory.barcodes.add")}</Button></div>
  </form>;
}

function CatalogToolbar({ search, status, searchLabel, createLabel, onSearch, onSubmit, onStatus, onCreate }: { search: string; status: string; searchLabel: string; createLabel: string; onSearch: (value: string) => void; onSubmit: () => void; onStatus: (value: string) => void; onCreate: () => void }) {
  return <div className="toolbar treasury-filters inventory-catalog-toolbar"><SearchBox value={search} label={searchLabel} onChange={onSearch} onSubmit={onSubmit} /><select aria-label={t("inventory.status")} value={status} onChange={(event) => onStatus(event.target.value)}><option value="">{t("inventory.status")}</option><option value="true">{t("inventory.active")}</option><option value="false">{t("inventory.inactive")}</option></select><Button icon="plus" onClick={onCreate}>{createLabel}</Button></div>;
}

function SearchBox({ value, label, onChange, onSubmit }: { value: string; label: string; onChange: (value: string) => void; onSubmit: () => void }) {
  return <form className="search-box" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><Icon name="search" size={18} /><input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} /><button type="submit">{t("pages.accounts.026")}</button></form>;
}

function Status({ active }: { active: boolean }) {
  return <span className={`status-chip ${active ? "active" : "inactive"}`}>{active ? t("inventory.active") : t("inventory.inactive")}</span>;
}

function ErrorPanel({ error, retry }: { error: string; retry: () => Promise<void> }) {
  return <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void retry()}>{t("common.retry")}</Button></div>;
}

function listQuery(page: number, search: string, status: string) {
  return new URLSearchParams({ page: String(page), pageSize: "10", ...(search ? { search } : {}), ...(status ? { active: status } : {}) });
}

function WarehouseForm({ warehouse, onClose, onSaved }: { warehouse: Warehouse | null; onClose: () => void; onSaved: () => void }) {
  const [nameAr, setNameAr] = useState(warehouse?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(warehouse?.nameEn ?? "");
  const [address, setAddress] = useState(warehouse?.address ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(warehouse ? `/warehouses/${warehouse.id}` : "/warehouses", { method: warehouse ? "PATCH" : "POST", body: JSON.stringify({ ...(warehouse ? { version: warehouse.version } : {}), nameAr: nameAr.trim(), nameEn: nameEn.trim() || null, address: address.trim() || null }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return <Modal title={warehouse ? t("inventory.editTitle") : t("inventory.create")} description={t("inventory.formDescription")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid">{warehouse ? <label><span>{t("inventory.code")}</span><input dir="ltr" value={warehouse.code} readOnly /></label> : <div className="inline-notice neutral full">{t("common.autoGeneratedCode")}</div>}<label><span>{t("inventory.nameAr")}</span><input value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={160} required /></label><label><span>{t("inventory.nameEn")}</span><input dir="ltr" value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={160} /></label><label className="full"><span>{t("inventory.address")}</span><textarea value={address} onChange={(event) => setAddress(event.target.value)} maxLength={300} rows={3} /></label></div><FormActions saving={saving} onClose={onClose} /></form></Modal>;
}

function UnitForm({ unit, onClose, onSaved }: { unit: UnitOfMeasure | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(unit?.code ?? "");
  const [nameAr, setNameAr] = useState(unit?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(unit?.nameEn ?? "");
  const [decimalPlaces, setDecimalPlaces] = useState(unit?.decimalPlaces ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(unit ? `/units-of-measure/${unit.id}` : "/units-of-measure", { method: unit ? "PATCH" : "POST", body: JSON.stringify({ ...(unit ? { version: unit.version } : { code: code.trim() }), nameAr: nameAr.trim(), nameEn: nameEn.trim() || null, decimalPlaces }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.units.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return <Modal title={unit ? t("inventory.units.editTitle") : t("inventory.units.create")} description={t("inventory.units.formDescription")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid"><label><span>{t("inventory.code")}</span><input dir="ltr" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} pattern="[A-Za-z][A-Za-z0-9_-]{0,19}" maxLength={20} readOnly={Boolean(unit)} required /></label><label><span>{t("inventory.nameAr")}</span><input value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={120} required /></label><label><span>{t("inventory.nameEn")}</span><input dir="ltr" value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={120} /></label><label><span>{t("inventory.units.decimals")}</span><select value={decimalPlaces} onChange={(event) => setDecimalPlaces(Number(event.target.value))}>{[0, 1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><FormActions saving={saving} onClose={onClose} /></form></Modal>;
}

function ItemForm({ item, units, onClose, onSaved }: { item: InventoryItem | null; units: UnitOfMeasure[]; onClose: () => void; onSaved: () => void }) {
  const choices = item && !units.some(({ id }) => id === item.unitOfMeasure.id) ? [item.unitOfMeasure, ...units] : units;
  const [unitOfMeasureId, setUnitOfMeasureId] = useState(item?.unitOfMeasure.id ?? units[0]?.id ?? "");
  const [nameAr, setNameAr] = useState(item?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(item?.nameEn ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(item ? `/inventory-items/${item.id}` : "/inventory-items", { method: item ? "PATCH" : "POST", body: JSON.stringify({ ...(item ? { version: item.version, ...(unitOfMeasureId === item.unitOfMeasure.id ? {} : { unitOfMeasureId }) } : { unitOfMeasureId }), nameAr: nameAr.trim(), nameEn: nameEn.trim() || null, description: description.trim() || null }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.items.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return <Modal title={item ? t("inventory.items.editTitle") : t("inventory.items.create")} description={t("inventory.items.formDescription")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid">{item ? <label><span>{t("inventory.code")}</span><input dir="ltr" value={item.code} readOnly /></label> : <div className="inline-notice neutral full">{t("common.autoGeneratedCode")}</div>}<label><span>{t("inventory.items.unit")}</span><select value={unitOfMeasureId} onChange={(event) => setUnitOfMeasureId(event.target.value)} required>{choices.map((unit) => <option key={unit.id} value={unit.id} disabled={!unit.isActive}>{unit.code} — {localizedReferenceName(unit)}</option>)}</select></label><label><span>{t("inventory.nameAr")}</span><input value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={200} required /></label><label><span>{t("inventory.nameEn")}</span><input dir="ltr" value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={200} /></label><label className="full"><span>{t("inventory.items.description")}</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} /></label></div><FormActions saving={saving} onClose={onClose} /></form></Modal>;
}

function FormActions({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  return <div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("inventory.cancel")}</Button><Button type="submit" disabled={saving}>{saving ? t("inventory.saving") : t("inventory.save")}</Button></div>;
}
