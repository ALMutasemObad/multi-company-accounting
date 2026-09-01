import React, { type SubmitEvent, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";
import { PosPage } from "./PosPage";
import { PosOperatingContext } from "./PosOperatingContext";
import { PosCart } from "./PosCart";
import { PosCatalog } from "./PosCatalog";
import { InventoryBarcodeScanner, type InventoryBarcodeScannerHandle } from "./InventoryBarcodeScanner";
import { PosRecoveryPanel, type PosRecoveryPanelProps } from "./PosRecoveryPanel";
import { type PosCatalogItem } from "./pos-experience-catalog";
import { CashierContextPanel, type CashierContextPanelProps } from "./CashierContextPanel";
import { PosScopePanel } from "./PosScopePanel";
import { type CashierContextField } from "./cashier-context-model";
import { deferred, key1, key2, memoryStorage, recoveryResult, recoveryScope, serializedLocks } from "./pos-recovery-test-fixtures";
import { posRecoveryKey } from "./pos-recovery-model";
import { loadLocale } from "./i18n/core";

// A narrow hook/child-port harness for the real PosPage callbacks, controller and browser
// adapter, including the page's layout/history effects. Children are ports, not mounted
// controls. This does NOT prove React DOM/StrictMode, actual Web Locks, scanner hardware,
// native disabled controls, browser rendering, CSRF, real sessions or DB acceptance.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as unknown[], effects: [] as (() => void)[], cleanups: new Map<number, () => void>() }));
const auth = vi.hoisted(() => ({ user: { id: "1", displayName: "Cashier" }, selectedCompany: { id: "2", name: "Company", timezone: "Asia/Riyadh" },
  permissions: [] as string[], modules: ["POS", "SALES", "INVENTORY", "TREASURY"], permissionSet: new Set<string>() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: <T,>(initial: T | (() => T)) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.cells)) hooks.cells[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [hooks.cells[slot] as T, (update: T | ((value: T) => T)) => { hooks.cells[slot] = typeof update === "function" ? (update as (value: T) => T)(hooks.cells[slot] as T) : update; }];
  },
  useRef: <T,>(value: T) => { const slot = hooks.cursor++; if (!(slot in hooks.cells)) hooks.cells[slot] = { current: value }; return hooks.cells[slot]; },
  useCallback: <T,>(callback: T) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    const slot = hooks.cursor++; const old = hooks.cells[slot] as unknown[] | undefined;
    if (old && old.length === dependencies.length && old.every((value, index) => Object.is(value, dependencies[index]))) return;
    hooks.cells[slot] = dependencies;
    hooks.effects.push(() => { hooks.cleanups.get(slot)?.(); const cleanup = effect(); if (cleanup) hooks.cleanups.set(slot, cleanup); });
  },
  useLayoutEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    const slot = hooks.cursor++; const old = hooks.cells[slot] as unknown[] | undefined;
    if (old && old.length === dependencies.length && old.every((value, index) => Object.is(value, dependencies[index]))) return;
    hooks.cells[slot] = dependencies;
    hooks.effects.push(() => { hooks.cleanups.get(slot)?.(); const cleanup = effect(); if (cleanup) hooks.cleanups.set(slot, cleanup); });
  },
}));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), api: vi.fn() }));
vi.mock("./authorization-context", async original => ({ ...await original<typeof import("./authorization-context")>(), useAuthorization: () => auth }));
vi.mock("./i18n", async original => ({ ...await original<typeof import("./i18n")>(), useI18n: () => ({ locale: "en", t: (key: string) => key }) }));

function element<P>(tree: ReactNode, type: unknown): ReactElement<P> {
  for (const child of React.Children.toArray(tree)) {
    if (!React.isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === type) return child as unknown as ReactElement<P>;
    try { return element<P>(child.props.children, type); } catch { /* Search the next sibling. */ }
  }
  throw new Error("Missing child port");
}
const item: PosCatalogItem = { inventoryItemId: "55", code: "ITM-55", nameAr: "Item", nameEn: "Item", description: null, isActive: true,
  unitOfMeasure: { id: "1", code: "EA", nameAr: "Each", nameEn: "Each", decimalPlaces: 0, isActive: true },
  sellingProfile: { id: "56", unitPrice: "1.2500", currencyId: "3", currencyCode: "SAR", revenueAccountId: "57", taxRateId: null, isActive: true, version: 1 },
  isReady: true, readinessReason: null };
