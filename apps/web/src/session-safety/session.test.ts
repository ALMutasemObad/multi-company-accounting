import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale } from "../i18n/core";
import { api, ApiError, beginLogin, clearCsrfToken, downloadFile, logout, refreshAuthenticatedCsrf, setCsrfToken } from "../api";
import { invalidateSessionRequests, isSessionExpiry, onSessionExpired } from "./session";

const response = (status: number, code?: string) => new Response(JSON.stringify({ code }), { status });
const authenticatedCsrfResponse = (csrfToken: string, expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()) =>
  new Response(JSON.stringify({ csrfToken, expiresAt }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { invalidateSessionRequests(); clearCsrfToken(); vi.useRealTimers(); vi.unstubAllGlobals(); });
beforeAll(() => loadLocale("ar"));

describe("session isolation", () => {
  it("does not reuse an invalidated bootstrap or overwrite the new token", async () => {
    const pending = deferred<Response>();
    const transport = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(new Response(JSON.stringify({ csrfToken: "new" })));
    vi.stubGlobal("fetch", transport);
    const old = beginLogin(); const rejected = expect(old).rejects.toMatchObject({ kind: "cancelled" });
    invalidateSessionRequests();
    await beginLogin(); await rejected;
    pending.resolve(new Response(JSON.stringify({ csrfToken: "old" })));
    await Promise.resolve();
    transport.mockResolvedValue(response(200));
    await api("/probe", { method: "POST" });
    expect(transport.mock.calls.at(-1)![1].headers.get("X-CSRF-Token")).toBe("new");
  });
  it("a late logout cannot clear the next session token", async () => {
    const pending = deferred<Response>();
    const dispatched = deferred<void>();
    const transport = vi.fn().mockImplementationOnce((_url: string, _options?: RequestInit) => {
      dispatched.resolve();
      return pending.promise;
    }).mockResolvedValue(response(200));
    vi.stubGlobal("fetch", transport);
    setCsrfToken("old-session");
    const old = logout(); const rejected = expect(old).rejects.toMatchObject({ kind: "cancelled" });
    await dispatched.promise;
    expect(transport.mock.calls[0]![1]?.headers).toBeInstanceOf(Headers);
    expect(new Headers(transport.mock.calls[0]![1]?.headers).get("X-CSRF-Token")).toBe("old-session");
    invalidateSessionRequests(); setCsrfToken("new-session");
    await rejected; pending.resolve(response(200));
    await api("/probe", { method: "POST" });
    expect(transport.mock.calls.at(-1)![1].headers.get("X-CSRF-Token")).toBe("new-session");
  });
  it("bootstraps one authenticated GET and never replays the following POST", async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(authenticatedCsrfResponse("tab-token"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", transport);
    await refreshAuthenticatedCsrf();
    await api("/financial-command", { method: "POST", body: JSON.stringify({ amount: "10.00" }) });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]![0]).toBe("/api/v1/auth/csrf?mode=authenticated");
    expect(transport.mock.calls[0]![1].method).toBeUndefined();
    expect(transport.mock.calls[1]![1].headers.get("X-CSRF-Token")).toBe("tab-token");
  });
  it("single-flights refresh before near-expiry writes and dispatches each command once", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-09-21T09:00:00.000Z");
    vi.setSystemTime(startedAt);
    let csrfReads = 0;
    const transport = vi.fn().mockImplementation((url: string, _options?: RequestInit) => {
      if (url === "/api/v1/auth/csrf?mode=authenticated") {
        csrfReads += 1;
        return Promise.resolve(authenticatedCsrfResponse(`tab-token-${csrfReads}`));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", transport);
    await refreshAuthenticatedCsrf();
    vi.setSystemTime(new Date(startedAt.getTime() + 14 * 60_000 + 10_000));

    await Promise.all([
      api("/financial-command/one", { method: "POST", body: JSON.stringify({ amount: "10.00" }) }),
      api("/financial-command/two", { method: "POST", body: JSON.stringify({ amount: "20.00" }) }),
    ]);

    expect(csrfReads).toBe(2);
    const commands = transport.mock.calls.filter(([url]) => String(url).includes("/financial-command/"));
    expect(commands).toHaveLength(2);
    expect(commands.map(([url]) => url)).toEqual(expect.arrayContaining(["/api/v1/financial-command/one", "/api/v1/financial-command/two"]));
    for (const [, options] of commands) expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("tab-token-2");
  });
  it("starts the anonymous login bootstrap after an unauthenticated tab bootstrap", async () => {
    setCsrfToken("stale-session-token");
    const listener = vi.fn(); const off = onSessionExpired(listener);
    const transport = vi.fn()
      .mockResolvedValueOnce(response(401, "UNAUTHENTICATED"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "login-token" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", transport);
    await expect(refreshAuthenticatedCsrf()).rejects.toBeDefined();
    expect(listener).toHaveBeenCalledTimes(1);
    await beginLogin();
    await api("/probe", { method: "POST" });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls[0]![0]).toBe("/api/v1/auth/csrf?mode=authenticated");
    expect(transport.mock.calls[1]![0]).toBe("/api/v1/auth/csrf");
    expect(transport.mock.calls[2]![1].headers.get("X-CSRF-Token")).toBe("login-token");
    off();
  });
  it("a cancelled authenticated bootstrap cannot overwrite a newer session token", async () => {
    const pending = deferred<Response>();
    const transport = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(authenticatedCsrfResponse("current"));
    vi.stubGlobal("fetch", transport);
    const old = refreshAuthenticatedCsrf(); const rejected = expect(old).rejects.toMatchObject({ kind: "cancelled" });
    invalidateSessionRequests();
    await refreshAuthenticatedCsrf(); await rejected;
    pending.resolve(authenticatedCsrfResponse("stale"));
    await Promise.resolve();
    transport.mockResolvedValue(new Response(null, { status: 204 }));
    await api("/probe", { method: "POST" });
    expect(transport.mock.calls.at(-1)![1].headers.get("X-CSRF-Token")).toBe("current");
  });
  it.each(["/auth/login", "/auth/logout", "/auth/csrf", "/auth/social/providers", "/auth/password/reset", "/auth/password/forgot?locale=ar"])("excludes %s", path => {
    expect(isSessionExpiry(path, 401, "UNAUTHENTICATED")).toBe(false);
  });
  it("expires an authenticated CSRF bootstrap 401", () => {
    expect(isSessionExpiry("/auth/csrf?mode=authenticated", 401, "UNAUTHENTICATED")).toBe(true);
  });
  it.each([401, 403])("does not expire on CSRF status %s", async status => {
    const listener = vi.fn(); const off = onSessionExpired(listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status, "INVALID_CSRF")));
    await expect(api("/invoices")).rejects.toBeInstanceOf(ApiError);
    expect(listener).not.toHaveBeenCalled(); off();
  });
  it("expires once for simultaneous protected 401s and clears the token", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockImplementation(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    setCsrfToken("old-token");
    const listener = vi.fn(); const off = onSessionExpired(listener);
    const results = Promise.allSettled([api("/auth/me"), api("/customers")]);
    pending.resolve(response(401, "UNAUTHENTICATED"));
    await results;
    expect(listener).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(response(200));
    await api("/probe", { method: "POST" });
    expect(fetchMock.mock.calls.at(-1)![1].headers.get("X-CSRF-Token")).toBeNull();
    off();
  });
  it.each([200, 401])("ignores old company responses (%s) after context switch", async status => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(response(200)));
    const listener = vi.fn(); const off = onSessionExpired(listener);
    const old = api("/customers");
    const rejected = expect(old).rejects.toMatchObject({ kind: "cancelled" });
    invalidateSessionRequests();
    await rejected;
    await api("/auth/me");
    pending.resolve(response(status));
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled(); off();
  });
  it("does not dispatch after caller unmount/cancellation", async () => {
    const pending = deferred<Response>(); const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const listener = vi.fn(); const off = onSessionExpired(listener);
    const rejected = expect(api("/customers", { signal: controller.signal })).rejects.toMatchObject({ kind: "cancelled" });
    controller.abort(); pending.resolve(response(401)); await rejected;
    expect(listener).not.toHaveBeenCalled(); off();
  });
  it("handles protected download expiry before any browser save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401)));
    const listener = vi.fn(); const off = onSessionExpired(listener);
    await expect(downloadFile("/reports/export", "report.pdf")).rejects.toBeDefined();
    expect(listener).toHaveBeenCalledTimes(1); off();
  });
});
