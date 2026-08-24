import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { localizedReferenceName, translate as t } from "./i18n";
import type { ListResponse, Warehouse } from "./types";
import { Button, EmptyState, Icon, Modal, PageHeader, Pagination, Spinner } from "./ui";

type Notice = (message: string, tone?: "success" | "error") => void;

export function InventoryPage({ notify }: { notify: Notice }) {
  const [items, setItems] = useState<Warehouse[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
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
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "10",
        ...(submittedSearch ? { search: submittedSearch } : {}),
        ...(status ? { active: status } : {}),
      });
      const result = await api<ListResponse<Warehouse>>(`/warehouses?${query}`);
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
      await api(`/warehouses/${item.id}/deactivate`, {
        method: "POST",
        body: JSON.stringify({ version: item.version, reason: reason.trim() }),
      });
      notify(t("inventory.deactivated"));
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : t("inventory.deactivateError"), "error");
    }
  }

  return <section className="workspace-page">
    <PageHeader kicker={t("inventory.kicker")} title={t("inventory.title")} description={t("inventory.description")} actions={<Button icon="plus" onClick={() => setForm("new")}>{t("inventory.create")}</Button>} />
    <div className="toolbar treasury-filters">
      <form className="search-box" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedSearch(search.trim()); }}><Icon name="search" size={18} /><input aria-label={t("inventory.search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("inventory.search")} /><button type="submit">{t("pages.accounts.026")}</button></form>
      <select aria-label={t("inventory.status")} value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">{t("inventory.status")}</option><option value="true">{t("inventory.active")}</option><option value="false">{t("inventory.inactive")}</option></select>
    </div>
    {error ? <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>{t("common.retry")}</Button></div> : loading ? <Spinner label={t("inventory.loading")} /> : !items.length ? <EmptyState title={t("inventory.emptyTitle")} description={t("inventory.emptyDescription")} action={<Button icon="plus" onClick={() => setForm("new")}>{t("inventory.create")}</Button>} /> : <div className="data-table-wrap" role="region" tabIndex={0} aria-label={t("common.scrollableTable")}><table className="data-table"><thead><tr><th>{t("inventory.code")}</th><th>{t("inventory.name")}</th><th>{t("inventory.address")}</th><th>{t("inventory.status")}</th><th>{t("inventory.actions")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong dir="ltr">{item.code}</strong></td><td><strong>{localizedReferenceName(item)}</strong>{item.nameEn && <small dir="ltr">{item.nameEn}</small>}</td><td>{item.address || "—"}</td><td><span className={`status-chip ${item.isActive ? "active" : "inactive"}`}>{item.isActive ? t("inventory.active") : t("inventory.inactive")}</span></td><td><div className="inline-actions"><Button variant="ghost" icon="edit" onClick={() => setForm(item)}>{t("inventory.edit")}</Button>{item.isActive && <Button variant="ghost" icon="ban" onClick={() => void deactivate(item)}>{t("inventory.deactivate")}</Button>}</div></td></tr>)}</tbody></table></div>}
    <Pagination {...meta} page={page} onChange={setPage} />
    {form && <WarehouseForm warehouse={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={async () => { const created = form === "new"; setForm(null); notify(t(created ? "inventory.created" : "inventory.updated")); await load(); }} />}
  </section>;
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
      await api(warehouse ? `/warehouses/${warehouse.id}` : "/warehouses", {
        method: warehouse ? "PATCH" : "POST",
        body: JSON.stringify({
          ...(warehouse ? { version: warehouse.version } : {}),
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim() || null,
          address: address.trim() || null,
        }),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("inventory.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return <Modal title={warehouse ? t("inventory.editTitle") : t("inventory.create")} description={t("inventory.formDescription")} onClose={onClose}><form className="document-form" onSubmit={submit}>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-grid">{warehouse ? <label><span>{t("inventory.code")}</span><input dir="ltr" value={warehouse.code} readOnly /></label> : <div className="inline-notice neutral full">{t("common.autoGeneratedCode")}</div>}<label><span>{t("inventory.nameAr")}</span><input value={nameAr} onChange={(event) => setNameAr(event.target.value)} maxLength={160} required /></label><label><span>{t("inventory.nameEn")}</span><input dir="ltr" value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={160} /></label><label className="full"><span>{t("inventory.address")}</span><textarea value={address} onChange={(event) => setAddress(event.target.value)} maxLength={300} rows={3} /></label></div><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>{t("inventory.cancel")}</Button><Button type="submit" disabled={saving}>{saving ? t("inventory.saving") : t("inventory.save")}</Button></div></form></Modal>;
}
