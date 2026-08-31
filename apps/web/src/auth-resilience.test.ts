import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, beginLogin, clearCsrfToken, login, setCsrfToken } from "./api";
import { authErrorMessage, authPost, uncertainAuthResult } from "./auth-resilience";
import { createTranslator, loadLocale } from "./i18n";
import { RequestError, withinRequest } from "./request-scope";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeAll(async () => { for (const locale of ["ar", "en", "ur", "hi"] as const) await loadLocale(locale); });
beforeEach(() => { clearCsrfToken(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("opt-in request deadlines and lifecycle", () => {
  it("bounds a stalled fetch, aborts its signal, and cleans timers/listeners", async () => {
    const parent = new AbortController();
    const remove = vi.spyOn(parent.signal, "removeEventListener");
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => { signal = options.signal!; return new Promise(() => {}); }));
    const result = api("/auth/me", { signal: parent.signal, timeoutMs: 15_000 }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toMatchObject({ kind: "timeout" });
    expect(signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("distinguishes explicit cancellation and never starts an already-cancelled call", async () => {
    const parent = new AbortController();
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const result = api("/auth/me", { signal: parent.signal, timeoutMs: 15_000 }).catch((error) => error);
    parent.abort(new Error("private reason must not be rendered"));
    expect(await result).toMatchObject({ kind: "cancelled" });
    await expect(api("/auth/me", { signal: parent.signal })).rejects.toMatchObject({ kind: "cancelled" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("includes a stalled response body in the same deadline", async () => {
    const response = json({});
    vi.spyOn(response, "json").mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const result = api("/auth/me", { timeoutMs: 100 }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ kind: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses one budget across CSRF and POST without replay", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requests.push(url);
      if (url.endsWith("csrf")) { await new Promise((resolve) => setTimeout(resolve, 8_000)); return json({ csrfToken: "pre" }); }
      return new Promise(() => {});
    }));
    const result = withinRequest((signal) => authPost("/auth/password/forgot", { email: "nobody@example.test" }, signal), { timeoutMs: 15_000 }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toMatchObject({ kind: "timeout" });
    expect(requests).toEqual(["/api/v1/auth/csrf", "/api/v1/auth/password/forgot"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not impose the auth deadline on financial commands", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const promise = api("/sales-invoices/1/post", { method: "POST", idempotencyKey: "opaque-key" });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(vi.getTimerCount()).toBe(0);
    resolve(json({ status: "POSTED" }));
    await expect(promise).resolves.toEqual({ status: "POSTED" });
  });
  it("cleans on success/error and stops sibling work on failure", async () => {
    const parent = new AbortController();
    const remove = vi.spyOn(parent.signal, "removeEventListener");
    let child!: AbortSignal;
    await expect(withinRequest(async (signal) => { child = signal; return 1; }, { signal: parent.signal, timeoutMs: 30 })).resolves.toBe(1);
    expect(child.aborted).toBe(true);
    await expect(withinRequest(async () => { throw new Error("test"); }, { signal: parent.signal, timeoutMs: 30 })).rejects.toThrow("test");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans a synchronously throwing operation without an orphaned abort rejection", async () => {
    await expect(withinRequest(() => { throw new Error("synchronous"); }, { timeoutMs: 100 })).rejects.toThrow("synchronous");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("CSRF and backwards-compatible API errors", () => {
  it("keeps ApiError status/code/reason, headers and credentials without retries", async () => {
    setCsrfToken("csrf-current");
    const fetchMock = vi.fn(async () => json({ code: "CONFLICT", reason: "VERSION_CONFLICT" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    const error = await api("/invoice", { method: "PUT", body: "{}", idempotencyKey: "operation-key", headers: { "X-Custom": "value" } }).catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "CONFLICT", reason: "VERSION_CONFLICT" });
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init[1].headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-current");
    expect(headers.get("Idempotency-Key")).toBe("operation-key");
    expect(headers.get("X-Custom")).toBe("value");
    expect(init[1].credentials).toBe("include");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("beginLogin recovers after failure and still deduplicates unscoped callers", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(json({ csrfToken: "recovered" }));
    vi.stubGlobal("fetch", fetchMock);
    const first = beginLogin();
    expect(beginLogin()).toBe(first);
    await expect(first).rejects.toMatchObject({ kind: "network" });
    await expect(beginLogin()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not allow a late cancelled CSRF response to overwrite a newer token", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; })).mockImplementation(async () => json({ csrfToken: "new" }));
    vi.stubGlobal("fetch", fetchMock);
    const parent = new AbortController();
    const first = beginLogin({ signal: parent.signal }).catch((error) => error);
    parent.abort();
    await first;
    await beginLogin({ timeoutMs: 100 });
    resolve(json({ csrfToken: "stale" }));
    await vi.advanceTimersByTimeAsync(0);
    await api("/test-write", { method: "POST" });
    expect(new Headers(fetchMock.mock.calls.at(-1)![1].headers).get("X-CSRF-Token")).toBe("new");
  });
  it("never sends the password when CSRF fails or times out", async () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const result = login("someone@example.test", "not-a-real-password", { timeoutMs: 100 }).catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ kind: "timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("refreshes CSRF only for an explicit attempt, never retries a rejected POST", async () => {
    let token = 0;
    const fetchMock = vi.fn(async (url: string) => url.endsWith("csrf") ? json({ csrfToken: `token-${++token}` }) : json({ code: "INVALID_CSRF" }, 403));
    vi.stubGlobal("fetch", fetchMock);
    await expect(login("x@example.test", "password", { timeoutMs: 100 })).rejects.toMatchObject({ code: "INVALID_CSRF" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(login("x@example.test", "password", { timeoutMs: 100 })).rejects.toMatchObject({ code: "INVALID_CSRF" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("works with disabled storage, keeps 204, and rejects malformed successful JSON", async () => {
    vi.stubGlobal("sessionStorage", { setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } });
    expect(() => setCsrfToken("memory")).not.toThrow();
    expect(() => clearCsrfToken()).not.toThrow();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response("<html>proxy</html>")));
    await expect(api("/auth/context", { method: "PUT" })).resolves.toBeUndefined();
    await expect(api("/auth/me")).rejects.toMatchObject({ kind: "response" });
  });
});

describe("translated, non-enumerating auth feedback", () => {
  it.each(["ar", "en", "ur", "hi"] as const)("renders actionable errors in %s without raw errors or secrets", (locale) => {
    const t = createTranslator(locale);
    for (const kind of ["timeout", "cancelled", "network", "response"] as const) {
      expect(authErrorMessage(new RequestError(kind), t)).not.toMatch(/Failed to fetch|Request (timeout|cancelled|network|response)/);
    }
    expect(authErrorMessage(new Error("secret-token password someone@example.test Failed to fetch"), t)).toBe(t("authResilience.unavailable"));
    expect(authErrorMessage(new ApiError("raw", 401, "ACCOUNT_LOCKED"), t)).toBe(authErrorMessage(new ApiError("raw", 401, "INVALID_CREDENTIALS"), t));
    expect(authErrorMessage(new ApiError("raw", 403, "INVALID_CSRF"), t)).toBe(t("authResilience.csrf"));
    expect(uncertainAuthResult(new RequestError("timeout"))).toBe(true);
    expect(uncertainAuthResult(new ApiError("raw", 503))).toBe(true);
    expect(uncertainAuthResult(new ApiError("raw", 403, "INVALID_CSRF"))).toBe(false);
  });
});
