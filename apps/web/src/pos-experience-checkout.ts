import { ApiError } from "./api";
import type { PosCheckoutResult } from "./types";

export type PosAttempt<Snapshot> = {
  key: string;
  body: string;
  snapshot: Snapshot;
  status: "pending" | "unknown" | "completed";
  everUnknown?: boolean;
  result?: PosCheckoutResult;
};

/** In-memory, scoped recovery. No financial payloads are persisted in browser storage. */
export function createPosAttemptStore<Snapshot>() {
  const attempts = new Map<string, PosAttempt<Snapshot>>();
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  return {
    get: (scope: string) => attempts.get(scope),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(scope: string, body: string, snapshot: Snapshot, key: () => string) {
      if (attempts.has(scope)) return null;
      const attempt: PosAttempt<Snapshot> = { key: key(), body, snapshot, status: "pending" };
      attempts.set(scope, attempt);
      publish();
      return attempt;
    },
    retry(scope: string) {
      const attempt = attempts.get(scope);
      if (!attempt || attempt.status !== "unknown") return null;
      const retry = { ...attempt, status: "pending" as const };
      attempts.set(scope, retry); publish();
      return retry;
    },
    unknown(scope: string) { const attempt = attempts.get(scope); if (attempt) { attempts.set(scope, { ...attempt, status: "unknown", everUnknown: true }); publish(); } },
    complete(scope: string, result: PosCheckoutResult) { const attempt = attempts.get(scope); if (attempt) { attempts.set(scope, { ...attempt, status: "completed", result }); publish(); } },
    clear(scope: string) { attempts.delete(scope); publish(); },
  };
}

export function isPosOutcomeUnknown(cause: unknown) {
  return !(cause instanceof ApiError)
    || cause.status >= 500 || cause.status === 408
    || cause.code === "IDEMPOTENCY_IN_PROGRESS" || cause.code === "IDEMPOTENCY_MISMATCH";
}

export function isConfirmedPosResult(result: PosCheckoutResult) {
  return Boolean(result?.id && result.completedAt && result.invoice?.id && result.receipt?.id
    && result.invoice.documentNumber && result.receipt.documentNumber
    && result.invoice.status === "POSTED" && result.receipt.status === "POSTED"
    && typeof result.invoice.total === "string" && /^\d+\.\d{4}$/u.test(result.invoice.total));
}
