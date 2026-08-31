import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, setCsrfToken } from "./api";
import { loadLocale } from "./i18n";
import { BillingAttemptLocked, BillingAttemptStore, BillingStorageUnavailable, billingCommandFailure, type BillingCommand } from "./billing-recovery-attempt";
import { BILLING_COMMAND_TIMEOUT_MS, BILLING_READ_TIMEOUT_MS, billingReadError, initialBillingQuery, loadBillingRecoveryPages, sendBillingAttempt } from "./billing-recovery-requests";
import { RequestError } from "./request-scope";

const invoiceId = "4b5ec818-6f77-44f8-973f-fdf2df39ac47";
const paymentId = "73fa19cc-474f-4a07-92a3-0376b406968a";
const input = (command: BillingCommand = "checkout") => ({ scope: "7:1", command, resourceId: command === "checkout" ? invoiceId : paymentId, invoiceId, version: 17 });
function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const payment = { id: paymentId, invoiceId, companyId: "1", version: 18, state: "CHECKOUT", checkoutUrl: null };
const page = (items: unknown[]) => ({ items, provider: { available: true }, meta: { page: 1, pageSize: 10 } });
beforeAll(async () => { await loadLocale("ar"); await loadLocale("en"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("billing attempt identity and fail-closed tab storage", () => {
  it.each(["checkout", "cancel", "retry"] as const)("keeps %s keys under 100 characters with real UUIDs and snapshots its body", (command) => {
    const storage = memory();
    const store = new BillingAttemptStore(() => storage);
    const request = input(command);
    const attempt = store.begin(request);
    request.version = 99;
    expect(attempt.key.length).toBeLessThanOrEqual(100);
    expect(attempt.key.length).toBeGreaterThanOrEqual(16);
    expect(attempt.body).toBe(command === "checkout" ? '{"invoiceVersion":17}' : '{"version":17}');
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(new BillingAttemptStore(() => storage).read("7:1")).toEqual(attempt);
    expect(() => store.begin({ ...input(command), version: 99 })).toThrow(BillingAttemptLocked);
    expect(store.read("7:1")).toEqual(attempt);
    expect(Object.keys(JSON.parse([...storage.values.values()][0]!)).sort()).toEqual(["schema", "scope", "command", "resourceId", "invoiceId", "version", "body", "key", "outcome", "issue"].sort());
  });
  it("serializes commands across resources and instances in the same activity, but isolates user/activity", () => {
    const storage = memory();
    const first = new BillingAttemptStore(() => storage);
    first.begin(input());
    const second = new BillingAttemptStore(() => storage);
    expect(() => second.begin(input("cancel"))).toThrow(BillingAttemptLocked);
    expect(second.read("7:2")).toBeNull();
    expect(second.read("8:1")).toBeNull();
    expect(second.begin({ ...input(), scope: "7:2" }).key).not.toEqual(first.read("7:1")!.key);
  });
  it("never releases unknown outcomes after a read; only acknowledged success or explicit reviewed rejection can release", () => {
    const memoryStorage = memory();
    const store = new BillingAttemptStore(() => memoryStorage);
    const attempt = store.begin(input());
    expect(store.releaseReviewed(attempt)).toBe(false);
    const conflict = store.settle(attempt, "unknown", "conflict");
    expect(store.releaseReviewed(conflict)).toBe(false);
    expect(store.read(attempt.scope)?.key).toBe(attempt.key);
    const saved = store.settle(attempt, "confirmed");
    expect(store.releaseReviewed(saved)).toBe(true);
    expect(store.read(attempt.scope)).toBeNull();
    const rejected = store.settle(store.begin(input()), "rejected", "throttled");
    expect(store.releaseReviewed(rejected)).toBe(true);
  });
  it("rejects blocked, no-op, or malformed storage without dispatch or overwriting the unknown record", () => {
    const blocked = new BillingAttemptStore(() => { throw new Error("disabled"); });
    expect(() => blocked.begin(input())).toThrow(BillingStorageUnavailable);
    const noop = new BillingAttemptStore(() => ({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }));
    expect(() => noop.begin(input())).toThrow(BillingStorageUnavailable);
    const storage = memory();
    const store = new BillingAttemptStore(() => storage);
    store.begin(input());
    const key = [...storage.values.keys()][0]!;
    for (const bad of ["{", "null", '{"schema":2}', JSON.stringify({ ...store.read("7:1"), body: '{"version":99}' })]) {
      storage.setItem(key, bad);
      expect(() => store.read("7:1")).toThrow(BillingStorageUnavailable);
      expect(() => store.begin(input())).toThrow(BillingStorageUnavailable);
      expect(storage.getItem(key)).toBe(bad);
    }
  });
  it("distinguishes conflicts, throttling, and uncertain network/provider outcomes without assuming no collection", () => {
    expect(billingCommandFailure(new ApiError("private", 409, "CONFLICT", "VERSION_CONFLICT"))).toEqual({ outcome: "unknown", issue: "conflict" });
    expect(billingCommandFailure(new ApiError("private", 429))).toEqual({ outcome: "rejected", issue: "throttled" });
    expect(billingCommandFailure(new ApiError("private", 403))).toEqual({ outcome: "rejected", issue: "rejected" });
    expect(billingCommandFailure(new ApiError("private", 422))).toEqual({ outcome: "unknown", issue: "rejected" });
    for (const cause of [new ApiError("private", 500), new ApiError("private", 503), new RequestError("network"), new RequestError("response"), new RequestError("cancelled"), new RequestError("timeout")]) {
      expect(billingCommandFailure(cause)).toEqual({ outcome: "unknown", issue: "unknown" });
    }
  });
  it("detects a silently failed settlement save and keeps the original unknown attempt locked", () => {
    const storage = memory();
    const store = new BillingAttemptStore(() => storage);
    const attempt = store.begin(input());
    storage.setItem = () => undefined;
    expect(() => store.settle(attempt, "confirmed")).toThrow(BillingStorageUnavailable);
    expect(store.read("7:1")).toEqual(attempt);
    expect(() => store.begin(input("retry"))).toThrow(BillingAttemptLocked);
  });
});

describe("bounded billing requests and preserved transport protections", () => {
  it.each(["checkout", "cancel", "retry"] as const)("sends exactly one %s with saved body/key, credentials and authenticated CSRF", async (command) => {
    const storage = memory();
    const attempt = new BillingAttemptStore(() => storage).begin(input(command));
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payment }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    setCsrfToken("fixture-authenticated-csrf");
    await expect(sendBillingAttempt(attempt, "1", new AbortController().signal)).resolves.toEqual(payment);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe(`/api/v1/subscription/billing/${command === "checkout" ? "invoices" : "payments"}/${attempt.resourceId}/${command}`);
    expect(options).toMatchObject({ method: "POST", body: attempt.body, credentials: "include" });
    expect(options.headers.get("Idempotency-Key")).toBe(attempt.key);
    expect(options.headers.get("X-CSRF-Token")).toBe("fixture-authenticated-csrf");
  });
  it.each(["{", "{}", "null", JSON.stringify({ payment: { ...payment, companyId: "2" } })])("treats lost/malformed/wrong-scope success bodies as unknown (%s)", async (body) => {
    const storage = memory();
    const store = new BillingAttemptStore(() => storage);
    const attempt = store.begin(input());
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(sendBillingAttempt(attempt, "1", new AbortController().signal)).rejects.toMatchObject({ kind: "response" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.read("7:1")).toEqual(attempt);
  });
  it("bounds writes even if the transport ignores cancellation and retains the unknown key/body", async () => {
    vi.useFakeTimers();
    const storage = memory();
    const store = new BillingAttemptStore(() => storage);
    const attempt = store.begin(input("retry"));
    const fetch = vi.fn().mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetch);
    const assertion = expect(sendBillingAttempt(attempt, "1", new AbortController().signal)).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(BILLING_COMMAND_TIMEOUT_MS + 1);
    await assertion;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(store.read("7:1")).toEqual(attempt);
  });
  it("keeps reads paginated and credentialed with no financial command or company query override", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page([])))).mockResolvedValueOnce(new Response(JSON.stringify(page([payment]))));
    vi.stubGlobal("fetch", fetch);
    await loadBillingRecoveryPages("1", { invoicePage: 2, invoiceStatus: "PAID", paymentPage: 3, paymentState: "FAILED" }, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/subscription/billing/invoices?page=2&pageSize=10&status=PAID", "/api/v1/subscription/billing/payments?page=3&pageSize=10&state=FAILED"]);
    for (const [, options] of fetch.mock.calls) expect(options).toMatchObject({ credentials: "include", cache: "no-store" });
  });
  it.each(["timeout", "cancel"] as const)("settles both reads on %s without retrying or publishing partial results", async (mode) => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const assertion = expect(loadBillingRecoveryPages("1", initialBillingQuery, controller.signal)).rejects.toMatchObject({ kind: mode === "timeout" ? "timeout" : "cancelled" });
    if (mode === "cancel") controller.abort();
    else await vi.advanceTimersByTimeAsync(BILLING_READ_TIMEOUT_MS + 1);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
  });
  it("rejects another activity, oversized pages, and hides raw read errors", async () => {
    for (const items of [[{ ...payment, companyId: "2" }], Array.from({ length: 11 }, () => payment)]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page([])))).mockResolvedValueOnce(new Response(JSON.stringify(page(items)))));
      await expect(loadBillingRecoveryPages("1", initialBillingQuery, new AbortController().signal)).rejects.toMatchObject({ kind: "response" });
    }
    expect(billingReadError(new ApiError("secret", 429))).toBe("readThrottled");
    expect(billingReadError(new RequestError("timeout"))).toBe("readTimeout");
    expect(billingReadError(new RequestError("cancelled"))).toBe("readCancelled");
    expect(billingReadError(new Error("private internals"))).toBe("readError");
  });
});
