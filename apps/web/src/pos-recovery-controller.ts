import { canReadPosRecovery, canStartPosRecoverySale, posRecoveryKey, readPosRecoveryMarker,
  readPosRecoveryOutcome, readPosRecoveryResult, unresolvedPosRecovery, validPosRecoveryKey,
  type PosRecoveryMarker, type PosRecoveryScope, type PosRecoveryState } from "./pos-recovery-model";
import type { PosCheckoutResult } from "./types";

export interface PosRecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface PosRecoveryExclusive {
  run<T>(name: string, work: () => Promise<T>): Promise<T>;
}
export type PosRecoveryDependencies = {
  storage: PosRecoveryStorage;
  exclusive: PosRecoveryExclusive | null;
  read: (attemptKey: string, signal: AbortSignal) => Promise<unknown>;
  createKey: () => string;
  now?: () => number;
};

/** A single controller per mounted authorized POS experience. No command body is accepted,
 * retained or retried here: begin receives a one-shot in-memory callback from the composer.
 * Snapshot intentionally contains neither correlation nor scope identifiers.
 */
export function createPosRecoveryController(dependencies: PosRecoveryDependencies) {
  const now = dependencies.now ?? Date.now;
  const listeners = new Set<() => void>();
  let state: PosRecoveryState = { status: "blocked", reason: "permission" };
  let scope: PosRecoveryScope | null = null;
  let marker: PosRecoveryMarker | null = null;
  let generation = 0;
  let inflight: AbortController | null = null;
  const publish = (next: PosRecoveryState) => { state = next; listeners.forEach(listener => listener()); };
  const current = (ticket: number) => generation === ticket && scope?.canCheckout === true;
  const stored = (activeScope: PosRecoveryScope) => {
    const raw = dependencies.storage.getItem(posRecoveryKey(activeScope));
    if (raw === null) return null;
    const found = readPosRecoveryMarker(raw);
    if (!found) throw new Error("POS_RECOVERY_STORAGE_UNAVAILABLE");
    return found;
  };
  const matches = (left: PosRecoveryMarker | null, right: PosRecoveryMarker) =>
    left?.attemptKey === right.attemptKey && left.startedAt === right.startedAt;
  const storageFailure = () => publish({ status: "blocked", reason: "storage" });

  function apply(ticket: number, original: PosRecoveryMarker, result: PosCheckoutResult | null) {
    if (!current(ticket) || !scope || !matches(marker, original)) return;
    // Positive knowledge is monotonic; a late timeout/UNKNOWN cannot undo confirmation.
    if (state.status === "confirmed") return;
    try {
      if (!matches(stored(scope), original)) { storageFailure(); return; }
      publish(result ? { status: "confirmed", result } : unresolvedPosRecovery(original, now()));
    } catch { storageFailure(); }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate(next: PosRecoveryScope | null) {
      generation += 1; inflight?.abort(); inflight = null; marker = null;
      scope = next ? Object.freeze({ ...next }) : null;
      if (!scope?.canCheckout || !/^[1-9]\d{0,19}$/.test(scope.userId) || !/^[1-9]\d{0,19}$/.test(scope.companyId)) {
        publish({ status: "blocked", reason: "permission" }); return;
      }
      if (!dependencies.exclusive) { publish({ status: "blocked", reason: "coordination" }); return; }
      publish({ status: "initializing" });
      try {
        marker = stored(scope);
        publish(marker ? unresolvedPosRecovery(marker, now()) : { status: "ready" });
      } catch { storageFailure(); }
    },
    /** Wake-up only. Never trust event.newValue; reread this scope, never unlock or confirm. */
    storageChanged(key: string | null) {
      if (!scope?.canCheckout || !dependencies.exclusive || (key !== null && key !== posRecoveryKey(scope))) return;
      try {
        const found = stored(scope);
        if (marker) {
          if (!matches(found, marker)) storageFailure();
          return;
        }
        if (found) { marker = found; publish(unresolvedPosRecovery(found, now())); }
      } catch { storageFailure(); }
    },
    async begin(sendOnce: (attemptKey: string, signal: AbortSignal) => Promise<unknown>): Promise<boolean> {
      if (!scope?.canCheckout || !canStartPosRecoverySale(state) || !dependencies.exclusive) return false;
      const activeScope = scope; const ticket = generation;
      // Synchronous guard prevents double clicks while waiting on the cross-tab lock.
      publish({ status: "pending" });
      let reserved: PosRecoveryMarker | null = null;
      try {
        reserved = await dependencies.exclusive.run(posRecoveryKey(activeScope), async () => {
          if (!current(ticket)) return null;
          const existing = stored(activeScope);
          if (existing) { marker = existing; publish(unresolvedPosRecovery(existing, now())); return null; }
          const attemptKey = dependencies.createKey(); const startedAt = now();
          if (!validPosRecoveryKey(attemptKey) || !Number.isSafeInteger(startedAt) || startedAt < 0) throw new Error("POS_RECOVERY_STORAGE_UNAVAILABLE");
          const created: PosRecoveryMarker = { version: 1, attemptKey, startedAt };
          dependencies.storage.setItem(posRecoveryKey(activeScope), JSON.stringify(created));
          if (!matches(stored(activeScope), created)) throw new Error("POS_RECOVERY_STORAGE_UNAVAILABLE");
          marker = created;
          return created;
        });
      } catch { if (current(ticket)) storageFailure(); return false; }
      if (!reserved || !current(ticket)) return false;
      const original = reserved;
      // A storage event or a replaced marker while leaving the lock cannot authorize send.
      try {
        if (state.status !== "pending" || !matches(stored(activeScope), original)) { storageFailure(); return false; }
      } catch { storageFailure(); return false; }
      const controller = new AbortController(); inflight = controller;
      // One call only. A throw, 401/403/404/409, malformed success or timeout stays locked.
      try { apply(ticket, original, readPosRecoveryResult(await sendOnce(original.attemptKey, controller.signal))); }
      catch { apply(ticket, original, null); }
      finally { if (inflight === controller) inflight = null; }
      return true;
    },
    async check(): Promise<void> {
      if (!scope?.canCheckout || !marker || !canReadPosRecovery(state)) return;
      const ticket = generation; const original = marker;
      const controller = new AbortController(); inflight = controller;
      publish({ status: "checking" });
      try {
        const outcome = readPosRecoveryOutcome(await dependencies.read(original.attemptKey, controller.signal));
        apply(ticket, original, outcome.outcome === "CONFIRMED" ? outcome.result : null);
      } catch { apply(ticket, original, null); }
      finally { if (inflight === controller) inflight = null; }
    },
    /** Explicit user action after a validated server acknowledgement only. */
    async newSale(): Promise<boolean> {
      if (!scope?.canCheckout || !marker || state.status !== "confirmed" || !dependencies.exclusive) return false;
      const ticket = generation; const original = marker; const activeScope = scope;
      try {
        return await dependencies.exclusive.run(posRecoveryKey(activeScope), async () => {
          if (!current(ticket) || state.status !== "confirmed" || !matches(marker, original)) return false;
          if (!matches(stored(activeScope), original)) { storageFailure(); return false; }
          dependencies.storage.removeItem(posRecoveryKey(activeScope));
          if (dependencies.storage.getItem(posRecoveryKey(activeScope)) !== null) { storageFailure(); return false; }
          generation += 1; inflight?.abort(); inflight = null; marker = null;
          publish({ status: "ready" }); return true;
        });
      } catch { if (current(ticket)) storageFailure(); return false; }
    },
    dispose() { generation += 1; inflight?.abort(); inflight = null; scope = null; marker = null;
      publish({ status: "blocked", reason: "permission" }); listeners.clear(); },
  };
}
export type PosRecoveryController = ReturnType<typeof createPosRecoveryController>;
