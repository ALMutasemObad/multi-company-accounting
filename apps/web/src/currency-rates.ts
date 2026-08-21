import { api } from "./api";
import { exchangeRateForCurrency } from "./domain";
import type { Currency } from "./types";

export async function exchangeRateForDocumentDate(currency: Currency | undefined, documentDate: string) {
  const fallback = exchangeRateForCurrency(currency);
  if (!currency || currency.isBase || !documentDate) return fallback;
  const query = new URLSearchParams({ currencyId: currency.id, rateDate: documentDate });
  const result = await api<{ rate: string }>(`/exchange-rates/resolve?${query.toString()}`);
  return result.rate;
}

export const missingDatedRateMessage = "لا يوجد سعر صرف نافذ للعملة في تاريخ المستند؛ سجّل السعر من إعدادات الشركة أو أدخله يدويًا.";
