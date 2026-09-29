import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api, ApiError, beginLogin } from "./api";
import { loadLocale } from "./i18n";

describe("login bootstrap", () => {
  beforeAll(async () => { await loadLocale("ar"); });
  afterEach(() => vi.unstubAllGlobals());

  it("deduplicates concurrent CSRF requests from React Strict Mode", async () => {
    let resolveResponse!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);

    const first = beginLogin();
    const second = beginLogin();
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse(new Response(JSON.stringify({ csrfToken: "test-token" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await Promise.all([first, second]);
  });

  it("preserves an explicit image content type and raw File body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ image: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], "item.png", { type: "image/png" });

    await api("/inventory-items/11/image", {
      method: "PUT",
      headers: { "Content-Type": file.type, "If-None-Match": "*" },
      body: file,
    });

    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(request.body).toBe(file);
    expect(new Headers(request.headers).get("Content-Type")).toBe("image/png");
    expect(new Headers(request.headers).get("If-None-Match")).toBe("*");
  });

  it("keeps the validated response-header request ID on an API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "COMPANY_SETUP_UNAVAILABLE", requestId: "different-body-12345678",
    }), { status: 503, headers: { "Content-Type": "application/json", "X-Request-ID": "group-create-12345678" } })));

    await expect(api("/organizations/1/company-options")).rejects.toMatchObject({
      status: 503, code: "COMPANY_SETUP_UNAVAILABLE", requestId: "group-create-12345678",
    });
  });

  it("uses a safe body request ID only when the header is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "COMPANY_SETUP_UNAVAILABLE", requestId: "group-body-12345678",
    }), { status: 503, headers: { "Content-Type": "application/json" } })));

    await expect(api("/organizations/1/company-options")).rejects.toMatchObject({ requestId: "group-body-12345678" });
  });

  it("does not reflect an unsafe or malformed request ID in a client error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "COMPANY_SETUP_UNAVAILABLE", requestId: "unsafe id with spaces",
    }), { status: 503, headers: { "Content-Type": "application/json", "X-Request-ID": "short" } })));

    try {
      await api("/organizations/1/company-options");
      expect.fail("Expected a rejected API response");
    } catch (cause) {
      expect(cause).toBeInstanceOf(ApiError);
      expect((cause as ApiError).requestId).toBeUndefined();
    }
  });
});
