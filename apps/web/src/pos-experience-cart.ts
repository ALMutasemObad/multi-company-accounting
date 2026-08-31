import { applyResolvedBarcodeToLines, type PosBarcodeItem } from "./barcode";
import type { PosCatalogItem } from "./pos-experience-catalog";
import { posDecimal } from "./pos-experience-money";

export type PosDraftLine = {
  key: string; inventoryItemId: string; inventoryItemLabel: string; description: string;
  quantity: string; unitPrice: string; discountAmount: string;
  revenueAccountId: string; revenueAccountLabel: string; taxRateId: string; taxRateLabel: string;
  priceSource: "manual" | "loading" | "profile" | "unavailable" | "currency-mismatch";
  profileVersion: number | null; profileCurrencyId: string | null;
};

export const blankPosLine = (): PosDraftLine => ({
  key: crypto.randomUUID(), inventoryItemId: "", inventoryItemLabel: "", description: "", quantity: "1.000000",
  unitPrice: "", discountAmount: "0.0000", revenueAccountId: "", revenueAccountLabel: "", taxRateId: "", taxRateLabel: "",
  priceSource: "manual", profileVersion: null, profileCurrencyId: null,
});

export function addPosItem(lines: readonly PosDraftLine[], item: PosBarcodeItem) {
  return applyResolvedBarcodeToLines(lines, item, blankPosLine, 50);
}

export function applyPosSellingProfile(line: PosDraftLine, item: PosCatalogItem, currencyId: string): PosDraftLine {
  const profile = item.sellingProfile;
  if (!item.isReady || !profile?.isActive || posDecimal(profile.unitPrice, 4) === null)
    return { ...line, priceSource: "unavailable" };
  if (profile.currencyId !== currencyId) return { ...line, priceSource: "currency-mismatch" };
  return { ...line, unitPrice: profile.unitPrice, revenueAccountId: profile.revenueAccountId,
    revenueAccountLabel: profile.revenueAccountId, taxRateId: profile.taxRateId ?? "", taxRateLabel: profile.taxRateId ?? "",
    priceSource: "profile", profileVersion: profile.version, profileCurrencyId: profile.currencyId };
}
