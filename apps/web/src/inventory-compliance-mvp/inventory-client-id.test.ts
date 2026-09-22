import { afterEach, describe, expect, it, vi } from "vitest";
import { inventoryClientId, inventoryRequestKey } from "./inventory-client-id";

describe("inventory client identifiers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses randomUUID when the browser provides it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-4333-8444-555555555555" });
    expect(inventoryClientId()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("creates a UUID-compatible fallback on an insecure browser context", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => { bytes.fill(7); return bytes; } });
    expect(inventoryClientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(inventoryRequestKey("inventory-count")).toMatch(/^inventory-count-[0-9a-f-]{36}$/u);
  });
});
