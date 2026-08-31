import { ApiError } from "./api";
import type { PosCheckoutResult } from "./types";

export type PosAttempt<Snapshot> = {
  key: string;
  body: string;
  snapshot: Snapshot;
  createdAt: number;
  lastObservedAt: number;
  retryExpiresAt: number;
  retryClockInvalid?: boolean;
  status: "pending" | "unknown" | "completed";
  everUnknown?: boolean;
  result?: PosCheckoutResult;
};

/** In-memory, scoped recovery. No financial payloads are persisted in browser storage. */
// Conservative client window below the current 24-hour executor default.
// This is not a server retention guarantee or a recovery/SLO contract.
export const POS_SAFE_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export function createPosAttemptStore<Snapshot>(now: () => number = Date.now) {
  const attempts = new Map<string, PosAttempt<Snapshot>>();
  const listeners = new Set<() => void>();
  const preventReload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
  const publish = () => {
    // Keep the warning while navigating to another module in the same document.
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", preventReload);
      if ([...attempts.values()].some((attempt) => attempt.status !== "completed")) window.addEventListener("beforeunload", preventReload);
    }
    listeners.forEach((listener) => listener());
  };
  return {
    get: (scope: string) => attempts.get(scope),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(scope: string, body: string, snapshot: Snapshot, key: () => string) {
      if (attempts.has(scope)) return null;
      const createdAt = now();
      if (!Number.isFinite(createdAt)) return null;
      const attempt: PosAttempt<Snapshot> = { key: key(), body, snapshot, status: "pending", createdAt, lastObservedAt: createdAt, retryExpiresAt: createdAt + POS_SAFE_RETRY_WINDOW_MS };
      attempts.set(scope, attempt);
      publish();
      return attempt;
    },
    retry(scope: string) {
      const attempt = attempts.get(scope);
      if (!attempt || attempt.status !== "unknown") return null;
      const observedAt = now();
      if (!Number.isFinite(observedAt) || observedAt < attempt.lastObservedAt || attempt.retryClockInvalid) {
        attempts.set(scope, { ...attempt, retryClockInvalid: true }); publish(); return null;
      }
      if (observedAt >= attempt.retryExpiresAt) {
        attempts.set(scope, { ...attempt, lastObservedAt: observedAt }); publish(); return null;
      }
      const retry = { ...attempt, status: "pending" as const, lastObservedAt: observedAt };
      attempts.set(scope, retry); publish();
      return retry;
    },
    unknown(scope: string) {
      const attempt = attempts.get(scope);
      if (attempt) {
        const observedAt = now();
        const invalid = !Number.isFinite(observedAt) || observedAt < attempt.lastObservedAt;
        attempts.set(scope, { ...attempt, status: "unknown", everUnknown: true,
          lastObservedAt: invalid ? attempt.lastObservedAt : observedAt,
          retryClockInvalid: attempt.retryClockInvalid || invalid }); publish();
      }
    },
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
