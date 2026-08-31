import { createPosRecoveryController, type PosRecoveryExclusive, type PosRecoveryStorage } from "./pos-recovery-controller";

/** No HTTP endpoint is shipped here. The coordinator injects the approved API read port. */
export function createBrowserPosRecovery(read: (attemptKey: string, signal: AbortSignal) => Promise<unknown>) {
  const storage: PosRecoveryStorage = {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key),
  };
  const exclusive: PosRecoveryExclusive | null = typeof navigator !== "undefined" && navigator.locks
    ? { run: (name, work) => navigator.locks.request(name, { mode: "exclusive" }, work) } : null;
  const controller = createPosRecoveryController({ storage, exclusive, read, createKey: () => crypto.randomUUID() });
  const changed = (event: StorageEvent) => {
    try { if (event.storageArea === window.localStorage) controller.storageChanged(event.key); }
    catch { controller.storageChanged(null); }
  };
  window.addEventListener("storage", changed);
  return { ...controller, dispose() { window.removeEventListener("storage", changed); controller.dispose(); } };
}
