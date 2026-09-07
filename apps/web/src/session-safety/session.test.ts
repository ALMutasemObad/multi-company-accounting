import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale } from "../i18n/core";
import { api, ApiError, beginLogin, downloadFile, logout, setCsrfToken } from "../api";
import { invalidateSessionRequests, isSessionExpiry, onSessionExpired } from "./session";

const response = (status: number, code?: string) => new Response(JSON.stringify({ code }), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { invalidateSessionRequests(); vi.unstubAllGlobals(); });
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
    const transport = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(response(200));
    vi.stubGlobal("fetch", transport);
    const old = logout(); const rejected = expect(old).rejects.toMatchObject({ kind: "cancelled" });
    invalidateSessionRequests(); setCsrfToken("new-session");
    await rejected; pending.resolve(response(200));
    await api("/probe", { method: "POST" });
    expect(transport.mock.calls.at(-1)![1].headers.get("X-CSRF-Token")).toBe("new-session");
  });
  it.each(["/auth/login", "/auth/logout", "/auth/csrf", "/auth/social/providers", "/auth/password/reset", "/auth/password/forgot?locale=ar"])("excludes %s", path => {
    expect(isSessionExpiry(path, 401, "UNAUTHENTICATED")).toBe(false);
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
