import type { PosCheckoutResult } from "./types";

export type PosRecoveryScope = Readonly<{ userId: string; companyId: string; canCheckout: boolean }>;
export type PosRecoveryMarker = Readonly<{ version: 1; attemptKey: string; startedAt: number }>;
export type PosRecoveryOutcome = { outcome: "UNKNOWN" } | { outcome: "CONFIRMED"; result: PosCheckoutResult };
export type PosRecoveryState =
  | { status: "blocked"; reason: "permission" | "storage" | "coordination" }
  | { status: "initializing" | "ready" | "pending" | "checking" }
  | { status: "unknown"; reason: "unconfirmed" | "expired" | "clock" }
  | { status: "confirmed"; result: PosCheckoutResult };

// Warning threshold only. Never a permission to clear, repeat or replace an attempt.
export const POS_RECOVERY_WARNING_MS = 23 * 60 * 60 * 1000;
export const posRecoveryKey = (scope: PosRecoveryScope) => `pos-recovery:v1:${JSON.stringify([scope.userId, scope.companyId])}`;
export const validPosRecoveryKey = (key: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
export const canStartPosRecoverySale = (state: PosRecoveryState) => state.status === "ready";
export const canReadPosRecovery = (state: PosRecoveryState) => state.status === "unknown";

export function readPosRecoveryMarker(raw: string): PosRecoveryMarker | null {
  if (raw.length > 256) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const marker = value as Record<string, unknown>;
    if (Object.keys(marker).sort().join(",") !== "attemptKey,startedAt,version" || marker.version !== 1
      || typeof marker.attemptKey !== "string" || !validPosRecoveryKey(marker.attemptKey)
      || typeof marker.startedAt !== "number" || !Number.isSafeInteger(marker.startedAt) || marker.startedAt < 0) return null;
    return { version: 1, attemptKey: marker.attemptKey, startedAt: marker.startedAt };
  } catch { return null; }
}

export function unresolvedPosRecovery(marker: PosRecoveryMarker, now: number): PosRecoveryState {
  if (!Number.isSafeInteger(now) || now < marker.startedAt) return { status: "unknown", reason: "clock" };
  return { status: "unknown", reason: now - marker.startedAt >= POS_RECOVERY_WARNING_MS ? "expired" : "unconfirmed" };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,19}$/.test(value)
  && BigInt(value) <= 18446744073709551615n;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 500;
const amount = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,14})\.\d{4}$/.test(value);
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(id);

/** Defensive acknowledgement decoder, no financial arithmetic or locally inferred success. */
export function readPosRecoveryResult(value: unknown): PosCheckoutResult | null {
  if (!record(value) || !id(value.id) || typeof value.completedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.completedAt)
    || !Number.isFinite(Date.parse(value.completedAt)) || new Date(value.completedAt).toISOString() !== value.completedAt) return null;
  const invoice = value.invoice; const receipt = value.receipt;
  if (!record(invoice) || !record(receipt) || !id(invoice.id) || !id(receipt.id)
    || !text(invoice.documentNumber) || !text(receipt.documentNumber) || !text(invoice.customerName)
    || invoice.status !== "POSTED" || receipt.status !== "POSTED"
    || !amount(invoice.total) || !amount(invoice.baseTotal)
    || !ids(invoice.generatedJournalEntryIds) || !ids(receipt.generatedJournalEntryIds)) return null;
  return { id: value.id, completedAt: value.completedAt,
    invoice: { id: invoice.id, documentNumber: invoice.documentNumber, status: "POSTED", customerName: invoice.customerName,
      total: invoice.total, baseTotal: invoice.baseTotal, generatedJournalEntryIds: [...invoice.generatedJournalEntryIds] },
    receipt: { id: receipt.id, documentNumber: receipt.documentNumber, status: "POSTED", generatedJournalEntryIds: [...receipt.generatedJournalEntryIds] } };
}

export function readPosRecoveryOutcome(value: unknown): PosRecoveryOutcome {
  if (!record(value) || value.outcome !== "CONFIRMED") return { outcome: "UNKNOWN" };
  const result = readPosRecoveryResult(value.result);
  return result ? { outcome: "CONFIRMED", result } : { outcome: "UNKNOWN" };
}
