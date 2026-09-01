import { describe, expect, it, vi } from "vitest";
import { createCashierContextController, type CashierContextLock } from "./cashier-context-controller";
import { cashierContextFields, chooseCashierContextValue, type CashierContextReadPort, type CashierContextPeriodResult, type CashierContextReferenceResult } from "./cashier-context-model";
import { cashierReader, cashierScope, cashierValues } from "./cashier-context-test-fixtures";

const sale = { documentDate: "2026-08-31", requiresWarehouse: true };
const preparedSale = { ...sale, draft: { documentDate: sale.documentDate, values: cashierValues } };
function setup(reader: CashierContextReadPort = cashierReader) {
  const controller = createCashierContextController(reader); controller.setScope(cashierScope); return controller;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("cashier source precedence and explicit review", () => {
  it("preserves explicit draft clearing/invalidity, then remembered choice, then documented company setting", () => {
    expect(chooseCashierContextValue("warehouseId", { warehouseId: null }, { warehouseId: "2" }, { warehouseId: ["3"] })).toMatchObject({ id: null, source: "draft", status: "empty" });
    expect(chooseCashierContextValue("warehouseId", { warehouseId: "obsolete" }, { warehouseId: "2" }, { warehouseId: ["3"] })).toMatchObject({ id: "obsolete", source: "draft" });
    expect(chooseCashierContextValue("warehouseId", {}, { warehouseId: "2" }, { warehouseId: ["3"] })).toMatchObject({ id: "2", source: "session" });
    expect(chooseCashierContextValue("warehouseId", {}, {}, { warehouseId: ["3"] })).toMatchObject({ id: "3", source: "company" });
    expect(chooseCashierContextValue("warehouseId", {}, {}, { warehouseId: ["2", "3"] })).toMatchObject({ id: null, status: "ambiguous" });
    expect(chooseCashierContextValue("warehouseId", {}, {}, {})).toMatchObject({ id: null, source: "choice" });
  });
  it("does not apply even verified suggestions without a deliberate review", async () => {
    const c = setup(); await c.startSale(preparedSale);
    expect(c.getSnapshot().canReview).toBe(true); expect(c.getReviewed()).toBeNull();
    expect(c.review()).toEqual({ documentDate: sale.documentDate, fiscalPeriodId: "81", ...cashierValues, paymentRequiresReference: true });
    await c.select("warehouseId", null); expect(c.getReviewed()).toBeNull(); expect(c.review()).toBeNull();
    expect(c.getSnapshot().fields.warehouseId).toMatchObject({ id: null, source: "draft", status: "empty" });
  });
  it("only remembers after explicit consent, revalidates every new sale, and never remembers date/period/rate", async () => {
    const reference = vi.fn(cashierReader.reference); const period = vi.fn(cashierReader.period);
    const c = setup({ reference, period }); await c.startSale(preparedSale); c.review();
    await c.startSale(sale); expect(c.getSnapshot().fields.cashBankAccountId.status).toBe("empty");
    await c.startSale(preparedSale); c.review(true);
    reference.mockClear(); period.mockClear();
    await c.startSale({ ...sale, documentDate: "2026-09-01" });
    expect(reference).toHaveBeenCalledTimes(4); expect(period).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().fields.warehouseId).toMatchObject({ id: "31", source: "session" });
    expect(c.getSnapshot().documentDate).toBe("2026-09-01"); expect(c.getReviewed()).toBeNull();
    expect(c.review()).not.toHaveProperty("exchangeRate");
  });
  it("saves a draft only on request, preserves manual clearing and doesn't overwrite it on further edits", async () => {
    const c = setup(); await c.startSale(sale); await c.select("warehouseId", "31");
    expect(c.getSavedDraft()).toBeNull(); await c.select("cashBankAccountId", null); c.saveDraft();
    const saved = c.getSavedDraft(); await c.select("warehouseId", "32");
    expect(c.getSavedDraft()).toEqual(saved);
    await c.startSale({ ...sale, draft: saved! });
    expect(c.getSnapshot().fields.warehouseId.id).toBe("31"); expect(c.getSnapshot().fields.cashBankAccountId.id).toBeNull();
    saved!.values.warehouseId = "999"; expect(c.getSavedDraft()!.values.warehouseId).toBe("31");
  });
  it("does not copy extra financial fields from an owner's larger draft into context memory", async () => {
    const largerValues = { ...cashierValues, exchangeRate: "99.00000000", total: "123.00", barcode: "00001234", customerId: "91" };
    const c = setup(); await c.startSale({ ...sale, draft: { documentDate: sale.documentDate, values: largerValues } });
    expect(c.getSavedDraft()?.values).toEqual(cashierValues);
    c.saveDraft(); expect(c.getSavedDraft()?.values).toEqual(cashierValues);
  });
  it("keeps the explicit draft source if it is saved while a company suggestion is still validating", async () => {
    const pending = deferred<CashierContextReferenceResult>();
    const c = setup({ ...cashierReader, reference: (input) => input.field === "warehouseId" ? pending.promise : cashierReader.reference(input) });
    const started = c.startSale({ ...sale, companySuggestions: { warehouseId: ["31"] } }); c.saveDraft();
    pending.resolve({ status: "available", reference: { id: "31", label: "Warehouse", revision: "1" } }); await started;
    expect(c.getSnapshot().fields.warehouseId.source).toBe("draft"); expect(c.getSavedDraft()?.values.warehouseId).toBe("31");
  });
  it("reuses a remembered review for unchanged new-sale context only within its original verification lifetime", async () => {
    let clock = 0; const c = createCashierContextController(cashierReader, () => clock, 300_000); c.setScope(cashierScope);
    await c.startSale(preparedSale); const reviewed = c.review(true); c.setLock("checkout-completed"); c.setLock(null);
    clock = 100; await c.startSale(sale);
    expect(c.getReviewed()).toEqual(reviewed); expect(c.getMetrics().review).toBe(0);
    clock = 300_000; expect(c.getReviewed()).toBeNull(); expect(c.getSnapshot().reviewed).toBe(false);
    clock = 300_100;
    expect(c.getSnapshot().verificationExpired).toBe(true); expect(c.review()).toBeNull();
    await c.startSale(sale); expect(c.getReviewed()).toBeNull(); expect(c.getSnapshot().canReview).toBe(true);
    c.review(true); clock = 299_999; expect(c.getReviewed()).toBeNull();
  });
  it("cannot extend expired verification merely by clicking review again", async () => {
    let clock = 0; const c = createCashierContextController(cashierReader, () => clock, 10); c.setScope(cashierScope);
    await c.startSale(preparedSale); clock = 11;
    expect(c.getSnapshot().canReview).toBe(false); expect(c.review()).toBeNull();
    await c.refresh(); expect(c.review()).not.toBeNull();
  });
  it("requires review again if reference metadata changes even with unchanged ids", async () => {
    const reference = vi.fn(cashierReader.reference); const c = setup({ ...cashierReader, reference });
    await c.startSale(preparedSale); c.review(true);
    reference.mockImplementation(async (input) => {
      const result = await cashierReader.reference(input);
      return result.status === "available" ? { ...result, reference: { ...result.reference, revision: "2" } } : result;
    });
    await c.startSale(sale); expect(c.getSnapshot().canReview).toBe(true); expect(c.getReviewed()).toBeNull();
  });
  it.each(["unavailable", "forbidden", "ambiguous"] as const)("retains a %s draft id without a silent fallback", async (status) => {
    const c = setup({ ...cashierReader, reference: async (input) => input.field === "warehouseId" ? { status } : cashierReader.reference(input) });
    await c.startSale({ ...preparedSale, companySuggestions: { warehouseId: ["100"] } });
    expect(c.getSnapshot().fields.warehouseId).toMatchObject({ id: "31", source: "draft", status });
    expect(c.review(true)).toBeNull(); expect(c.getReviewed()).toBeNull();
  });
  it("requires exact-id validation: wrong, inactive/unavailable, malformed or missing payment metadata cannot be reviewed", async () => {
    for (const result of [
      { status: "available", reference: { id: "999", label: "Foreign", revision: "1", requiresReference: false } },
      { status: "available", reference: { id: "51", label: "Method", revision: "1" } },
      { status: "available", reference: { id: "51", label: "Method", revision: "", requiresReference: false } },
      { status: "unavailable" },
    ] satisfies CashierContextReferenceResult[]) {
      const c = setup({ ...cashierReader, reference: async (input) => input.field === "paymentMethodId" ? result : cashierReader.reference(input) });
      await c.startSale(preparedSale); expect(c.review()).toBeNull();
    }
  });
  it("requires a warehouse only when the operation needs inventory location, including when a scanned item makes it necessary", async () => {
    const reference = vi.fn(cashierReader.reference); const c = setup({ ...cashierReader, reference });
    await c.startSale({ ...preparedSale, requiresWarehouse: false, draft: { documentDate: sale.documentDate, values: { ...cashierValues, warehouseId: null } } });
    expect(reference).toHaveBeenCalledTimes(3); expect(c.review()?.warehouseId).toBeNull();
    await c.setRequiresWarehouse(true); expect(c.review()).toBeNull();
    await c.select("warehouseId", "31"); expect(c.review()?.warehouseId).toBe("31");
    await c.setRequiresWarehouse(false); expect(c.review()?.warehouseId).toBeNull();
    await c.setRequiresWarehouse(true); expect(c.getSnapshot().fields.warehouseId.id).toBe("31");
  });
});

