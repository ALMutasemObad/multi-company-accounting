import type { CashierContextReadPort, CashierContextReference, CashierContextReferenceResult, CashierContextField, CashierContextPeriodResult } from "./cashier-context-model";
import type { PosRequest } from "./pos-scope-transport";

export type PosContextOption = CashierContextReference & { code: string; nameAr: string; nameEn: string | null; isAvailable: boolean };
export const posContextOptionsPath = (field: CashierContextField) => `/pos/context/options/${field}`;
export function createPosContextReader(request: PosRequest): CashierContextReadPort {
  return {
    reference: async ({ field, id, signal }) => {
      const result = await request<CashierContextReferenceResult>(`/pos/context/references/${field}/${encodeURIComponent(id)}`, { signal, timeoutMs: 10_000 });
      if (result.status === "available" && field === "currencyId" && typeof result.reference?.isBase !== "boolean") return { status: "unavailable" };
      return result;
    },
    period: ({ documentDate, signal }) => request<CashierContextPeriodResult>(`/pos/context/period?documentDate=${encodeURIComponent(documentDate)}`, { signal, timeoutMs: 10_000 }),
  };
}
