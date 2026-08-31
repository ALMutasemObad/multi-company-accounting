import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { loadSubscriptionUsage, resolveSubscriptionPlanSelection, SUBSCRIPTION_USAGE_TIMEOUT_MS, subscriptionUsageError, SubscriptionUsageTimeout } from "./subscription-usage";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("subscription usage reads", () => {
  it("makes one credentialed GET without company override and rejects a different company", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ companyId: "9" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadSubscriptionUsage("9", new AbortController().signal)).resolves.toEqual({ companyId: "9" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual(["/api/v1/subscription/usage", expect.objectContaining({ credentials: "include", cache: "no-store" })]);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ companyId: "10" }), { status: 200 }));
    await expect(loadSubscriptionUsage("9", new AbortController().signal)).rejects.toThrow("Usage scope mismatch");
  });
  it("bounds the wait even if transport ignores cancellation, with no automatic retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const pending = loadSubscriptionUsage("9", new AbortController().signal);
    const assertion = expect(pending).rejects.toBeInstanceOf(SubscriptionUsageTimeout);
    await vi.advanceTimersByTimeAsync(SUBSCRIPTION_USAGE_TIMEOUT_MS);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });
  it("propagates unmount/company-change cancellation to the request", async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const result = loadSubscriptionUsage("9", controller.signal);
    controller.abort();
    // The integrated API client normalizes cancellation; the transport still aborts.
    await expect(result).rejects.toMatchObject({ name: "RequestError", kind: "cancelled" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(true);
  });
  it("maps safe localized errors including throttling without exposing server internals", () => {
    expect(subscriptionUsageError(new ApiError("secret", 403))).toBe("forbidden");
    expect(subscriptionUsageError(new ApiError("secret", 401))).toBe("forbidden");
    expect(subscriptionUsageError(new ApiError("secret", 429))).toBe("loadError");
    expect(subscriptionUsageError(new SubscriptionUsageTimeout())).toBe("timeout");
    expect(subscriptionUsageError(new Error("Failed to fetch"))).toBe("loadError");
  });
});

describe("bounded catalog plan selection", () => {
  it("keeps an available preference exactly", () => {
    expect(resolveSubscriptionPlanSelection(["1", "9007199254740993"], "9007199254740993", true))
      .toEqual({ selectedId: "9007199254740993", missing: false });
  });
  it("clears a missing preference or previous selection without choosing the first result", () => {
    for (const allowDefault of [true, false]) {
      expect(resolveSubscriptionPlanSelection(["1", "2"], "3", allowDefault)).toEqual({ selectedId: "", missing: true });
    }
  });
  it("preserves the no-preference initial default only, never auto-selecting during pagination", () => {
    expect(resolveSubscriptionPlanSelection(["1", "2"], "", true)).toEqual({ selectedId: "1", missing: false });
    expect(resolveSubscriptionPlanSelection(["3", "4"], "", false)).toEqual({ selectedId: "", missing: false });
    expect(resolveSubscriptionPlanSelection([], "", true)).toEqual({ selectedId: "", missing: false });
  });
});
