import { afterEach, describe, expect, it, vi } from "vitest";
import { api, beginLogin } from "./api";

describe("login bootstrap", () => {
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
});
