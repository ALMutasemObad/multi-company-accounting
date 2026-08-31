import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserPosRecovery } from "./pos-recovery-browser";
import { key1, memoryStorage, recoveryScope } from "./pos-recovery-test-fixtures";
import { posRecoveryKey } from "./pos-recovery-model";

afterEach(() => vi.unstubAllGlobals());

describe("POS browser port wiring (no real browser)", () => {
  it("does not subscribe during construction and reattaches after React effect cleanup", () => {
    const { storage } = memoryStorage(); const add = vi.fn(); const remove = vi.fn();
    vi.stubGlobal("window", { localStorage: storage, addEventListener: add, removeEventListener: remove });
    vi.stubGlobal("navigator", {});
    const discarded = createBrowserPosRecovery(vi.fn());
    expect(add).not.toHaveBeenCalled(); discarded.dispose(); expect(remove).not.toHaveBeenCalled();
    const active = createBrowserPosRecovery(vi.fn());
    active.activate(recoveryScope); active.activate(recoveryScope); expect(add).toHaveBeenCalledTimes(1);
    active.dispose(); active.activate(recoveryScope); expect(add).toHaveBeenCalledTimes(2);
    active.dispose(); expect(remove).toHaveBeenCalledTimes(2);
  });
  it("uses the scoped exclusive lock and ignores event payloads and unrelated storage areas", async () => {
    const { storage, values } = memoryStorage(); const add = vi.fn(); const remove = vi.fn();
    const request = vi.fn(async (_name: string, _options: unknown, work: () => Promise<unknown>) => work());
    vi.stubGlobal("window", { localStorage: storage, addEventListener: add, removeEventListener: remove });
    vi.stubGlobal("navigator", { locks: { request } }); vi.stubGlobal("crypto", { randomUUID: () => key1 });
    const read = vi.fn(); const controller = createBrowserPosRecovery(read); controller.activate(recoveryScope);
    await controller.begin(async () => { throw new Error("lost"); });
    expect(request).toHaveBeenCalledWith(posRecoveryKey(recoveryScope), { mode: "exclusive" }, expect.any(Function));
    const listener = add.mock.calls[0]![1] as (event: Partial<StorageEvent>) => void;
    listener({ key: null, storageArea: {} as Storage, newValue: '{"outcome":"CONFIRMED"}' });
    expect(controller.getSnapshot().status).toBe("unknown");
    values.clear(); listener({ key: null, storageArea: storage as Storage, newValue: '{"outcome":"CONFIRMED"}' });
    expect(controller.getSnapshot().status).toBe("blocked"); expect(read).not.toHaveBeenCalled();
    controller.dispose(); expect(remove).toHaveBeenCalledWith("storage", listener);
  });
  it("does not silently fall back to a sale without Web Locks", async () => {
    const { storage } = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("navigator", {});
    const controller = createBrowserPosRecovery(vi.fn()); controller.activate(recoveryScope); const send = vi.fn();
    expect(controller.getSnapshot()).toEqual({ status: "blocked", reason: "coordination" });
    expect(await controller.begin(send)).toBe(false); expect(send).not.toHaveBeenCalled(); controller.dispose();
  });
});
