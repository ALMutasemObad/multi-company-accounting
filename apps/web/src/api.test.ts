import { afterEach, describe, expect, it, vi } from "vitest";
import { beginLogin } from "./api";

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
});
