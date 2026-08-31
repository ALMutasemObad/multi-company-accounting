import { afterEach, describe, expect, it, vi } from "vitest";
import { plansDiscoveryCatalog, readPlansDiscoveryPage } from "./PlansDiscoveryRead";
import type { PublicSubscriptionPlan } from "./public-plans";
import { discoveryTestCatalog, discoveryTestPlan } from "./PlansDiscovery.test-fixtures";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("bounded anonymous catalog reads", () => {
  it("reads only one public page with GET, no credentials/cache and no prefetch or retries", async () => {
    const payload = discoveryTestCatalog();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetcher);
    expect(await readPlansDiscoveryPage(1, new AbortController().signal)).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/public/subscription-plans?page=1", {
      method: "GET", credentials: "omit", cache: "no-store", signal: expect.any(AbortSignal),
    });
  });
  it.each([0, -1, 1.5, 1001, NaN, Infinity])("never fetches an unsupported page %s", async (page) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readPlansDiscoveryPage(page, new AbortController().signal)).rejects.toMatchObject({ kind: "response" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves exact decimal/version text and distinguishes a zero price from missing pricing", () => {
    const catalog = plansDiscoveryCatalog(discoveryTestCatalog(), 1);
    expect(catalog.plans[0]).toMatchObject({ id: "9007199254740993", recurringFee: "123.4567", includedUsers: 0, pricePerAdditionalUser: "0.0000", pricePerAdditionalEmployee: null });
  });
  it("accepts empty and changed later pages without manufacturing a replacement plan", () => {
    expect(plansDiscoveryCatalog(discoveryTestCatalog([], 1, 0), 1).plans).toEqual([]);
    expect(plansDiscoveryCatalog(discoveryTestCatalog([], 2, 1), 2).plans).toEqual([]);
    expect(plansDiscoveryCatalog(discoveryTestCatalog([], 2, 10), 2).plans).toEqual([]);
  });
  it.each([
    null, {}, { plans: null, meta: {} },
    discoveryTestCatalog([{ ...discoveryTestPlan, recurringFee: 0 } as unknown as PublicSubscriptionPlan]),
    discoveryTestCatalog([{ ...discoveryTestPlan, includedUsers: null } as unknown as PublicSubscriptionPlan]),
    discoveryTestCatalog([{ ...discoveryTestPlan, currencyCode: "broken" }]),
    discoveryTestCatalog([{ ...discoveryTestPlan, id: "1&activate=true" }]),
    discoveryTestCatalog([{ ...discoveryTestPlan, modules: Array(101).fill(discoveryTestPlan.modules[0]) }]),
    discoveryTestCatalog([discoveryTestPlan, discoveryTestPlan]),
    discoveryTestCatalog(Array(10).fill(discoveryTestPlan)),
    { ...discoveryTestCatalog(), meta: { page: 1, pageSize: 9, total: 100, totalPages: 1 } },
  ])("rejects unsafe or malformed responses instead of rendering fictional availability", (payload) => {
    expect(() => plansDiscoveryCatalog(payload, 1)).toThrow();
  });
  it("bounds the entire wait even if fetch ignores abort, without auto-retry", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
    const request = readPlansDiscoveryPage(1, new AbortController().signal);
    const assertion = expect(request).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(12_001); await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("ignores a late body after cancellation and does not read on a pre-aborted scope", async () => {
    let finish!: (value: unknown) => void;
    const body = new Promise((resolve) => { finish = resolve; });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => body }); vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const request = readPlansDiscoveryPage(1, controller.signal);
    const assertion = expect(request).rejects.toMatchObject({ kind: "cancelled" });
    controller.abort(); finish(discoveryTestCatalog()); await assertion;
    await expect(readPlansDiscoveryPage(1, controller.signal)).rejects.toMatchObject({ kind: "cancelled" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns an error for HTTP/JSON failures; an explicit second read is required to recover", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("bad body"); } }).mockResolvedValueOnce({ ok: true, json: async () => discoveryTestCatalog() });
    vi.stubGlobal("fetch", fetcher);
    await expect(readPlansDiscoveryPage(1, new AbortController().signal)).rejects.toMatchObject({ kind: "response" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(readPlansDiscoveryPage(1, new AbortController().signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(readPlansDiscoveryPage(1, new AbortController().signal)).resolves.toEqual(discoveryTestCatalog());
  });
});
