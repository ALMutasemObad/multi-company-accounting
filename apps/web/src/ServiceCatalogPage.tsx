import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, idempotencyKey } from "./api";
import { useAuthorization } from "./authorization-context";
import { useI18n, type TranslationKey } from "./i18n";
import { Button, EmptyState, Modal, PageHeader, Pagination, Spinner } from "./ui";
import "./service-catalog.css";

type Notice = (message: string, tone?: "success" | "error") => void;
type Status = "DRAFT" | "ACTIVE" | "INACTIVE" | "RETIRED";
type CategoryStatus = Exclude<Status, "DRAFT">;
type Unit = "EACH" | "HOUR" | "DAY" | "SESSION" | "MONTH";
type Meta = { page: number; pageSize: number; total: number; totalPages: number };
type Category = { id: string; nameAr: string; nameEn: string | null; status: CategoryStatus; version: number };
type Offering = { id: string; code: string; nameAr: string; nameEn: string | null; category: Category | null;
  status: Status; variantCount: number; version: number };
type Variant = { id: string; nameAr: string; nameEn: string | null; pricingUnit: Unit;
  availableFrom: string | null; availableUntil: string | null; status: Status; version: number };
type Form = { kind: "category"; item?: Category } | { kind: "offering"; item?: Offering }
  | { kind: "variant"; offering: Offering; item?: Variant }
  | { kind: "transition"; subject: "category" | "offering" | "variant"; id: string;
    offeringId?: string; name: string; version: number; to: CategoryStatus | Status };
const emptyMeta: Meta = { page: 1, pageSize: 10, total: 0, totalPages: 0 };
const units: Unit[] = ["EACH", "HOUR", "DAY", "SESSION", "MONTH"];

export function ServiceCatalogPage({ notify }: { notify: Notice }) {
  const { selectedCompany, user, permissionSet } = useAuthorization();
  return <ServiceCatalogWorkspace key={JSON.stringify([user.id, selectedCompany?.id, [...permissionSet].sort()])} notify={notify} />;
}

