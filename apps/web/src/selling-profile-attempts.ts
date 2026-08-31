import { initialSellingProfileFields, type SellingProfileEditorValue, type SellingProfileSaveCommand,
  type SellingProfileSaveOutcome } from "./selling-profile-editor-model";

export type SellingProfileAttempt = {
  command: SellingProfileSaveCommand; key: string;
  status: "sending" | "unknown" | "saved" | "rejected";
  outcome: SellingProfileSaveOutcome | null;
};
// Session-memory command journal only, never a source of prices/defaults and never browser storage.
// Unknown/sending entries are not evicted. A full unresolved journal fails closed.
export const SELLING_PROFILE_ATTEMPT_LIMIT = 16;
const attempts = new Map<string, SellingProfileAttempt>();
const listeners = new Map<string, Set<() => void>>();
let unloadGuardAttached = false;
const preventUnknownUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
export const sellingProfileAttemptScope = (scopeKey: string, itemId: string) => JSON.stringify([scopeKey, itemId]);
export const getSellingProfileAttempt = (scope: string) => attempts.get(scope) ?? null;
export const isUnresolvedSellingAttempt = (attempt: SellingProfileAttempt | null) => attempt?.status === "sending" || attempt?.status === "unknown";
export function subscribeSellingProfileAttempt(scope: string, listener: () => void) {
  const set = listeners.get(scope) ?? new Set<() => void>(); set.add(listener); listeners.set(scope, set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(scope); };
}
function publish(scope: string, attempt: SellingProfileAttempt) {
  attempts.set(scope, attempt);
  if (typeof window !== "undefined") {
    const unresolved = [...attempts.values()].some(isUnresolvedSellingAttempt);
    if (unresolved && !unloadGuardAttached) window.addEventListener("beforeunload", preventUnknownUnload);
    if (!unresolved && unloadGuardAttached) window.removeEventListener("beforeunload", preventUnknownUnload);
    unloadGuardAttached = unresolved;
  }
  listeners.get(scope)?.forEach(listener => listener());
}
export function sellingProfileAttemptFields(profile: SellingProfileEditorValue | null, attempt: SellingProfileAttempt | null) {
  if (!isUnresolvedSellingAttempt(attempt) || !attempt) return initialSellingProfileFields(profile);
  const body = attempt.command.body;
  return { unitPrice: body.unitPrice, currencyId: body.currencyId, revenueAccountId: body.revenueAccountId,
    taxRateId: body.taxRateId ?? "", isActive: "isActive" in body ? body.isActive : true };
}
export async function sendSellingProfileAttempt(scope: string, command: SellingProfileSaveCommand | null,
  sender: (command: SellingProfileSaveCommand, key: string) => Promise<SellingProfileSaveOutcome>, retry = false): Promise<void> {
  const previous = attempts.get(scope);
  if (previous?.status === "sending") return;
  if (retry && previous?.status !== "unknown") return;
  if (!retry && isUnresolvedSellingAttempt(previous ?? null)) throw new Error("UNRESOLVED_SELLING_PROFILE_WRITE");
  if (!retry && !command) return;
  if (!previous && attempts.size >= SELLING_PROFILE_ATTEMPT_LIMIT) {
    const settled = [...attempts.entries()].find(([, value]) => !isUnresolvedSellingAttempt(value));
    if (!settled) throw new Error("SELLING_PROFILE_ATTEMPT_CAPACITY");
    attempts.delete(settled[0]);
  }
  const frozenCommand = retry ? previous!.command : Object.freeze({ ...command!, body: Object.freeze({ ...command!.body }) }) as SellingProfileSaveCommand;
  const attempt: SellingProfileAttempt = { command: frozenCommand, key: retry ? previous!.key : crypto.randomUUID(), status: "sending", outcome: null };
  publish(scope, attempt);
  let outcome: SellingProfileSaveOutcome;
  try { outcome = await sender(attempt.command, attempt.key); } catch { outcome = { status: "unknown" }; }
  // A late completion belongs to the original scope/attempt, never to the currently selected item.
  if (attempts.get(scope) !== attempt) return;
  publish(scope, { ...attempt, status: outcome.status, outcome });
}
