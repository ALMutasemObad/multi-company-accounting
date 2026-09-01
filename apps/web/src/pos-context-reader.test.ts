import { describe, expect, it, vi } from "vitest";
import { createPosContextReader, posContextOptionsPath } from "./pos-context-reader";
import { createCashierContextController } from "./cashier-context-controller";
import { cashierScope, cashierValues } from "./cashier-context-test-fixtures";
import type { PosRequest } from "./pos-scope-transport";

function fixture() {
  const send = vi.fn();
  const request: PosRequest = <T,>(path: string, options = {}) => send(path, options) as Promise<T>;
  const reader = createPosContextReader(request);
  return { reader, send };
}

describe("POS context adapter uses exact owner reads without financial defaults", () => {
  it("never substitutes a first-page option for an unavailable exact reference", async () => {
    const { reader, send } = fixture(); send.mockResolvedValue({ status: "unavailable" });
    const signal = new AbortController().signal;
    expect(await reader.reference({ scope: cashierScope, field: "cashBankAccountId", id: "41", signal })).toEqual({ status: "unavailable" });
    expect(send).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledWith("/pos/context/references/cashBankAccountId/41", { signal, timeoutMs: 10_000 });
  });
  it.each([undefined, null, "true", 1])("does not infer a base currency from missing or invalid isBase metadata: %j", async (isBase) => {
    const { reader, send } = fixture(); send.mockResolvedValue({ status: "available", reference: { id: "61", label: "Currency", revision: "1", isBase } });
    expect(await reader.reference({ scope: cashierScope, field: "currencyId", id: "61", signal: new AbortController().signal })).toEqual({ status: "unavailable" });
  });
  it("preserves explicit foreign-currency metadata without creating an exchange rate", async () => {
    const { reader, send } = fixture(); const reply = { status: "available", reference: { id: "61", label: "USD", revision: "1", code: "USD", isBase: false } };
    send.mockResolvedValue(reply);
    expect(await reader.reference({ scope: cashierScope, field: "currencyId", id: "61", signal: new AbortController().signal })).toEqual(reply);
    expect(reply.reference).not.toHaveProperty("exchangeRate"); expect(posContextOptionsPath("currencyId")).toBe("/pos/context/options/currencyId");
  });
  it("asks the owner to resolve the exact document date and does not fetch all fiscal periods", async () => {
    const { reader, send } = fixture(); send.mockResolvedValue({ documentDate: "2026-08-31", status: "CLOSED" }); const signal = new AbortController().signal;
    expect(await reader.period({ scope: cashierScope, documentDate: "2026-08-31", signal })).toEqual({ documentDate: "2026-08-31", status: "CLOSED" });
    expect(send).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledWith("/pos/context/period?documentDate=2026-08-31", { signal, timeoutMs: 10_000 });
  });
  it("does not manufacture missing payment semantics from the selected option", async () => {
    const { reader, send } = fixture(); send.mockImplementation(async (path: string) => {
      if (path.includes("/period?")) return { documentDate: "2026-08-31", status: "RESOLVED", period: { id: "81", name: "Period", status: "OPEN", version: 1, startDate: "2026-08-01", endDate: "2026-08-31" } };
      const id = path.split("/").at(-1)!;
      return { status: "available", reference: { id, label: "Owner reference", revision: "1", ...(path.includes("/currencyId/") ? { isBase: true } : {}) } };
    });
    const controller = createCashierContextController(reader); controller.setScope(cashierScope);
    await controller.startSale({ documentDate: "2026-08-31", requiresWarehouse: true, draft: { documentDate: "2026-08-31", values: cashierValues } });
    expect(controller.getSnapshot().fields.paymentMethodId.status).toBe("unavailable"); expect(controller.review()).toBeNull();
  });
});