function ServiceCatalogWorkspace({ notify }: { notify: Notice }) {
  const { t, locale } = useI18n();
  const { permissionSet } = useAuthorization();
  const canManage = permissionSet.has("services.manage");
  const [categories, setCategories] = useState<Category[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [categoryMeta, setCategoryMeta] = useState<Meta>(emptyMeta);
  const [offeringMeta, setOfferingMeta] = useState<Meta>(emptyMeta);
  const [variantMeta, setVariantMeta] = useState<Meta>(emptyMeta);
  const [categoryPage, setCategoryPage] = useState(1);
  const [offeringPage, setOfferingPage] = useState(1);
  const [variantPage, setVariantPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selected, setSelected] = useState<Offering | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [categoryLookup, setCategoryLookup] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<Category[]>([]);
  const [categorySelected, setCategorySelected] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attempts = useRef(new Map<string, string>());
  const writeController = useRef<AbortController | null>(null);
  const displayName = (item: { nameAr: string; nameEn?: string | null }) => locale === "en" && item.nameEn ? item.nameEn : item.nameAr;
  const statusLabel = (status: Status) => t(`service.status.${status}` as TranslationKey);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const query = submittedSearch ? `&search=${encodeURIComponent(submittedSearch)}` : "";
      const [categoryResult, offeringResult] = await Promise.all([
        api<{ data: Category[]; meta: Meta }>(`/service-catalog/categories?page=${categoryPage}&pageSize=20`, { signal }),
        api<{ data: Offering[]; meta: Meta }>(`/service-catalog/offerings?page=${offeringPage}&pageSize=10${query}`, { signal }),
      ]);
      if (signal?.aborted) return;
      setCategories(categoryResult.data); setCategoryMeta(categoryResult.meta);
      setOfferings(offeringResult.data); setOfferingMeta(offeringResult.meta);
      setSelected((previous) => previous ? offeringResult.data.find(item => item.id === previous.id) ?? previous : null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : t("service.loadError"));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [categoryPage, offeringPage, submittedSearch, t]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!selected) { setVariants([]); setVariantMeta(emptyMeta); return; }
    const controller = new AbortController();
    setVariantsLoading(true);
    void api<{ data: Variant[]; meta: Meta }>(`/service-catalog/offerings/${selected.id}/variants?page=${variantPage}&pageSize=10`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setVariants(result.data); setVariantMeta(result.meta); } })
      .catch(cause => { if (!controller.signal.aborted) notify(cause instanceof Error ? cause.message : t("service.loadError"), "error"); })
      .finally(() => { if (!controller.signal.aborted) setVariantsLoading(false); });
    return () => controller.abort();
  }, [selected?.id, variantPage, t, notify]);

  useEffect(() => () => writeController.current?.abort(), []);
  useEffect(() => {
    if (form?.kind !== "offering") return;
    const controller = new AbortController();
    const query = categoryLookup.trim() ? `&search=${encodeURIComponent(categoryLookup.trim())}` : "";
    void api<{ data: Category[] }>(`/service-catalog/categories?page=1&pageSize=20&status=ACTIVE${query}`,
      { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setCategoryOptions(result.data); })
      .catch(cause => { if (!controller.signal.aborted) notify(cause instanceof Error ? cause.message : t("service.loadError"), "error"); });
    return () => controller.abort();
  }, [form?.kind, categoryLookup, notify, t]);
  const send = async (path: string, method: "POST" | "PATCH", body: Record<string, unknown>, signal: AbortSignal) => {
    const payload = JSON.stringify(body);
    const fingerprint = JSON.stringify([path, method, payload]);
    let key = attempts.current.get(fingerprint);
    if (!key) { key = idempotencyKey("service-catalog", "command"); attempts.current.set(fingerprint, key); }
    const result = await api(path, { method, body: payload, signal, idempotencyKey: key });
    attempts.current.delete(fingerprint);
    return result;
  };
  const mutate = async (path: string, method: "POST" | "PATCH", body: Record<string, unknown>) => {
    if (!canManage || writeController.current) return;
    const controller = new AbortController();
    writeController.current = controller; setBusy(true);
    try {
      await send(path, method, body, controller.signal);
      if (controller.signal.aborted) return;
      setForm(null); notify(t("service.saved"));
      await load(controller.signal);
      if (selected) {
        const result = await api<{ data: Variant[]; meta: Meta }>(`/service-catalog/offerings/${selected.id}/variants?page=${variantPage}&pageSize=10`, { signal: controller.signal });
        if (!controller.signal.aborted) { setVariants(result.data); setVariantMeta(result.meta); }
      }
    } catch (cause) {
      if (!controller.signal.aborted) notify(cause instanceof Error ? cause.message : t("service.loadError"), "error");
    } finally {
      if (writeController.current === controller) writeController.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const openTransition = (subject: Form & { kind: "transition" }) => setForm(subject);
  const openOffering = (item?: Offering) => {
    setCategoryLookup(""); setCategorySelected(item?.category ?? null);
    setForm(item ? { kind: "offering", item } : { kind: "offering" });
  };
  const transitionButtons = (subject: "category" | "offering" | "variant", item: { id: string; nameAr: string; nameEn?: string | null; status: Status; version: number }, offeringId?: string) => {
    if (!canManage || item.status === "RETIRED") return null;
    const action = (to: Status) => openTransition({ kind: "transition", subject, id: item.id, offeringId,
      name: displayName(item), version: item.version, to });
    return <span className="toolbar">
      {item.status === "ACTIVE" ? <Button disabled={busy} variant="secondary" onClick={() => action("INACTIVE")}>{t("service.deactivate")}</Button>
        : <Button disabled={busy} variant="secondary" onClick={() => action("ACTIVE")}>{t("service.activate")}</Button>}
      <Button disabled={busy} variant="ghost" onClick={() => action("RETIRED")}>{t("service.retire")}</Button>
    </span>;
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setOfferingPage(1); setSubmittedSearch(search.trim()); };
  return <div className="workspace-page service-catalog-page">
    <PageHeader kicker={t("service.kicker")} title={t("service.title")} description={t("service.description")}
      actions={canManage ? <Button disabled={busy} icon="plus" onClick={() => openOffering()}>{t("service.newOffering")}</Button> : undefined} />
    <p role="note">{t("service.boundary")}</p>
    {error && <div className="alert error" role="alert">{error}<Button variant="ghost" onClick={() => void load()}>{t("common.retry")}</Button></div>}
    {loading ? <Spinner label={t("service.loading")} /> : !error && <>
      <section className="panel" aria-labelledby="service-categories-title">
        <header><h2 id="service-categories-title">{t("service.categories")}</h2><Button disabled={busy} variant="secondary" icon="plus" onClick={() => setForm({ kind: "category" })}>{t("service.newCategory")}</Button></header>
        {!categories.length ? <EmptyState title={t("service.emptyCategories")} description={t("service.boundary")} />
          : <ul>{categories.map(item => <li key={item.id}><strong>{displayName(item)}</strong> · {statusLabel(item.status)}
            {canManage && item.status !== "RETIRED" && <Button disabled={busy} variant="ghost" onClick={() => setForm({ kind: "category", item })}>{t("service.edit")}</Button>}
            {transitionButtons("category", item)}</li>)}</ul>}
        <Pagination page={categoryMeta.page} totalPages={categoryMeta.totalPages} total={categoryMeta.total} onChange={setCategoryPage} />
      </section>
      <section className="panel" aria-labelledby="service-offerings-title">
        <header><h2 id="service-offerings-title">{t("service.offerings")}</h2></header>
        <form role="search" className="toolbar" onSubmit={submitSearch}><label><span>{t("service.search")}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><Button type="submit" variant="secondary" icon="search">{t("service.searchAction")}</Button></form>
        {!offerings.length ? <EmptyState title={t("service.emptyOfferings")} description={t("service.description")} /> : <ul>
          {offerings.map(item => <li key={item.id}>
            <Button variant="ghost" onClick={() => { setSelected(item); setVariantPage(1); }}>{displayName(item)} · <span dir="ltr">{item.code}</span></Button>
            <span>{statusLabel(item.status)} · {item.category ? displayName(item.category) : t("service.noCategory")}</span>
            {canManage && item.status !== "RETIRED" && <Button disabled={busy} variant="ghost" onClick={() => openOffering(item)}>{t("service.edit")}</Button>}
            {transitionButtons("offering", item)}
          </li>)}
        </ul>}
        <Pagination page={offeringMeta.page} totalPages={offeringMeta.totalPages} total={offeringMeta.total} onChange={setOfferingPage} />
      </section>
      <section className="panel" aria-labelledby="service-variants-title">
        <header><h2 id="service-variants-title">{t("service.variants")}{selected ? ` · ${displayName(selected)}` : ""}</h2>
          {selected && <Button disabled={busy || selected.status === "RETIRED"} variant="secondary" icon="plus" onClick={() => setForm({ kind: "variant", offering: selected })}>{t("service.newVariant")}</Button>}
        </header>
        {!selected ? <p>{t("service.selectOffering")}</p> : variantsLoading ? <Spinner /> : !variants.length
          ? <EmptyState title={t("service.emptyVariants")} description={t("service.boundary")} />
          : <ul>{variants.map(item => <li key={item.id}>
            <strong>{displayName(item)}</strong> · {t(`service.unit.${item.pricingUnit}` as TranslationKey)} · {statusLabel(item.status)}
            {item.availableFrom && <span> · {t("service.start")}: <time>{item.availableFrom}</time></span>}
            {item.availableUntil && <span> · {t("service.until")}: <time>{item.availableUntil}</time></span>}
            {canManage && item.status !== "RETIRED" && selected.status !== "RETIRED" &&
              <Button disabled={busy} variant="ghost" onClick={() => setForm({ kind: "variant", offering: selected, item })}>{t("service.edit")}</Button>}
            {transitionButtons("variant", item, selected.id)}
          </li>)}</ul>}
        <Pagination page={variantMeta.page} totalPages={variantMeta.totalPages} total={variantMeta.total} onChange={setVariantPage} />
      </section>
    </>}
    {form?.kind === "category" && <Modal title={t(form.item ? "service.editCategory" : "service.newCategory")} onClose={() => { if (!busy) setForm(null); }}>
      <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void mutate(
        form.item ? `/service-catalog/categories/${form.item.id}` : "/service-catalog/categories", form.item ? "PATCH" : "POST", {
        ...(form.item ? { expectedVersion: form.item.version } : {}),
        nameAr: String(data.get("nameAr") ?? "").trim(), nameEn: String(data.get("nameEn") ?? "").trim() || null,
      }); }}><fieldset className="form-grid" disabled={busy}>
        <label><span>{t("service.nameAr")}</span><input name="nameAr" required maxLength={160} defaultValue={form.item?.nameAr ?? ""} autoFocus /></label>
        <label><span>{t("service.nameEn")}</span><input name="nameEn" maxLength={160} defaultValue={form.item?.nameEn ?? ""} /></label>
        <div className="modal-actions full"><Button type="button" variant="ghost" onClick={() => setForm(null)}>{t("common.cancel")}</Button><Button type="submit">{t("service.save")}</Button></div>
      </fieldset></form>
    </Modal>}
    {form?.kind === "offering" && <Modal title={t(form.item ? "service.editOffering" : "service.newOffering")} onClose={() => { if (!busy) setForm(null); }}>
      <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void mutate(
        form.item ? `/service-catalog/offerings/${form.item.id}` : "/service-catalog/offerings", form.item ? "PATCH" : "POST", {
        ...(form.item ? { expectedVersion: form.item.version } : {}),
        nameAr: String(data.get("nameAr") ?? "").trim(), nameEn: String(data.get("nameEn") ?? "").trim() || null,
        ...(form.item && categorySelected?.id === form.item.category?.id ? {} : { categoryId: categorySelected?.id ?? null }),
      }); }}><fieldset className="form-grid" disabled={busy}>
        <label><span>{t("service.nameAr")}</span><input name="nameAr" required maxLength={200} defaultValue={form.item?.nameAr ?? ""} autoFocus /></label>
        <label><span>{t("service.nameEn")}</span><input name="nameEn" maxLength={200} defaultValue={form.item?.nameEn ?? ""} /></label>
        <label className="full"><span>{t("service.searchCategory")}</span><input type="search" value={categoryLookup} onChange={event => setCategoryLookup(event.target.value)} /></label>
        <label className="full"><span>{t("service.category")}</span><select value={categorySelected?.id ?? ""} onChange={event => {
          const choice = [categorySelected, ...categoryOptions].find(item => item?.id === event.target.value);
          setCategorySelected(choice ?? null);
        }}><option value="">{t("service.noCategory")}</option>
          {[categorySelected, ...categoryOptions].filter((item, index, items): item is Category =>
            !!item && (item === categorySelected || item.status === "ACTIVE") && items.findIndex(candidate => candidate?.id === item.id) === index)
            .map(item => <option key={item.id} value={item.id}>{displayName(item)}{item.status !== "ACTIVE" ? ` · ${statusLabel(item.status)}` : ""}</option>)}
        </select></label>
        <div className="modal-actions full"><Button type="button" variant="ghost" onClick={() => setForm(null)}>{t("common.cancel")}</Button><Button type="submit">{t("service.save")}</Button></div>
      </fieldset></form>
    </Modal>}
    {form?.kind === "variant" && <Modal title={t(form.item ? "service.editVariant" : "service.newVariant")} onClose={() => { if (!busy) setForm(null); }}>
      <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void mutate(
        form.item ? `/service-catalog/offerings/${form.offering.id}/variants/${form.item.id}` : `/service-catalog/offerings/${form.offering.id}/variants`,
        form.item ? "PATCH" : "POST", {
        ...(form.item ? { expectedVersion: form.item.version } : {}),
        nameAr: String(data.get("nameAr") ?? "").trim(), nameEn: String(data.get("nameEn") ?? "").trim() || null,
        ...(!form.item ? { pricingUnit: data.get("pricingUnit") } : {}), availableFrom: data.get("availableFrom") || null,
        availableUntil: data.get("availableUntil") || null,
      }); }}><fieldset className="form-grid" disabled={busy}>
        <label><span>{t("service.nameAr")}</span><input name="nameAr" required maxLength={160} defaultValue={form.item?.nameAr ?? ""} autoFocus /></label>
        <label><span>{t("service.nameEn")}</span><input name="nameEn" maxLength={160} defaultValue={form.item?.nameEn ?? ""} /></label>
        {!form.item && <label><span>{t("service.pricingUnit")}</span><select name="pricingUnit">{units.map(unit => <option key={unit} value={unit}>{t(`service.unit.${unit}` as TranslationKey)}</option>)}</select></label>}
        <label><span>{t("service.start")}</span><input name="availableFrom" type="date" defaultValue={form.item?.availableFrom ?? ""} /></label>
        <label><span>{t("service.until")}</span><input name="availableUntil" type="date" defaultValue={form.item?.availableUntil ?? ""} /></label>
        <div className="modal-actions full"><Button type="button" variant="ghost" onClick={() => setForm(null)}>{t("common.cancel")}</Button><Button type="submit">{t("service.save")}</Button></div>
      </fieldset></form>
    </Modal>}
    {form?.kind === "transition" && <Modal title={`${displayName({ nameAr: form.name })} · ${statusLabel(form.to)}`} onClose={() => { if (!busy) setForm(null); }}>
      <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget);
        const path = form.subject === "category" ? `/service-catalog/categories/${form.id}/transition`
          : form.subject === "offering" ? `/service-catalog/offerings/${form.id}/transition`
            : `/service-catalog/offerings/${form.offeringId}/variants/${form.id}/transition`;
        void mutate(path, "POST", { expectedVersion: form.version, to: form.to, reason: String(data.get("reason") ?? "").trim() });
      }}><fieldset className="form-grid" disabled={busy}>
        <label className="full"><span>{t("service.reason")}</span><textarea name="reason" required minLength={10} maxLength={500} autoFocus /></label>
        <div className="modal-actions full"><Button type="button" variant="ghost" onClick={() => setForm(null)}>{t("common.cancel")}</Button><Button type="submit">{t("service.save")}</Button></div>
      </fieldset></form>
    </Modal>}
  </div>;
}