const notify = vi.fn(); const transport = vi.mocked(api);
const fullPermissions = ["pos.checkout", "sales_catalog.view", "inventory_barcodes.resolve", "warehouses.view", "cash_bank_accounts.view", "currencies.view"];
const contextIds: Record<CashierContextField, string> = { warehouseId: "6", cashBankAccountId: "7", paymentMethodId: "8", currencyId: "3" };
let checkoutReply: () => Promise<object>; let recoveryReply: () => Promise<object>;
let identityReply: (() => Promise<object>) | undefined;
const echo = (body: object = {}) => ({ ...body, posContext: { userId: auth.user.id, companyId: auth.selectedCompany.id } });
async function route(path: string): Promise<object> {
  if (path.startsWith("/pos/context/identity")) return identityReply ? identityReply() : echo();
  if (path.startsWith("/pos/context/period?")) {
    const documentDate = new URL(path, "https://test.local").searchParams.get("documentDate")!;
    return echo({ documentDate, status: "RESOLVED", period: { id: "4", name: "Owner period", status: "OPEN", version: 1, startDate: documentDate, endDate: documentDate } });
  }
  if (path.startsWith("/pos/context/references/")) {
    const [, , , , field, id] = path.split("/");
    return echo({ status: "available", reference: { id, label: `Owner ${id}`, revision: "1", code: "SAR", nameAr: "Owner", nameEn: "Owner",
      ...(field === "paymentMethodId" ? { requiresReference: false } : {}), ...(field === "currencyId" ? { isBase: id === "3" } : {}) } });
  }
  if (path === "/pos/checkouts") return checkoutReply();
  if (path === "/pos/checkouts/recovery") return recoveryReply();
  if (path.startsWith("/pos/sales?")) return echo({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  throw new Error(`Unexpected test request: ${path}`);
}
const commands = () => transport.mock.calls.filter(([path]) => path === "/pos/checkouts");
const recoveryReads = () => transport.mock.calls.filter(([path]) => path === "/pos/checkouts/recovery");
let tree: ReactElement; let barcodeBusy = false;
const scannerHandle: InventoryBarcodeScannerHandle = { hasPending: () => barcodeBusy, reset: vi.fn(), focus: vi.fn() };
const cart = () => element<Parameters<typeof PosCart>[0]>(tree, PosCart).props;
const context = () => element<Parameters<typeof PosOperatingContext>[0]>(tree, PosOperatingContext).props;
const catalog = () => element<Parameters<typeof PosCatalog>[0]>(tree, PosCatalog).props;
const recovery = () => element<PosRecoveryPanelProps>(tree, PosRecoveryPanel).props;
const scanner = () => element<React.ComponentProps<typeof InventoryBarcodeScanner>>(tree, InventoryBarcodeScanner).props;
const cashier = () => element<CashierContextPanelProps>(tree, CashierContextPanel).props;
const scopePanel = () => element<Parameters<typeof PosScopePanel>[0]>(tree, PosScopePanel).props;
function render() {
  hooks.cursor = 0;
  const outer = PosPage({ notify }); const experience = outer.type as (props: { notify: typeof notify }) => ReactElement;
  tree = experience({ notify });
  try { const ref = scanner().ref as React.RefObject<InventoryBarcodeScannerHandle | null>; ref.current = scannerHandle; } catch { /* Hidden while scoped identity is unavailable or viewer-only. */ }
  const effects = hooks.effects.splice(0); for (const effect of effects) effect();
}
function unmount() { for (const cleanup of hooks.cleanups.values()) cleanup(); hooks.cleanups.clear(); hooks.cells = []; hooks.effects = []; }
async function settle() { for (let pass = 0; pass < 3; pass += 1) { for (let step = 0; step < 32; step += 1) await Promise.resolve(); render(); } }
function submit() {
  let prevented = false; let stopped = false;
  const event: SubmitEvent<HTMLFormElement> = {
    type: "submit", bubbles: true, cancelable: true, eventPhase: 2, isTrusted: false, timeStamp: 0,
    preventDefault() { prevented = true; }, isDefaultPrevented: () => prevented,
    stopPropagation() { stopped = true; }, isPropagationStopped: () => stopped, persist() {},
    get defaultPrevented() { return prevented; },
    // This callback harness has no DOM. Fail explicitly if the tested handler starts
    // depending on native event/element state instead of fabricating a form element.
    get nativeEvent(): never { throw new Error("Submit fixture has no native DOM event"); },
    get currentTarget(): never { throw new Error("Submit fixture has no current DOM element"); },
    get target(): never { throw new Error("Submit fixture has no target DOM element"); },
  };
  element<React.FormHTMLAttributes<HTMLFormElement>>(tree, "form").props.onSubmit!(event);
}
async function reviewContext() {
  const controller = cashier().controller;
  for (const field of Object.keys(contextIds) as CashierContextField[]) await controller.select(field, contextIds[field]);
  render(); const reviewed = controller.review(); expect(reviewed).not.toBeNull(); cashier().onReviewed(reviewed!); render();
}
async function prepareCart() {
  await reviewContext();
  context().onChange({ description: "Sale", customerId: "5" });
  render(); catalog().onAdd(item); render();
}

// Match bootstrap's real Arabic fallback before messageForError reads the dictionary.
beforeAll(async () => { await loadLocale("ar"); });

beforeEach(async () => {
  unmount(); vi.clearAllMocks(); auth.user.id = "1"; auth.selectedCompany.id = "2"; barcodeBusy = false;
  auth.permissions = [...fullPermissions]; auth.permissionSet = new Set(auth.permissions); identityReply = undefined;
  const { storage } = memoryStorage(); const locks = serializedLocks();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn(), removeEventListener: vi.fn(), requestAnimationFrame: vi.fn() });
  vi.stubGlobal("localStorage", storage); vi.stubGlobal("navigator", { locks: { request: (name: string, _options: unknown, work: () => Promise<unknown>) => locks.run(name, work) } });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => key1) });
  checkoutReply = async () => { throw new TypeError("lost"); }; recoveryReply = async () => echo({ outcome: "UNKNOWN" });
  transport.mockImplementation(async <T,>(path: string) => await route(path) as T);
  render(); await settle();
});
afterEach(() => { unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PosPage recovery wiring via hook and child-port harness", () => {
  it("sends one UUIDv4 command, freezes edits synchronously, reloads marker and only reads the original outcome", async () => {
    await prepareCart(); const editContext = context().onChange; const editCart = cart().onChange; const add = catalog().onAdd;
    const originalKey = cart().lines[0]!.key;
    submit(); submit(); editContext({ notes: "late" }); editCart(originalKey, { quantity: "9" }); add(item); await settle();
    expect(commands()).toHaveLength(1);
    expect(transport).toHaveBeenCalledWith("/pos/checkouts", expect.objectContaining({ method: "POST", idempotencyKey: key1, signal: expect.any(AbortSignal), timeoutMs: 20_000 }));
    expect(cart().lines[0]!.quantity).toBe("1.000000"); expect(context().value.notes).toBe("");
    expect(cart().blocked).toBe(true); expect(catalog().blocked).toBe(true); expect(scanner().blocked).toBe(true); expect(recovery().state.status).toBe("unknown");
    const marker = window.localStorage.getItem(posRecoveryKey(recoveryScope))!;
    expect(Object.keys(JSON.parse(marker)).sort()).toEqual(["attemptKey", "startedAt", "version"]);
    expect(marker).not.toContain("Sale"); unmount(); render(); await settle(); submit(); await settle();
    expect(cart().lines).toEqual([]); expect(commands()).toHaveLength(1); expect(recoveryReads()).toHaveLength(1);
    recoveryReply = async () => echo({ outcome: "CONFIRMED", result: recoveryResult }); recovery().onCheck(); await settle();
    expect(transport).toHaveBeenLastCalledWith("/pos/checkouts/recovery", expect.objectContaining({ method: "POST", body: JSON.stringify({ attemptKey: key1 }), signal: expect.any(AbortSignal), timeoutMs: 10_000 }));
    expect(transport.mock.calls.at(-1)![1]).not.toHaveProperty("idempotencyKey");
    const confirmed = recovery().state;
    expect(confirmed).toEqual({ status: "confirmed", result: recoveryResult }); expect(confirmed.status === "confirmed" && confirmed.result.invoice.id).toBe("8");
    expect(recovery()).not.toHaveProperty("currencyCode");
  });

  it("waits for scanner FIFO and selling-profile requests before acquiring a checkout marker", async () => {
    await prepareCart(); barcodeBusy = true; submit(); await settle(); expect(commands()).toHaveLength(0); barcodeBusy = false;
    const profile = deferred<PosCatalogItem>(); vi.spyOn(catalog().reader!, "item").mockReturnValue(profile.promise);
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(key2);
    const resolved = { inventoryItem: { id: "66", code: "ITM-66", nameAr: "Other", nameEn: "Other", unitOfMeasure: { code: "EA" } } };
    scanner().onResolved(resolved as Parameters<NonNullable<ReturnType<typeof scanner>["onResolved"]>>[0]);
    submit(); await settle(); expect(commands()).toHaveLength(0); expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBeNull();
    expect(cashier().controller.review()).toBeNull();
    profile.resolve({ ...item, inventoryItemId: "66" }); await settle(); await reviewContext(); submit(); await settle(); expect(commands()).toHaveLength(1);
  });

  it("accepts REJECTED with a verified scope echo after initial 422, then only explicit review unlocks the unchanged cart", async () => {
    await prepareCart(); const previousEdit = context().onChange;
    checkoutReply = async () => { throw new ApiError("stock", 422, "POS_CHECKOUT_REJECTED", "INSUFFICIENT_STOCK"); };
    recoveryReply = async () => echo({ outcome: "REJECTED", rejection: { code: "POS_CHECKOUT_REJECTED", reason: "INSUFFICIENT_STOCK" } });
    submit(); await settle(); expect(recovery().state.status).toBe("rejected"); expect(commands()).toHaveLength(1); expect(recoveryReads()).toHaveLength(1);
    const marker = window.localStorage.getItem(posRecoveryKey(recoveryScope)); expect(marker).not.toBeNull();
    render(); await settle(); expect(recovery().state.status).toBe("rejected"); expect(commands()).toHaveLength(1);
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBe(marker);
    barcodeBusy = true; recovery().onReviewRejected!(); await settle(); expect(recovery().state.status).toBe("rejected");
    barcodeBusy = false; recovery().onReviewRejected!(); await settle();
    expect(recovery().state.status).toBe("ready"); expect(cart().lines).toHaveLength(1); expect(context().value.customerId).toBe("5");
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBeNull();
    expect(commands()).toHaveLength(1); expect(recoveryReads()).toHaveLength(1); expect(scannerHandle.reset).not.toHaveBeenCalled();
    previousEdit({ notes: "stale" }); render(); expect(context().value.notes).toBe("");
    context().onChange({ notes: "reviewed" }); render(); expect(context().value.notes).toBe("reviewed"); expect(commands()).toHaveLength(1);
  });

  it("keeps a scoped UNKNOWN after the initial 422 reserved and never retries the financial command", async () => {
    await prepareCart();
    checkoutReply = async () => { throw new ApiError("stock", 422, "POS_CHECKOUT_REJECTED", "INSUFFICIENT_STOCK"); };
    recoveryReply = async () => echo({ outcome: "UNKNOWN" });
    submit(); await settle();
    expect(recovery().state.status).toBe("unknown"); expect(commands()).toHaveLength(1); expect(recoveryReads()).toHaveLength(1);
    const marker = window.localStorage.getItem(posRecoveryKey(recoveryScope)); expect(marker).not.toBeNull();
    recovery().onReviewRejected!(); recovery().onNewSale(); await settle();
    expect(recovery().state.status).toBe("unknown"); expect(cart().lines).toHaveLength(1);
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBe(marker); expect(commands()).toHaveLength(1);
    expect(recoveryReads()).toHaveLength(1);
  });

  it("removes only posContext: an extra recovery-body field still fails N1's strict REJECTED decoder", async () => {
    await prepareCart();
    checkoutReply = async () => { throw new ApiError("stock", 422, "POS_CHECKOUT_REJECTED", "INSUFFICIENT_STOCK"); };
    const rejection = { code: "POS_CHECKOUT_REJECTED", reason: "INSUFFICIENT_STOCK" };
    recoveryReply = async () => echo({ outcome: "REJECTED", rejection, unexpected: "must reach the strict decoder" });
    submit(); await settle();
    expect(recovery().state.status).toBe("unknown"); expect(commands()).toHaveLength(1); expect(recoveryReads()).toHaveLength(1);
    const marker = window.localStorage.getItem(posRecoveryKey(recoveryScope)); expect(marker).not.toBeNull();
    recovery().onReviewRejected!(); recovery().onNewSale(); await settle();
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBe(marker); expect(recovery().state.status).toBe("unknown");
    recoveryReply = async () => echo({ outcome: "REJECTED", rejection });
    recovery().onCheck(); await settle(); expect(recovery().state.status).toBe("rejected"); expect(commands()).toHaveLength(1);
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBe(marker);
    recovery().onReviewRejected!(); await settle(); expect(recovery().state.status).toBe("ready");
    expect(cart().lines).toHaveLength(1); expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBeNull(); expect(commands()).toHaveLength(1);
  });

  it.each(["missing", "mismatched"] as const)("quarantines a %s recovery scope echo before N1 sees REJECTED and preserves the marker", async (identity) => {
    await prepareCart(); const oldNewSale = recovery().onNewSale; const oldReview = recovery().onReviewRejected!;
    checkoutReply = async () => { throw new ApiError("stock", 422, "POS_CHECKOUT_REJECTED", "INSUFFICIENT_STOCK"); };
    recoveryReply = async () => ({ outcome: "REJECTED", rejection: { code: "POS_CHECKOUT_REJECTED", reason: "INSUFFICIENT_STOCK" },
      ...(identity === "mismatched" ? { posContext: { userId: "1", companyId: "99" } } : {}) });
    submit(); await settle();
    expect(scopePanel().state.status).toBe("quarantined"); expect(() => recovery()).toThrow("Missing child port");
    const marker = window.localStorage.getItem(posRecoveryKey(recoveryScope)); expect(marker).not.toBeNull();
    oldReview(); oldNewSale(); await settle();
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBe(marker); expect(commands()).toHaveLength(1); expect(recoveryReads()).toHaveLength(1);
    recoveryReply = async () => echo({ outcome: "UNKNOWN" }); scopePanel().onVerify(); await settle();
    expect(recovery().state.status).toBe("unknown"); expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBe(marker);
    expect(commands()).toHaveLength(1); expect(recoveryReads()).toHaveLength(2);
  });

  it("will not clear a confirmed cart for a new sale until scanner FIFO is empty", async () => {
    await prepareCart(); const previousAdd = catalog().onAdd; const previousEdit = context().onChange;
    checkoutReply = async () => echo(recoveryResult); submit(); await settle();
    barcodeBusy = true; recovery().onNewSale(); await settle(); expect(cart().lines).toHaveLength(1); expect(recovery().state.status).toBe("confirmed");
    barcodeBusy = false; recovery().onNewSale(); await settle(); expect(cart().lines).toEqual([]); expect(recovery().state.status).toBe("ready");
    expect(scannerHandle.reset).toHaveBeenCalledOnce(); expect(commands()).toHaveLength(1);
    previousAdd(item); previousEdit({ notes: "stale" }); render(); expect(cart().lines).toEqual([]); expect(context().value.notes).toBe("");
  });

  it.each(["", "0", "invalid", "1e2"])("does not reserve a marker for an invalid exchange rate %s", async exchangeRate => {
    await prepareCart(); context().onChange({ exchangeRate }); submit(); await settle();
    expect(commands()).toHaveLength(0); expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBeNull();
  });

  it("uses the current context even if a field changes before the next render", async () => {
    await prepareCart(); context().onChange({ notes: "latest", exchangeRate: "2.5" }); submit(); await settle();
    const body = JSON.parse(commands()[0]![1]!.body as string) as { notes: string; exchangeRate: string };
    expect(body).toMatchObject({ notes: "latest", exchangeRate: "2.50000000" });
  });

  it("discards a profile received while a peer tab locks the scope, then makes the same cart editable on explicit review", async () => {
    await prepareCart(); const profile = deferred<PosCatalogItem>(); vi.spyOn(catalog().reader!, "item").mockReturnValue(profile.promise);
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(key2);
    scanner().onResolved({ inventoryItem: { id: "66", code: "ITM-66", nameAr: "Other", nameEn: "Other", unitOfMeasure: { code: "EA" } } } as Parameters<ReturnType<typeof scanner>["onResolved"]>[0]);
    window.localStorage.setItem(posRecoveryKey(recoveryScope), JSON.stringify({ version: 1, attemptKey: key1, startedAt: Date.now() }));
    const listener = vi.mocked(window.addEventListener).mock.calls[0]![1] as (event: Partial<StorageEvent>) => void;
    listener({ key: posRecoveryKey(recoveryScope), storageArea: window.localStorage });
    profile.resolve({ ...item, inventoryItemId: "66" }); await settle();
    expect(cart().lines[1]!.priceSource).toBe("loading"); expect(cart().lines[1]!.unitPrice).toBe("");
    recoveryReply = async () => echo({ outcome: "REJECTED", rejection: { code: "POS_CHECKOUT_REJECTED", reason: "INSUFFICIENT_STOCK" } });
    recovery().onCheck(); await settle(); recovery().onReviewRejected!(); await settle();
    expect(cart().lines).toHaveLength(2); expect(cart().lines[1]!.priceSource).toBe("unavailable"); expect(cart().lines[1]!.unitPrice).toBe("");
    expect(commands()).toHaveLength(0); expect(recoveryReads()).toHaveLength(1);
  });

  it("does not apply an old callback or recovery result after the keyed user experience changes", async () => {
    await prepareCart(); submit(); await settle(); const response = deferred<object>(); recoveryReply = () => response.promise;
    const previousKey = PosPage({ notify }).key; const oldContext = context().onChange; recovery().onCheck();
    unmount(); auth.user.id = "3"; render(); await settle(); expect(PosPage({ notify }).key).not.toBe(previousKey);
    oldContext({ notes: "old user" }); response.resolve({ outcome: "CONFIRMED", result: recoveryResult, posContext: { userId: "1", companyId: "2" } }); await settle();
    expect(recovery().state.status).toBe("ready"); expect(context().value.notes).toBe(""); expect(cart().lines).toEqual([]);
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).not.toBeNull();
  });

  it("uses owner references and period, scopes every request, and keeps context out of the checkout fingerprint", async () => {
    await prepareCart(); submit(); await settle();
    expect(context().value.paymentMethod).toEqual({ id: "8", label: "Owner 8", requiresReference: false });
    const body = JSON.parse(commands()[0]![1]!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ fiscalPeriodId: "4", currencyId: "3", exchangeRate: "1.00000000", warehouseId: "6", cashBankAccountId: "7", paymentMethodId: "8" });
    expect(body).not.toHaveProperty("posContext"); expect(body).not.toHaveProperty("userId"); expect(body).not.toHaveProperty("companyId");
    for (const [, options] of transport.mock.calls) {
      const headers = new Headers(options?.headers);
      expect(headers.get("X-POS-Expected-User-Id")).toBe("1"); expect(headers.get("X-POS-Expected-Company-Id")).toBe("2");
    }
    expect(transport.mock.calls.some(([path]) => path === "/currencies" || path.startsWith("/fiscal-periods"))).toBe(false);
  });

  it("preserves prices when the reviewed currency is unchanged and clears only prices when it changes", async () => {
    await prepareCart(); const original = cart().lines[0]!;
    await reviewContext(); expect(cart().lines[0]!.unitPrice).toBe(original.unitPrice);
    const controller = cashier().controller; await controller.select("currencyId", "9"); render();
    cashier().onReviewed(controller.review()!); render();
    expect(context().value.exchangeRate).toBe("");
    expect(cart().lines[0]).toMatchObject({ key: original.key, inventoryItemId: original.inventoryItemId, quantity: original.quantity, revenueAccountId: original.revenueAccountId,
      unitPrice: "", priceSource: "currency-mismatch", profileCurrencyId: null, profileVersion: null });
    expect(commands()).toHaveLength(0);
  });

  it("does not reserve a marker when preflight reports a same-session company mismatch and ignores old edit/scan callbacks", async () => {
    await prepareCart(); const oldAdd = catalog().onAdd; const oldEdit = context().onChange; const oldScan = scanner().onResolved;
    identityReply = async () => { throw new ApiError("changed", 409, "POS_CONTEXT_CHANGED"); };
    submit(); await settle(); expect(scopePanel().state.status).toBe("quarantined");
    oldAdd(item); oldEdit({ notes: "stale" }); oldScan({ inventoryItem: { id: "66", code: "ITM-66", nameAr: "Old scan", nameEn: "Old scan", unitOfMeasure: { code: "EA" } } } as Parameters<typeof oldScan>[0]);
    expect(() => cart()).toThrow("Missing child port"); expect(commands()).toHaveLength(0);
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBeNull();
    const calls = transport.mock.calls.length; render(); await settle(); expect(transport).toHaveBeenCalledTimes(calls);
    identityReply = undefined; scopePanel().onVerify(); await settle();
    expect(cart().lines).toHaveLength(1); expect(context().value.notes).toBe(""); expect(commands()).toHaveLength(0);
  });

  it("rechecks review freshness after identity returns and before reserving the marker", async () => {
    await prepareCart(); const pendingIdentity = deferred<object>(); identityReply = () => pendingIdentity.promise;
    const controller = cashier().controller; const pendingReview = vi.spyOn(controller, "getReviewed");
    submit(); expect(controller.getSnapshot().lock).toBe("checkout-pending");
    pendingReview.mockReturnValue(null); pendingIdentity.resolve(echo()); await settle();
    expect(commands()).toHaveLength(0); expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBeNull();
    expect(recovery().state.status).toBe("ready");
  });

  it("retains a reserved attempt on context conflict; only explicit matched identity permits a recovery read", async () => {
    await prepareCart(); const oldNewSale = recovery().onNewSale; const oldReview = recovery().onReviewRejected!; const oldCheck = recovery().onCheck;
    checkoutReply = async () => { throw new ApiError("changed", 409, "POS_CONTEXT_CHANGED"); };
    submit(); await settle(); expect(scopePanel().state.status).toBe("quarantined"); expect(commands()).toHaveLength(1);
    const marker = window.localStorage.getItem(posRecoveryKey(recoveryScope)); expect(marker).not.toBeNull();
    oldNewSale(); oldReview(); oldCheck(); await settle();
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBe(marker); expect(recoveryReads()).toHaveLength(0);
    // Override the full envelope rather than treating a matching CSRF cookie as identity.
    identityReply = async () => ({ posContext: { userId: "1", companyId: "99" } });
    scopePanel().onVerify(); await settle(); expect(scopePanel().state.status).toBe("quarantined"); expect(recoveryReads()).toHaveLength(0);
    identityReply = undefined; recoveryReply = async () => echo({ outcome: "CONFIRMED", result: recoveryResult });
    scopePanel().onVerify(); await settle();
    expect(recovery().state).toEqual({ status: "confirmed", result: recoveryResult }); expect(recoveryReads()).toHaveLength(1); expect(commands()).toHaveLength(1);
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBe(marker);
  });

  it("never runs automatic marker recovery before bootstrap identity succeeds", async () => {
    unmount(); transport.mockClear();
    window.localStorage.setItem(posRecoveryKey(recoveryScope), JSON.stringify({ version: 1, attemptKey: key1, startedAt: Date.now() }));
    identityReply = async () => { throw new ApiError("old csrf", 403, "FORBIDDEN"); }; render(); await settle();
    expect(scopePanel().state.status).toBe("quarantined"); expect(recoveryReads()).toHaveLength(0); expect(commands()).toHaveLength(0);
    identityReply = undefined; scopePanel().onVerify(); await settle();
    expect(recovery().state.status).toBe("unknown"); expect(recoveryReads()).toHaveLength(1); expect(commands()).toHaveLength(0);
    recovery().onNewSale(); await settle(); expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).not.toBeNull();
  });

  it("preserves history for pos.view-only without reading N2 or allowing checkout/recovery actions", async () => {
    unmount(); transport.mockClear(); auth.permissions = ["pos.view"]; auth.permissionSet = new Set(auth.permissions);
    render(); await settle();
    expect(transport.mock.calls.map(([path]) => path)).toEqual(["/pos/context/identity?purpose=history", "/pos/sales?page=1&pageSize=10"]);
    expect(() => cashier()).toThrow("Missing child port"); expect(() => recovery()).toThrow("Missing child port"); expect(() => context()).toThrow("Missing child port");
    expect(element<React.HTMLAttributes<HTMLElement>>(tree, "details")).toBeDefined();
  });

  it("makes no requests when both POS capabilities are absent", async () => {
    unmount(); transport.mockClear(); auth.permissions = []; auth.permissionSet = new Set(); render(); await settle();
    expect(scopePanel().canVerify).toBe(false); scopePanel().onVerify(); await settle(); expect(transport).not.toHaveBeenCalled();
    expect(() => recovery()).toThrow("Missing child port");
  });
});
