import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { localizedReferenceName, translate as t } from "./i18n";
import type { InventoryItem, ListResponse, UnitOfMeasure, Warehouse } from "./types";
import { Button, EmptyState, Icon, Modal, PageHeader, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;
type Tab = "warehouses" | "units" | "items";
type PageMeta = { page: number; pageSize: number; total: number; totalPages: number };

const emptyMeta: PageMeta = { page: 1, pageSize: 10, total: 0, totalPages: 0 };

export function InventoryPage({ notify }: { notify: Notice }) {
  const [tab, setTab] = useState<Tab>("warehouses");
  return <section className="workspace-page">
    <PageHeader kicker={t("inventory.kicker")} title={t("inventory.title")} description={t("inventory.description")} />
    <div className="section-tabs" role="tablist" aria-label={t("inventory.tabs.label")}>
      {(["warehouses", "units", "items"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{t(`inventory.tabs.${value}`)}</button>)}
    </div>
    {tab === "warehouses" && <WarehousesPanel notify={notify} />}
    {tab === "units" && <UnitsPanel notify={notify} />}
    {tab === "items" && <ItemsPanel notify={notify} />}
  </section>;
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
    {error ? <ErrorPanel error={error} retry={load} /> : loading ? <Spinner label={t("inventory.items.loading")} /> : !items.length ? <EmptyState title={t("inventory.items.emptyTitle")} description={t("inventory.items.emptyDescription")} action={units.length ? <Button icon="plus" onClick={() => setForm("new")}>{t("inventory.items.create")}</Button> : undefined} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("inventory.code")}</th><th>{t("inventory.items.name")}</th><th>{t("inventory.items.unit")}</th><th>{t("inventory.items.description")}</th><th>{t("inventory.status")}</th><th>{t("inventory.actions")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong dir="ltr">{item.code}</strong></td><td><strong>{localizedReferenceName(item)}</strong>{item.nameEn && <small dir="ltr">{item.nameEn}</small>}</td><td><span className="code-pill" dir="ltr">{item.unitOfMeasure.code}</span><small>{localizedReferenceName(item.unitOfMeasure)}</small></td><td>{item.description || "—"}</td><td><Status active={item.isActive} /></td><td><div className="inline-actions"><Button variant="ghost" icon="edit" onClick={() => setForm(item)}>{t("inventory.edit")}</Button>{item.isActive && <Button variant="ghost" icon="ban" onClick={() => void deactivate(item)}>{t("inventory.deactivate")}</Button>}</div></td></tr>)}</tbody></table></div>}
    <Pagination {...meta} page={page} onChange={setPage} />
    {form && <ItemForm item={form === "new" ? null : form} units={units} onClose={() => setForm(null)} onSaved={async () => { const created = form === "new"; setForm(null); notify(t(created ? "inventory.items.created" : "inventory.items.updated")); await load(); }} />}
  </>;
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