describe("scope, server resolution, stale reads and barcode/checkout locks", () => {
  it("permits only a fresh, already reviewed proof for pending dispatch; it does not approve, edit, unlock or extend its lifetime", async () => {
    let clock = 0; const c = createCashierContextController(cashierReader, () => clock, 100); c.setScope(cashierScope);
    await c.startSale(preparedSale); const proof = c.review(); c.setLock("checkout-pending");
    expect(c.getReviewed()).toBeNull(); expect(c.getReviewed({ forPendingCheckout: true })).toEqual(proof);
    expect(c.review()).toBeNull(); expect(c.saveDraft()).toBe(false); expect(await c.select("currencyId", "99")).toBe(false);
    expect(await c.startSale(sale)).toBe(false); expect(await c.refresh()).toBe(false); expect(await c.changeDate("2026-09-01")).toBe(false);
    clock = 99; expect(c.getReviewed({ forPendingCheckout: true })).toEqual(proof);
    clock = 100; expect(c.getReviewed({ forPendingCheckout: true })).toBeNull(); expect(c.getSnapshot().lock).toBe("checkout-pending");
    c.setLock(null); expect(c.getReviewed()).toBeNull();
  });
  it.each(["scan-pending", "checkout-unknown", "checkout-completed"] as const)("does not expose pending-dispatch proof under %s", async (lock) => {
    const c = setup(); await c.startSale(preparedSale); c.review(); c.setLock(lock);
    expect(c.getReviewed({ forPendingCheckout: true })).toBeNull();
  });
  it("cannot create a pending-dispatch proof if the cashier never reviewed it", async () => {
    const c = setup(); await c.startSale(preparedSale); c.setLock("checkout-pending");
    expect(c.getReviewed({ forPendingCheckout: true })).toBeNull();
  });
  it.each([
    { userId: "8" }, { companyId: "12" }, { authorizationRevision: "2" },
    { permissions: [...cashierScope.permissions, "pos.view"] }, { modules: ["POS"] },
  ])("clears all draft, remembered values, labels and review synchronously on scope change %j", async (change) => {
    const c = setup(); await c.startSale(preparedSale); c.saveDraft(); c.review(true);
    c.setScope({ ...cashierScope, ...change });
    const state = c.getSnapshot(); expect(state.documentDate).toBe(""); expect(c.getSavedDraft()).toBeNull(); expect(c.getReviewed()).toBeNull();
    expect(JSON.stringify(state.fields)).not.toContain("Reference");
    c.setScope(cashierScope); await c.startSale(sale);
    expect(cashierContextFields.map((field) => c.getSnapshot().fields[field].id)).toEqual([null, null, null, null]);
  });
  it("allows no reads without checkout entitlement and no reference reads without each owner's permission", async () => {
    const reference = vi.fn(cashierReader.reference); const period = vi.fn(cashierReader.period); const c = setup({ reference, period });
    for (const scope of [null, { ...cashierScope, permissions: [] }, { ...cashierScope, modules: [] }]) {
      c.setScope(scope); await c.startSale(preparedSale);
    }
    expect(reference).not.toHaveBeenCalled(); expect(period).not.toHaveBeenCalled();
    c.setScope({ ...cashierScope, permissions: ["pos.checkout"] }); await c.startSale(preparedSale);
    expect(reference).not.toHaveBeenCalled(); expect(period).toHaveBeenCalledTimes(1); expect(c.review()).toBeNull();
  });
  it.each(["MISSING", "CLOSED", "AMBIGUOUS"] as const)("keeps %s server periods explicit and unavailable for review", async (status) => {
    const c = setup({ ...cashierReader, period: async ({ documentDate }) => ({ documentDate, status }) });
    await c.startSale(preparedSale); expect(c.getSnapshot().period.status).toBe(status); expect(c.review()).toBeNull();
  });
  it("invalidates review on date change, rejects mismatched date results and never retries missing API", async () => {
    const period = vi.fn(cashierReader.period); const c = setup({ ...cashierReader, period }); await c.startSale(preparedSale); c.review();
    period.mockResolvedValueOnce({ documentDate: "1999-01-01", status: "MISSING" });
    await c.changeDate("2026-09-01"); expect(c.getSnapshot().period.status).toBe("UNAVAILABLE"); expect(c.getReviewed()).toBeNull();
    period.mockRejectedValueOnce(new Error("endpoint absent")); await c.refresh();
    expect(period).toHaveBeenCalledTimes(3); expect(c.review()).toBeNull();
  });
  it("ignores late responses after manual changes and after company switches even when the reader ignores AbortSignal", async () => {
    const late = deferred<CashierContextReferenceResult>();
    const reference = vi.fn(cashierReader.reference).mockImplementationOnce(() => late.promise);
    const c = setup({ ...cashierReader, reference }); const pending = c.startSale(preparedSale);
    await c.select("warehouseId", "32");
    late.resolve({ status: "available", reference: { id: "31", label: "Old warehouse", revision: "1" } }); await pending;
    expect(c.getSnapshot().fields.warehouseId.id).toBe("32");
    const latePeriod = deferred<CashierContextPeriodResult>(); const c2 = setup({ ...cashierReader, period: () => latePeriod.promise });
    const pending2 = c2.startSale(preparedSale); c2.setScope({ ...cashierScope, companyId: "12" });
    latePeriod.resolve({ documentDate: sale.documentDate, status: "RESOLVED", period: { id: "81", name: "Leaked period", status: "OPEN", startDate: sale.documentDate, endDate: sale.documentDate, version: 1 } }); await pending2;
    expect(JSON.stringify(c2.getSnapshot())).not.toContain("Leaked"); expect(c2.getSnapshot().documentDate).toBe("");
  });
  it.each(["scan-pending", "checkout-pending", "checkout-unknown", "checkout-completed"] as Exclude<CashierContextLock, null>[])("blocks all context changes/review/new-sale/draft actions under %s", async (lock) => {
    const c = setup(); await c.startSale(preparedSale); c.review(true); c.setLock(lock);
    const before = c.getSnapshot(); expect(c.review(true)).toBeNull(); expect(c.getReviewed()).toBeNull();
    expect(c.saveDraft()).toBe(false); expect(await c.select("currencyId", "99")).toBe(false);
    expect(await c.changeDate("2026-09-01")).toBe(false); expect(await c.setRequiresWarehouse(false)).toBe(false);
    expect(await c.startSale(sale)).toBe(false); expect(await c.refresh()).toBe(false);
    expect(c.getSnapshot()).toEqual(before);
    c.setScope(null); expect(c.getSavedDraft()).toBeNull(); expect(c.getSnapshot().documentDate).toBe("");
  });
  it("revalidates remembered references and invalidates review when they are disabled or the period closes", async () => {
    const reference = vi.fn(cashierReader.reference); const period = vi.fn(cashierReader.period); const c = setup({ reference, period });
    await c.startSale(preparedSale); c.review(true);
    reference.mockResolvedValue({ status: "unavailable" }); period.mockResolvedValue({ documentDate: sale.documentDate, status: "CLOSED" });
    await c.startSale(sale); expect(c.review()).toBeNull(); expect(c.getSnapshot().fields.warehouseId.status).toBe("unavailable");
    expect(c.getSnapshot().period.status).toBe("CLOSED");
  });
  it("disposal erases memory and aborts pending reads", async () => {
    const pending = deferred<CashierContextPeriodResult>(); let signal: AbortSignal | undefined;
    const c = setup({ ...cashierReader, period: (input) => { signal = input.signal; return pending.promise; } });
    const started = c.startSale(preparedSale); c.dispose(); expect(signal?.aborted).toBe(true);
    pending.resolve({ documentDate: sale.documentDate, status: "MISSING" }); await started;
    expect(c.getSnapshot().scopeKey).toBe(""); expect(c.getSavedDraft()).toBeNull(); expect(c.getReviewed()).toBeNull();
  });
  it("counts only interaction categories and elapsed time without ids, labels, dates, amounts or barcode payloads", async () => {
    let clock = 100; const c = createCashierContextController(cashierReader, () => clock); c.setScope(cashierScope); await c.startSale(sale);
    for (const field of cashierContextFields) await c.select(field, cashierValues[field]!);
    c.saveDraft(); c.review(true); clock = 350;
    expect(c.getMetrics()).toEqual({ fieldChange: 4, dateChange: 0, review: 1, saveDraft: 1, remember: 1, refresh: 0, elapsedMs: 250 });
    await c.startSale(sale); clock = 450;
    expect(c.getReviewed()).not.toBeNull();
    expect(c.getMetrics()).toEqual({ fieldChange: 0, dateChange: 0, review: 0, saveDraft: 0, remember: 0, refresh: 0, elapsedMs: 100 });
    expect(Object.keys(c.getMetrics())).toEqual(["fieldChange", "dateChange", "review", "saveDraft", "remember", "refresh", "elapsedMs"]);
  });
});
