import type { PosCheckoutResult } from "./types";
import type { PosRecoveryExclusive, PosRecoveryStorage } from "./pos-recovery-controller";

export const key1 = "550e8400-e29b-41d4-a716-446655440000";
export const key2 = "550e8400-e29b-41d4-a716-446655440001";
export const recoveryScope = { userId: "1", companyId: "2", canCheckout: true };
export const recoveryResult: PosCheckoutResult = {
  id: "7", completedAt: "2026-08-31T08:30:00.000Z",
  invoice: { id: "8", documentNumber: "SI-0008", status: "POSTED", customerName: "Customer",
    total: "900719925474099.1234", baseTotal: "900719925474099.1234", generatedJournalEntryIds: ["10"] },
  receipt: { id: "9", documentNumber: "R-0009", status: "POSTED", generatedJournalEntryIds: ["11"] },
};
export function memoryStorage() {
  const values = new Map<string, string>();
  const storage: PosRecoveryStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
  return { values, storage };
}
/** Test port models the serialization contract, not an actual browser Web Locks test. */
export function serializedLocks(): PosRecoveryExclusive {
  const tails = new Map<string, Promise<unknown>>();
  return { run: <T>(name: string, work: () => Promise<T>) => {
    const result = (tails.get(name) ?? Promise.resolve()).then(work);
    tails.set(name, result.catch(() => undefined)); return result;
  } };
}
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
