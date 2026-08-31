import { createPosRecoveryController, type PosRecoveryExclusive, type PosRecoveryStorage } from "./pos-recovery-controller";

/** The composer injects the approved API read port. Construction has no DOM effects,
 * so a discarded React render cannot leak a storage listener. */
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
  let listening = false;
  return { ...controller,
    activate(...args: Parameters<typeof controller.activate>) {
      if (!listening) { window.addEventListener("storage", changed); listening = true; }
      controller.activate(...args);
    },
    dispose() {
      if (listening) { window.removeEventListener("storage", changed); listening = false; }
      controller.dispose();
    },
  };
}
