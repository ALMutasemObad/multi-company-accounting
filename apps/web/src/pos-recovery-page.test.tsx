import React, { type SubmitEvent, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";
import { PosPage } from "./PosPage";
import { PosOperatingContext } from "./PosOperatingContext";
import { PosCart } from "./PosCart";
import { PosCatalog } from "./PosCatalog";
import { InventoryBarcodeScanner, type InventoryBarcodeScannerHandle } from "./InventoryBarcodeScanner";
import { PosRecoveryPanel, type PosRecoveryPanelProps } from "./PosRecoveryPanel";
import { posCatalogReader, type PosCatalogItem } from "./pos-experience-catalog";
import { deferred, key1, key2, memoryStorage, recoveryResult, recoveryScope, serializedLocks } from "./pos-recovery-test-fixtures";
import { posRecoveryKey } from "./pos-recovery-model";
import { loadLocale } from "./i18n/core";

// A narrow hook/child-port harness for the real PosPage callbacks, controller and browser
// adapter. This does NOT mount React DOM, run reference/history effects or prove Web Locks,
// scanner hardware, native disabled controls, browser rendering, CSRF or DB acceptance.
const hooks = vi.hoisted(() => ({ cursor: 0, cells: [] as unknown[], effects: [] as (() => void)[], cleanups: new Map<number, () => void>() }));
const auth = vi.hoisted(() => ({ user: { id: "1", displayName: "Cashier" }, selectedCompany: { id: "2", name: "Company", timezone: "Asia/Riyadh" },
  permissions: ["pos.checkout", "sales_catalog.view", "inventory_barcodes.resolve"], modules: ["POS", "SALES", "INVENTORY"],
  permissionSet: new Set(["pos.checkout", "sales_catalog.view", "inventory_barcodes.resolve"]) }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: <T,>(initial: T | (() => T)) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.cells)) hooks.cells[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [hooks.cells[slot] as T, (update: T | ((value: T) => T)) => { hooks.cells[slot] = typeof update === "function" ? (update as (value: T) => T)(hooks.cells[slot] as T) : update; }];
  },
  useRef: <T,>(value: T) => { const slot = hooks.cursor++; if (!(slot in hooks.cells)) hooks.cells[slot] = { current: value }; return hooks.cells[slot]; },
  useCallback: <T,>(callback: T) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: () => undefined,
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
let tree: ReactElement; let barcodeBusy = false;
const scannerHandle: InventoryBarcodeScannerHandle = { hasPending: () => barcodeBusy, reset: vi.fn(), focus: vi.fn() };
const cart = () => element<Parameters<typeof PosCart>[0]>(tree, PosCart).props;
const context = () => element<Parameters<typeof PosOperatingContext>[0]>(tree, PosOperatingContext).props;
const catalog = () => element<Parameters<typeof PosCatalog>[0]>(tree, PosCatalog).props;
const recovery = () => element<PosRecoveryPanelProps>(tree, PosRecoveryPanel).props;
const scanner = () => element<React.ComponentProps<typeof InventoryBarcodeScanner>>(tree, InventoryBarcodeScanner).props;
function render() {
  hooks.cursor = 0;
  const outer = PosPage({ notify }); const experience = outer.type as (props: { notify: typeof notify }) => ReactElement;
  tree = experience({ notify });
  const ref = scanner().ref as React.RefObject<InventoryBarcodeScannerHandle | null>; ref.current = scannerHandle;
  const effects = hooks.effects.splice(0); for (const effect of effects) effect();
}
function unmount() { for (const cleanup of hooks.cleanups.values()) cleanup(); hooks.cleanups.clear(); hooks.cells = []; hooks.effects = []; }
async function settle() { for (let step = 0; step < 24; step += 1) await Promise.resolve(); render(); }
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
function prepareCart() {
  context().onChange({ periodId: "4", currencyId: "3", description: "Sale", customerId: "5", warehouseId: "6", cashAccountId: "7",
    paymentMethod: { id: "8", code: "CASH", nameAr: "Cash", requiresReference: false, isActive: true, scope: "COMPANY", version: 1 } });
  render(); catalog().onAdd(item); render();
}

// Match bootstrap's real Arabic fallback before messageForError reads the dictionary.
beforeAll(async () => { await loadLocale("ar"); });

beforeEach(() => {
  unmount(); vi.clearAllMocks(); auth.user.id = "1"; auth.selectedCompany.id = "2"; barcodeBusy = false;
  const { storage } = memoryStorage(); const locks = serializedLocks();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn(), removeEventListener: vi.fn(), requestAnimationFrame: vi.fn() });
  vi.stubGlobal("localStorage", storage); vi.stubGlobal("navigator", { locks: { request: (name: string, _options: unknown, work: () => Promise<unknown>) => locks.run(name, work) } });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => key1) }); transport.mockRejectedValue(new TypeError("lost"));
  render(); render();
});
afterEach(() => { unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PosPage recovery wiring via hook and child-port harness", () => {
  it("sends one UUIDv4 command, freezes edits synchronously, reloads marker and only reads the original outcome", async () => {
    prepareCart(); const editContext = context().onChange; const editCart = cart().onChange; const add = catalog().onAdd;
    const originalKey = cart().lines[0]!.key;
    submit(); submit(); editContext({ notes: "late" }); editCart(originalKey, { quantity: "9" }); add(item); await settle();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith("/pos/checkouts", expect.objectContaining({ method: "POST", idempotencyKey: key1, signal: expect.any(AbortSignal), timeoutMs: 20_000 }));
    expect(cart().lines[0]!.quantity).toBe("1.000000"); expect(context().value.notes).toBe("");
    expect(cart().blocked).toBe(true); expect(catalog().blocked).toBe(true); expect(scanner().blocked).toBe(true); expect(recovery().state.status).toBe("unknown");
    const marker = window.localStorage.getItem(posRecoveryKey(recoveryScope))!;
    expect(Object.keys(JSON.parse(marker)).sort()).toEqual(["attemptKey", "startedAt", "version"]);
    expect(marker).not.toContain("Sale"); unmount(); render(); render(); submit(); await settle();
    expect(cart().lines).toEqual([]); expect(transport).toHaveBeenCalledTimes(1);
    transport.mockResolvedValue({ outcome: "CONFIRMED", result: recoveryResult }); recovery().onCheck(); await settle();
    expect(transport).toHaveBeenLastCalledWith("/pos/checkouts/recovery", expect.objectContaining({ method: "POST", body: JSON.stringify({ attemptKey: key1 }), signal: expect.any(AbortSignal), timeoutMs: 10_000 }));
    expect(transport.mock.calls.at(-1)![1]).not.toHaveProperty("idempotencyKey");
    const confirmed = recovery().state;
    expect(confirmed).toEqual({ status: "confirmed", result: recoveryResult }); expect(confirmed.status === "confirmed" && confirmed.result.invoice.id).toBe("8");
    expect(recovery()).not.toHaveProperty("currencyCode");
  });

  it("waits for scanner FIFO and selling-profile requests before acquiring a checkout marker", async () => {
    prepareCart(); barcodeBusy = true; submit(); await settle(); expect(transport).not.toHaveBeenCalled(); barcodeBusy = false;
    const profile = deferred<PosCatalogItem>(); vi.spyOn(posCatalogReader, "item").mockReturnValue(profile.promise);
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(key2);
    const resolved = { inventoryItem: { id: "66", code: "ITM-66", nameAr: "Other", nameEn: "Other", unitOfMeasure: { code: "EA" } } };
    scanner().onResolved(resolved as Parameters<NonNullable<ReturnType<typeof scanner>["onResolved"]>>[0]);
    submit(); await settle(); expect(transport).not.toHaveBeenCalled(); expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBeNull();
    profile.resolve({ ...item, inventoryItemId: "66" }); await settle(); submit(); await settle(); expect(transport).toHaveBeenCalledTimes(1);
  });

  it("proves rejection by read, then explicit review keeps the cart and never posts automatically", async () => {
    prepareCart(); const previousEdit = context().onChange;
    transport.mockRejectedValueOnce(new ApiError("stock", 422, "POS_CHECKOUT_REJECTED", "INSUFFICIENT_STOCK"))
      .mockResolvedValueOnce({ outcome: "REJECTED", rejection: { code: "POS_CHECKOUT_REJECTED", reason: "INSUFFICIENT_STOCK" } });
    submit(); await settle(); expect(recovery().state.status).toBe("rejected"); expect(transport).toHaveBeenCalledTimes(2);
    barcodeBusy = true; recovery().onReviewRejected!(); await settle(); expect(recovery().state.status).toBe("rejected");
    barcodeBusy = false; recovery().onReviewRejected!(); await settle();
    expect(recovery().state.status).toBe("ready"); expect(cart().lines).toHaveLength(1); expect(context().value.customerId).toBe("5");
    expect(transport).toHaveBeenCalledTimes(2); expect(scannerHandle.reset).not.toHaveBeenCalled();
    previousEdit({ notes: "stale" }); render(); expect(context().value.notes).toBe("");
    context().onChange({ notes: "reviewed" }); render(); expect(context().value.notes).toBe("reviewed"); expect(transport).toHaveBeenCalledTimes(2);
  });

  it("will not clear a confirmed cart for a new sale until scanner FIFO is empty", async () => {
    prepareCart(); const previousAdd = catalog().onAdd; const previousEdit = context().onChange;
    transport.mockResolvedValueOnce(recoveryResult); submit(); await settle();
    barcodeBusy = true; recovery().onNewSale(); await settle(); expect(cart().lines).toHaveLength(1); expect(recovery().state.status).toBe("confirmed");
    barcodeBusy = false; recovery().onNewSale(); await settle(); expect(cart().lines).toEqual([]); expect(recovery().state.status).toBe("ready");
    expect(scannerHandle.reset).toHaveBeenCalledOnce(); expect(transport).toHaveBeenCalledTimes(1);
    previousAdd(item); previousEdit({ notes: "stale" }); render(); expect(cart().lines).toEqual([]); expect(context().value.notes).toBe("");
  });

  it.each(["", "0", "invalid", "1e2"])("does not reserve a marker for an invalid exchange rate %s", async exchangeRate => {
    prepareCart(); context().onChange({ exchangeRate }); submit(); await settle();
    expect(transport).not.toHaveBeenCalled(); expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).toBeNull();
  });

  it("uses the current context even if a field changes before the next render", async () => {
    prepareCart(); context().onChange({ notes: "latest", exchangeRate: "2.5" }); submit(); await settle();
    const body = JSON.parse(transport.mock.calls[0]![1]!.body as string) as { notes: string; exchangeRate: string };
    expect(body).toMatchObject({ notes: "latest", exchangeRate: "2.50000000" });
  });

  it("discards a profile received while a peer tab locks the scope, then makes the same cart editable on explicit review", async () => {
    prepareCart(); const profile = deferred<PosCatalogItem>(); vi.spyOn(posCatalogReader, "item").mockReturnValue(profile.promise);
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(key2);
    scanner().onResolved({ inventoryItem: { id: "66", code: "ITM-66", nameAr: "Other", nameEn: "Other", unitOfMeasure: { code: "EA" } } } as Parameters<ReturnType<typeof scanner>["onResolved"]>[0]);
    window.localStorage.setItem(posRecoveryKey(recoveryScope), JSON.stringify({ version: 1, attemptKey: key1, startedAt: Date.now() }));
    const listener = vi.mocked(window.addEventListener).mock.calls[0]![1] as (event: Partial<StorageEvent>) => void;
    listener({ key: posRecoveryKey(recoveryScope), storageArea: window.localStorage });
    profile.resolve({ ...item, inventoryItemId: "66" }); await settle();
    expect(cart().lines[1]!.priceSource).toBe("loading"); expect(cart().lines[1]!.unitPrice).toBe("");
    transport.mockResolvedValue({ outcome: "REJECTED", rejection: { code: "POS_CHECKOUT_REJECTED", reason: "INSUFFICIENT_STOCK" } });
    recovery().onCheck(); await settle(); recovery().onReviewRejected!(); await settle();
    expect(cart().lines).toHaveLength(2); expect(cart().lines[1]!.priceSource).toBe("unavailable"); expect(cart().lines[1]!.unitPrice).toBe("");
    expect(transport.mock.calls.every(([path]) => path === "/pos/checkouts/recovery")).toBe(true);
  });

  it("does not apply an old callback or recovery result after the keyed user experience changes", async () => {
    prepareCart(); submit(); await settle(); const response = deferred<unknown>(); transport.mockReturnValueOnce(response.promise);
    const previousKey = PosPage({ notify }).key; const oldContext = context().onChange; recovery().onCheck();
    unmount(); auth.user.id = "3"; render(); render(); expect(PosPage({ notify }).key).not.toBe(previousKey);
    oldContext({ notes: "old user" }); response.resolve({ outcome: "CONFIRMED", result: recoveryResult }); await settle();
    expect(recovery().state.status).toBe("ready"); expect(context().value.notes).toBe(""); expect(cart().lines).toEqual([]);
    expect(window.localStorage.getItem(posRecoveryKey(recoveryScope))).not.toBeNull();
  });
});
