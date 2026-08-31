import { useEffect, useRef, useState } from "react";
import { localizedReferenceName, useI18n } from "./i18n";
import { POS_CATALOG_SEARCH_LIMIT, posCatalogReader, type PosCatalogItem } from "./pos-experience-catalog";
import { posMoneyText } from "./pos-experience-money";
import type { PosDisplayMode } from "./pos-experience-preferences";
import { Button, Pagination, Spinner } from "./ui";

export function PosCatalog({ enabled, blocked, mode, onMode, onAdd }: {
  enabled: boolean; blocked: boolean; mode: PosDisplayMode;
  onMode: (mode: PosDisplayMode) => void; onAdd: (item: PosCatalogItem) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<PosCatalogItem[]>([]);
  const [meta, setMeta] = useState({ page: 1, pageSize: 24, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const epoch = useRef(0);

  useEffect(() => {
    const current = ++epoch.current;
    const controller = new AbortController();
    setItems([]); setError(false); setLoading(enabled);
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      void posCatalogReader.list(page, search, controller.signal).then((result) => {
        if (controller.signal.aborted || current !== epoch.current) return;
        setItems(result.data); setMeta(result.meta);
      }).catch(() => {
        if (!controller.signal.aborted && current === epoch.current) setError(true);
      }).finally(() => {
        if (!controller.signal.aborted && current === epoch.current) setLoading(false);
      });
    }, search ? 250 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [enabled, page, search, revision]);

  return <section className="pos-experience-catalog" aria-labelledby="pos-catalog-title">
    <header className="pos-experience-section-header">
      <h2 id="pos-catalog-title">{t("pos.catalog")}</h2>
      <div className="pos-experience-view-switch" role="group" aria-label={t("pos.displayMode")}>
        <Button type="button" variant="secondary" aria-pressed={mode === "retail"} onClick={() => onMode("retail")}>{t("pos.retail")}</Button>
        <Button type="button" variant="secondary" aria-pressed={mode === "tiles"} onClick={() => onMode("tiles")}>{t("pos.tiles")}</Button>
      </div>
    </header>
    <label><span>{t("pos.search")}</span><input type="search" value={search} maxLength={POS_CATALOG_SEARCH_LIMIT} disabled={!enabled}
      onChange={(event) => { setSearch(event.target.value); setPage(1); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder={t("pos.searchHint")} /></label>
    {!enabled ? <p role="status">{t("pos.catalogPermission")}</p>
      : loading ? <Spinner label={t("common.loading")} />
      : error ? <div role="alert"><p>{t("pos.catalogError")}</p><Button type="button" variant="secondary" onClick={() => setRevision((value) => value + 1)}>{t("common.retry")}</Button></div>
      : <><div className={`pos-experience-products ${mode}`} aria-live="polite">
        {items.length === 0 ? <p>{t("pos.catalogEmpty")}</p> : items.map((item) => <button key={item.inventoryItemId} type="button"
          className="pos-experience-product" disabled={blocked || !item.isActive || !item.unitOfMeasure.isActive} onClick={() => onAdd(item)}>
          <span className="pos-experience-product-name"><strong>{localizedReferenceName(item)}</strong><span>{item.code} · {item.unitOfMeasure.code}</span></span>
          <span className="pos-experience-product-price">{item.isReady && item.sellingProfile ? <><bdi>{posMoneyText(item.sellingProfile.unitPrice)}</bdi> <bdi>{item.sellingProfile.currencyCode}</bdi></> : t("pos.needsSetup")}</span>
          <span className="pos-experience-product-action">{t("pos.addItem")}</span>
        </button>)}
      </div><Pagination {...meta} page={page} onChange={setPage} /></>}
  </section>;
}
