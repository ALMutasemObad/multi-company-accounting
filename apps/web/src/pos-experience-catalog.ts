import { api } from "./api";
import type { ListResponse } from "./types";

/** R2 Sales-owned read contract; keep the transport boundary in this file. */
export type PosCatalogItem = {
  inventoryItemId: string; code: string; nameAr: string; nameEn: string | null;
  description: string | null; isActive: boolean;
  unitOfMeasure: { id: string; code: string; nameAr: string; nameEn: string | null; decimalPlaces: number; isActive: boolean };
  sellingProfile: null | { id: string; unitPrice: string; currencyId: string; currencyCode: string | null; revenueAccountId: string; taxRateId: string | null; isActive: boolean; version: number };
  isReady: boolean; readinessReason: string | null;
};

export const POS_CATALOG_PAGE_SIZE = 24;
export const POS_CATALOG_SEARCH_LIMIT = 100;
export const posCatalogPolicy = { permission: "sales_catalog.view" } as const;

export function posCatalogPath(page: number, search: string) {
  const params = new URLSearchParams({ page: String(Math.min(10_000, Math.max(1, Math.floor(page)))), pageSize: String(POS_CATALOG_PAGE_SIZE) });
  const query = search.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, POS_CATALOG_SEARCH_LIMIT);
  if (query) params.set("search", query);
  return `/sales/catalog?${params}`;
}

export const posCatalogReader = {
  list: (page: number, search: string, signal: AbortSignal) =>
    api<ListResponse<PosCatalogItem>>(posCatalogPath(page, search), { signal, timeoutMs: 10_000 }),
  item: async (itemId: string, signal: AbortSignal) => {
    const result = await api<{ data: PosCatalogItem }>(`/sales/catalog/items/${encodeURIComponent(itemId)}`, { signal, timeoutMs: 10_000 });
    if (result.data.inventoryItemId !== itemId) throw new Error("Catalog identity mismatch");
    return result.data;
  },
};
