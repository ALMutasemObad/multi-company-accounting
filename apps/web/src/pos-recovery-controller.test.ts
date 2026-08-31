import { describe, expect, it, vi } from "vitest";
import { createPosRecoveryController, type PosRecoveryDependencies } from "./pos-recovery-controller";
import { POS_RECOVERY_WARNING_MS, posRecoveryKey, readPosRecoveryMarker, readPosRecoveryOutcome, readPosRecoveryResult } from "./pos-recovery-model";
import { deferred, key1, key2, memoryStorage, recoveryResult, recoveryScope, serializedLocks } from "./pos-recovery-test-fixtures";

function fixture(overrides: Partial<PosRecoveryDependencies> = {}) {
  const { values, storage } = memoryStorage();
  const read = vi.fn().mockResolvedValue({ outcome: "UNKNOWN" });
  const deps: PosRecoveryDependencies = { storage, read, exclusive: serializedLocks(), createKey: () => key1, now: () => 1000, ...overrides };
  const controller = createPosRecoveryController(deps); controller.activate(recoveryScope);
  return { controller, deps, read, values, storage };
}
const lost = async () => { throw new Error("response lost"); };

describe("POS durable recovery markers and refresh", () => {
  it("persists only the marker before sending; refresh reads without replaying the financial command", async () => {
    const { controller, deps, values, read } = fixture();
    const send = vi.fn(async (key: string) => {
      expect(key).toBe(key1);
      expect(JSON.parse(values.get(posRecoveryKey(recoveryScope))!)).toEqual({ version: 1, attemptKey: key1, startedAt: 1000 });
      return lost();
    });
    await controller.begin(send); controller.dispose();
    const fresh = createPosRecoveryController(deps); fresh.activate(recoveryScope);
    expect(fresh.getSnapshot().status).toBe("unknown");
    expect(await fresh.begin(send)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    await fresh.check();
    expect(read).toHaveBeenCalledWith(key1, expect.any(AbortSignal));
    expect(send).toHaveBeenCalledTimes(1);
    expect(fresh.getSnapshot()).toEqual({ status: "unknown", reason: "unconfirmed" });
    expect(JSON.stringify(fresh.getSnapshot())).not.toContain(key1);
    expect([...values.values()].join()).not.toMatch(/invoice|receipt|password|body|total|Customer/);
  });

  it.each([401, 403, 404, 409, 422, 500])("does not release unknown on HTTP %i", async status => {
    const { controller, read, values } = fixture(); await controller.begin(lost);
    read.mockRejectedValue({ status, attemptKey: "must not surface", responseBody: recoveryResult });
    await controller.check();
    expect(controller.getSnapshot()).toEqual({ status: "unknown", reason: "unconfirmed" });
    expect(await controller.newSale()).toBe(false); expect(values.size).toBe(1);
  });

  it("accepts a late confirmed result only by reading the server, and explicitly starts the next sale", async () => {
    const { controller, read, values } = fixture(); await controller.begin(lost);
    await controller.check(); expect(controller.getSnapshot().status).toBe("unknown");
    read.mockResolvedValue({ outcome: "CONFIRMED", result: { ...recoveryResult, attemptKey: key1, password: "secret" } });
    await controller.check(); expect(controller.getSnapshot()).toEqual({ status: "confirmed", result: recoveryResult });
    expect([...values.values()].join()).not.toContain("9007199");
    expect(await controller.begin(vi.fn())).toBe(false);
    await controller.check(); expect(read).toHaveBeenCalledTimes(2);
    expect(await controller.newSale()).toBe(true); expect(values.size).toBe(0);
    expect(controller.getSnapshot().status).toBe("ready");
  });

  it.each([POS_RECOVERY_WARNING_MS, POS_RECOVERY_WARNING_MS + 1, 24 * 60 * 60 * 1000])("never clears or replays at age %i", async age => {
    let clock = 1000;
    const { controller, deps, values, read } = fixture({ now: () => clock }); await controller.begin(lost);
    const original = [...values.values()][0]; clock += age;
    const fresh = createPosRecoveryController(deps); fresh.activate(recoveryScope);
    expect(fresh.getSnapshot()).toEqual({ status: "unknown", reason: "expired" });
    expect(await fresh.newSale()).toBe(false); expect(await fresh.begin(vi.fn())).toBe(false);
    await fresh.check(); expect([...values.values()][0]).toBe(original);
    read.mockResolvedValue({ outcome: "CONFIRMED", result: recoveryResult });
    await fresh.check(); expect(fresh.getSnapshot().status).toBe("confirmed");
  });

  it.each([Number.NaN, -1, 999])("keeps an existing marker on invalid/rollback clock %s", async clock => {
    const { controller, deps, values } = fixture(); await controller.begin(lost);
    const fresh = createPosRecoveryController({ ...deps, now: () => clock }); fresh.activate(recoveryScope);
    expect(fresh.getSnapshot()).toEqual({ status: "unknown", reason: "clock" });
    await fresh.check(); expect(values.size).toBe(1);
  });
});

describe("POS storage failure and tab coordination", () => {
  it.each(["read", "quota", "discard", "locks"])("fails closed before dispatch on %s failure", async failure => {
    const { storage } = memoryStorage();
    if (failure === "read") storage.getItem = () => { throw new Error("private mode"); };
    if (failure === "quota") storage.setItem = () => { throw new Error("quota"); };
    if (failure === "discard") storage.setItem = () => undefined;
    const { controller } = fixture({ storage, ...(failure === "locks" ? { exclusive: null } : {}) });
    const send = vi.fn(); expect(await controller.begin(send)).toBe(false);
    expect(send).not.toHaveBeenCalled(); expect(controller.getSnapshot().status).toBe("blocked");
  });

  it.each(["{", "null", "[]", '{"version":2}', JSON.stringify({ version: 1, attemptKey: key1, startedAt: 1, body: "sensitive" })])("retains corrupted or unsupported marker %s", async raw => {
    const { storage, values } = memoryStorage(); values.set(posRecoveryKey(recoveryScope), raw);
    const { controller, read } = fixture({ storage }); const send = vi.fn();
    expect(controller.getSnapshot()).toEqual({ status: "blocked", reason: "storage" });
    await controller.begin(send); await controller.check();
    expect(send).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(values.get(posRecoveryKey(recoveryScope))).toBe(raw);
  });

  it("serializes two tabs and double clicks before either command response arrives", async () => {
    const { storage, values } = memoryStorage(); const exclusive = serializedLocks(); const response = deferred<unknown>();
    const one = fixture({ storage, exclusive }); const two = fixture({ storage, exclusive, createKey: () => key2 });
    const send = vi.fn(() => response.promise);
    const first = one.controller.begin(send); const double = one.controller.begin(send); const other = two.controller.begin(send);
    expect(await double).toBe(false); expect(await other).toBe(false);
    expect(send).toHaveBeenCalledTimes(1); expect(values.size).toBe(1);
    expect(two.controller.getSnapshot().status).toBe("unknown");
    response.reject(new Error("lost")); await first;
    expect(one.controller.getSnapshot().status).toBe("unknown");
  });

  it("storage events cannot open the lock or manufacture confirmation", async () => {
    const { controller, values } = fixture(); await controller.begin(lost);
    controller.storageChanged(posRecoveryKey({ ...recoveryScope, companyId: "3" }));
    expect(controller.getSnapshot().status).toBe("unknown");
    values.delete(posRecoveryKey(recoveryScope)); controller.storageChanged(null);
    expect(controller.getSnapshot()).toEqual({ status: "blocked", reason: "storage" });
    expect(await controller.begin(vi.fn())).toBe(false);
    values.set(posRecoveryKey(recoveryScope), JSON.stringify({ version: 1, attemptKey: key1, startedAt: 1000, outcome: "CONFIRMED", result: recoveryResult }));
    controller.storageChanged(null); expect(controller.getSnapshot().status).toBe("blocked");
  });

  it("a new-tab storage notification may only close a ready checkout", async () => {
    const { storage } = memoryStorage(); const exclusive = serializedLocks();
    const one = fixture({ storage, exclusive }); const two = fixture({ storage, exclusive });
    await one.controller.begin(lost); two.controller.storageChanged(posRecoveryKey(recoveryScope));
    expect(two.controller.getSnapshot().status).toBe("unknown");
    expect(await two.controller.newSale()).toBe(false);
  });

  it("does not dispatch when the persisted marker disappears before leaving the lock", async () => {
    const { storage, values } = memoryStorage();
    const exclusive = { run: async <T>(_name: string, work: () => Promise<T>) => { const result = await work(); values.clear(); return result; } };
    const { controller } = fixture({ storage, exclusive }); const send = vi.fn();
    expect(await controller.begin(send)).toBe(false); expect(send).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({ status: "blocked", reason: "storage" });
  });

  it("unsupported locks stay blocked even if an event supplies a marker", () => {
    const { controller, values } = fixture({ exclusive: null });
    values.set(posRecoveryKey(recoveryScope), JSON.stringify({ version: 1, attemptKey: key1, startedAt: 1000 }));
    controller.storageChanged(null);
    expect(controller.getSnapshot()).toEqual({ status: "blocked", reason: "coordination" });
  });

  it("will not open a confirmed sale if marker removal fails", async () => {
    const { controller, storage } = fixture(); await controller.begin(async () => recoveryResult);
    storage.removeItem = () => { throw new Error("storage denied"); };
    expect(await controller.newSale()).toBe(false); expect(controller.getSnapshot().status).toBe("blocked");
  });
});

describe("POS scope, authorization and stale results", () => {
  it.each([{ userId: "3" }, { companyId: "3" }, { canCheckout: false }])("hides a late read after context change %j and retains its marker", async change => {
    const response = deferred<unknown>(); const { controller, read, values } = fixture();
    await controller.begin(lost); read.mockReturnValue(response.promise);
    const checking = controller.check(); controller.activate({ ...recoveryScope, ...change });
    response.resolve({ outcome: "CONFIRMED", result: recoveryResult }); await checking;
    expect(JSON.stringify(controller.getSnapshot())).not.toMatch(/9007199|SI-0008|550e8400/);
    expect(values.size).toBe(1);
    controller.activate(recoveryScope); expect(controller.getSnapshot().status).toBe("unknown");
  });

  it("ignores checkout completion after logout, including adapters that ignore abort", async () => {
    const response = deferred<unknown>(); const entered = deferred<void>(); const { controller, values } = fixture();
    const sending = controller.begin(async () => { entered.resolve(); return response.promise; });
    await entered.promise; controller.activate(null); response.resolve(recoveryResult); await sending;
    expect(controller.getSnapshot()).toEqual({ status: "blocked", reason: "permission" }); expect(values.size).toBe(1);
  });

  it("never reads another scope's marker, even with view-only permission", async () => {
    const { controller, storage, values, read } = fixture(); await controller.begin(lost);
    const spy = vi.spyOn(storage, "getItem"); spy.mockClear();
    controller.activate({ ...recoveryScope, canCheckout: false }); await controller.check();
    expect(spy).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    controller.activate({ ...recoveryScope, userId: "4" });
    expect(spy).toHaveBeenCalledExactlyOnceWith(posRecoveryKey({ ...recoveryScope, userId: "4" })); expect(values.size).toBe(1);
  });

  it("blocks duplicate reads and ignores a stale read after a newer confirmation", async () => {
    const response = deferred<unknown>(); const { controller, read } = fixture(); await controller.begin(lost);
    read.mockReturnValueOnce(response.promise); const oldRead = controller.check(); await controller.check();
    expect(read).toHaveBeenCalledTimes(1);
    controller.activate(recoveryScope); read.mockResolvedValue({ outcome: "CONFIRMED", result: recoveryResult });
    await controller.check(); response.resolve({ outcome: "UNKNOWN" }); await oldRead;
    expect(controller.getSnapshot().status).toBe("confirmed");
  });

  it("does not send if scope changes while waiting for the cross-tab lock", async () => {
    const gate = deferred<void>(); const exclusive = { run: async <T>(_name: string, work: () => Promise<T>) => { await gate.promise; return work(); } };
    const { controller, values } = fixture({ exclusive }); const send = vi.fn();
    const starting = controller.begin(send); controller.activate(null); gate.resolve();
    expect(await starting).toBe(false); expect(send).not.toHaveBeenCalled(); expect(values.size).toBe(0);
  });
});

describe("POS acknowledgement decoding", () => {
  it("keeps decimal strings and projects out secrets without persisting a result", () => {
    expect(readPosRecoveryResult({ ...recoveryResult, body: "secret" })).toEqual(recoveryResult);
    expect(readPosRecoveryOutcome({ outcome: "CONFIRMED", result: recoveryResult })).toEqual({ outcome: "CONFIRMED", result: recoveryResult });
    expect(readPosRecoveryMarker(JSON.stringify({ version: 1, attemptKey: key1, startedAt: 1000 }))).not.toBeNull();
  });
  it("rejects oversized markers, out-of-range BIGINT and normalized invalid dates", () => {
    expect(readPosRecoveryMarker(" ".repeat(257))).toBeNull();
    expect(readPosRecoveryResult({ ...recoveryResult, id: "18446744073709551616" })).toBeNull();
    expect(readPosRecoveryResult({ ...recoveryResult, completedAt: "2026-02-30T08:30:00.000Z" })).toBeNull();
  });
  it.each([{}, null, { outcome: "FAILED" }, { outcome: "NOT_FOUND" }, { outcome: "CONFIRMED", result: {} },
    { outcome: "CONFIRMED", result: { ...recoveryResult, invoice: { ...recoveryResult.invoice, total: 123.45 } } },
    { outcome: "CONFIRMED", result: { ...recoveryResult, receipt: { ...recoveryResult.receipt, status: "REVERSED" } } },
  ])("never upgrades partial or invalid evidence to confirmation: %j", value => {
    expect(readPosRecoveryOutcome(value)).toEqual({ outcome: "UNKNOWN" });
  });
});
