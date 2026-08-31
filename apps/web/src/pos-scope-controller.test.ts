import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { createPosScopeController } from "./pos-scope-controller";
import { canonicalPosId, hasExpectedPosContext, PosScopeError, posExpectedHeaders, type PosRequest, type PosRequestOptions } from "./pos-scope-transport";
import { createPosRecoveryController } from "./pos-recovery-controller";
import { deferred, key1, memoryStorage, recoveryResult, recoveryScope, serializedLocks } from "./pos-recovery-test-fixtures";

const scope = { userId: "1", companyId: "2" };
const echo = (body: object = {}, identity = scope) => ({ ...body, posContext: identity });
function fixture() {
  const send = vi.fn().mockResolvedValue(echo());
  const request: PosRequest = <T,>(path: string, options = {}) => send(path, options) as Promise<T>;
  const gate = createPosScopeController(scope, request);
  return { gate, send };
}

describe("POS expected context transport and monotonic quarantine (no real sessions/browser/DB)", () => {
  it.each(["\n", "\r", "\r\n", "\u2028", "\u2029", " ", "\t", "\u00a0"])("rejects line terminators or whitespace %j before Headers can normalize them", suffix => {
    for (const value of ["1" + suffix, suffix + "1", "1" + suffix + "2"]) {
      expect(canonicalPosId(value)).toBe(false);
      expect(() => posExpectedHeaders({ userId: value, companyId: "2" })).toThrow(PosScopeError);
      expect(() => posExpectedHeaders({ userId: "1", companyId: value })).toThrow(PosScopeError);
      expect(hasExpectedPosContext(echo({}, { userId: value, companyId: "2" }), { userId: value, companyId: "2" })).toBe(false);
      expect(hasExpectedPosContext(echo({}, { userId: "1", companyId: value }), { userId: "1", companyId: value })).toBe(false);
    }
  });
  it("retains the positive unsigned64 bounds and ASCII digit requirement", () => {
    for (const value of ["1", "9", "10", "18446744073709551615"]) expect(canonicalPosId(value)).toBe(true);
    for (const value of ["", "0", "01", "+1", "-1", "1.0", "1e1", "18446744073709551616", "100000000000000000000", "١", "１", 1, null, undefined]) expect(canonicalPosId(value)).toBe(false);
  });
  it("uses the history-only identity purpose explicitly without changing the response envelope", async () => {
    const send = vi.fn().mockResolvedValue(echo());
    const request: PosRequest = <T,>(path: string, options = {}) => send(path, options) as Promise<T>;
    const gate = createPosScopeController(scope, request, "history"); expect(await gate.activate()).toBe(true);
    expect(send.mock.calls[0]![0]).toBe("/pos/context/identity?purpose=history");
    gate.quarantine(); expect(await gate.activate()).toBe(false); expect(send).toHaveBeenCalledTimes(1);
    expect(await gate.verifyIdentity()).toBe(true); expect(send).toHaveBeenCalledTimes(2);
  });
  it("requires identity before any request, sends canonical paired headers, and preserves the body and original invoice identity", async () => {
    const { gate, send } = fixture();
    await expect(gate.request("/pos/checkouts", { method: "POST" })).rejects.toBeInstanceOf(PosScopeError); expect(send).not.toHaveBeenCalled();
    expect(await gate.activate()).toBe(true); send.mockResolvedValueOnce(echo(recoveryResult));
    const body = '{"lines":[{"inventoryItemId":"10"}]}';
    expect(await gate.request("/pos/checkouts", { method: "POST", body, idempotencyKey: key1 })).toEqual(echo(recoveryResult));
    const [path, options] = send.mock.calls.at(-1)!;
    expect(path).toBe("/pos/checkouts"); expect(options.body).toBe(body); expect(options.idempotencyKey).toBe(key1);
    expect(options.headers.get("X-POS-Expected-User-Id")).toBe("1"); expect(options.headers.get("X-POS-Expected-Company-Id")).toBe("2");
  });
  it("never accepts a late successful read to reopen a quarantined gate", async () => {
    const { gate, send } = fixture(); await gate.activate(); const late = deferred<unknown>(); send.mockReturnValueOnce(late.promise);
    const reading = gate.request("/pos/sales"); gate.quarantine(); late.resolve(echo({ data: [{ id: "sale" }] }));
    await expect(reading).rejects.toBeInstanceOf(PosScopeError); expect(gate.getSnapshot().status).toBe("quarantined");
    expect(await gate.verifyIdentity()).toBe(true); expect(gate.getSnapshot().status).toBe("ready");
  });
  it("rejects an A→B→A read whose own result belongs to B despite an otherwise current identity", async () => {
    const { gate, send } = fixture(); await gate.activate();
    send.mockResolvedValueOnce(echo({ data: [] }, { userId: "1", companyId: "3" }));
    await expect(gate.request("/sales/catalog")).rejects.toBeInstanceOf(PosScopeError);
    expect(gate.getSnapshot().status).toBe("quarantined");
  });
  it.each([{}, { posContext: { userId: "01", companyId: "2" } }, { posContext: { userId: "1", companyId: "2", extra: "not allowed" } },
    { posContext: { userId: "1", companyId: 2 } }])("rejects a missing or malformed response identity %j", async response => {
    const { gate, send } = fixture(); await gate.activate(); send.mockResolvedValueOnce(response);
    await expect(gate.request("/customers")).rejects.toBeInstanceOf(PosScopeError); expect(gate.isReady()).toBe(false);
  });
  it.each([new ApiError("context", 409, "POS_CONTEXT_CHANGED"), new ApiError("required", 400, "POS_CONTEXT_REQUIRED"),
    new ApiError("old session", 401, "UNAUTHORIZED"), new ApiError("old CSRF after login", 403, "CSRF_INVALID")])("quarantines explicit context/auth failures without calling them financial rejection: %j", async failure => {
    const { gate, send } = fixture(); await gate.activate(); send.mockRejectedValueOnce(failure);
    await expect(gate.request("/pos/checkouts/recovery", { method: "POST" })).rejects.toBe(failure); expect(gate.getSnapshot().status).toBe("quarantined");
  });
  it("does not invent context changes from ordinary business 409 or an HTTP 422", async () => {
    const { gate, send } = fixture(); await gate.activate();
    for (const failure of [new ApiError("version", 409, "VERSION_CONFLICT"), new ApiError("stock", 422, "POS_CHECKOUT_REJECTED")]) {
      send.mockRejectedValueOnce(failure); await expect(gate.request("/pos/checkouts")).rejects.toBe(failure); expect(gate.isReady()).toBe(true);
    }
  });
  it("does not reopen from an identity response made stale by another quarantine or disposal", async () => {
    const { gate, send } = fixture(); const identity = deferred<unknown>(); send.mockReturnValueOnce(identity.promise);
    const activating = gate.activate(); gate.quarantine(); identity.resolve(echo()); expect(await activating).toBe(false);
    expect(gate.getSnapshot().status).toBe("quarantined");
    const newer = deferred<unknown>(); send.mockReturnValueOnce(newer.promise); const verifying = gate.verifyIdentity(); gate.dispose(); newer.resolve(echo());
    expect(await verifying).toBe(false); expect(gate.getSnapshot().status).toBe("disposed");
  });
  it("aborts all owned reads on disposal even when the caller did not provide a signal", async () => {
    const { gate, send } = fixture(); await gate.activate(); const pending = deferred<unknown>(); send.mockReturnValueOnce(pending.promise);
    const reading = gate.request("/inventory-barcodes/resolve", { method: "POST", body: '{"value":"00001234"}' });
    const signal = send.mock.calls.at(-1)![1].signal as AbortSignal; gate.dispose(); expect(signal.aborted).toBe(true);
    pending.resolve(echo({ data: [] })); await expect(reading).rejects.toBeInstanceOf(PosScopeError);
  });
  it("two local tabs cannot attribute a same-session company change to the previous scope", async () => {
    let activeCompany = "2";
    const request: PosRequest = async <T,>(_path: string, options: PosRequestOptions = {}) => {
      if (new Headers(options.headers).get("X-POS-Expected-Company-Id") !== activeCompany) throw new ApiError("changed", 409, "POS_CONTEXT_CHANGED");
      return echo({}, { userId: "1", companyId: activeCompany }) as T;
    };
    const one = createPosScopeController(scope, request); const two = createPosScopeController(scope, request);
    await one.activate(); await two.activate(); activeCompany = "3";
    await expect(one.preflight()).rejects.toMatchObject({ code: "POS_CONTEXT_CHANGED" }); await expect(two.request("/pos/sales")).rejects.toMatchObject({ code: "POS_CONTEXT_CHANGED" });
    expect(one.isReady()).toBe(false); expect(two.isReady()).toBe(false);
  });
  it("preflight failure creates no marker; failure after reservation retains UNKNOWN and never allows clearing", async () => {
    const { gate, send } = fixture(); await gate.activate(); const { storage, values } = memoryStorage();
    const recovery = createPosRecoveryController({ storage, exclusive: serializedLocks(), createKey: () => key1, read: (attemptKey, signal) => gate.request("/pos/checkouts/recovery", { method: "POST", body: JSON.stringify({ attemptKey }), signal }) });
    recovery.activate(recoveryScope); send.mockRejectedValueOnce(new ApiError("changed", 409, "POS_CONTEXT_CHANGED"));
    await expect(gate.preflight()).rejects.toBeInstanceOf(ApiError); expect(values.size).toBe(0);
    await gate.verifyIdentity(); send.mockRejectedValueOnce(new ApiError("changed", 409, "POS_CONTEXT_CHANGED"));
    await recovery.begin((attemptKey, signal) => gate.request("/pos/checkouts", { method: "POST", body: "{}", idempotencyKey: attemptKey, signal }));
    expect(values.size).toBe(1); expect(recovery.getSnapshot().status).toBe("unknown");
    expect(await recovery.newSale()).toBe(false); expect(await recovery.reviewRejected()).toBe(false);
  });
  it("does not allow malformed expected pairs or caller-supplied duplicate header values", () => {
    expect(() => posExpectedHeaders({ userId: "01", companyId: "2" })).toThrow(PosScopeError);
    const headers = posExpectedHeaders(scope, { "X-POS-Expected-User-Id": "8, 9", "X-POS-Expected-Company-Id": "9" });
    expect(headers.get("X-POS-Expected-User-Id")).toBe("1"); expect(headers.get("X-POS-Expected-Company-Id")).toBe("2");
  });
});
