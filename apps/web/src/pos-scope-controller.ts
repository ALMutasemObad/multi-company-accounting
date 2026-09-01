import { api } from "./api";
import { canonicalPosId, hasExpectedPosContext, isPosScopeFailure, posExpectedHeaders, PosScopeError,
  type PosExpectedContext, type PosRequest, type PosRequestOptions } from "./pos-scope-transport";

export type PosScopeSnapshot = Readonly<{ status: "initializing" | "checking" | "ready" | "quarantined" | "disposed"; generation: number }>;

/** Scope is a precondition, never an ActorContext. Only an explicit identity check can
 * reopen quarantine; an older successful owner read cannot reopen this local latch. */
export function createPosScopeController(context: PosExpectedContext, transport: PosRequest = api, purpose: "checkout" | "history" = "checkout") {
  const expected = Object.freeze({ userId: context.userId, companyId: context.companyId });
  const identityPath = purpose === "history" ? "/pos/context/identity?purpose=history" : "/pos/context/identity";
  let generation = 0; let active = false;
  let state: PosScopeSnapshot = { status: "initializing", generation };
  const listeners = new Set<() => void>(); const requests = new Set<AbortController>();
  const publish = (status: PosScopeSnapshot["status"]) => { state = { status, generation }; for (const listener of listeners) listener(); };
  const abortAll = () => { for (const request of requests) request.abort(); requests.clear(); };
  const quarantine = () => { if (!active) return; generation += 1; abortAll(); publish("quarantined"); };
  const valid = () => canonicalPosId(expected.userId) && canonicalPosId(expected.companyId);
  const isCurrent = (ticket: number, status: PosScopeSnapshot["status"]) => active && generation === ticket && state.status === status;
  function assertReady(ticket = generation): number {
    if (!active || state.status !== "ready" || ticket !== generation) throw new PosScopeError("closed");
    return generation;
  }
  async function perform<T>(path: string, options: PosRequestOptions = {}, verifying = false): Promise<T> {
    const ticket = generation;
    if (!active || (verifying ? state.status !== "checking" : state.status !== "ready")) throw new PosScopeError("closed");
    const controller = new AbortController(); requests.add(controller);
    const abort = () => controller.abort(); const source = options.signal;
    if (source?.aborted) abort(); else source?.addEventListener("abort", abort, { once: true });
    try {
      if (controller.signal.aborted) throw new PosScopeError("stale");
      const result = await transport<T>(path, { ...options, headers: posExpectedHeaders(expected, options.headers), signal: controller.signal });
      if (!active || ticket !== generation || controller.signal.aborted || (verifying ? state.status !== "checking" : state.status !== "ready")) throw new PosScopeError("stale");
      if (!hasExpectedPosContext(result, expected)) { quarantine(); throw new PosScopeError("response"); }
      return result;
    } catch (cause) {
      if (active && ticket === generation && isPosScopeFailure(cause)) quarantine();
      throw cause;
    } finally { requests.delete(controller); source?.removeEventListener("abort", abort); }
  }
  async function verifyIdentity(): Promise<boolean> {
    if (!active || state.status === "checking") return false;
    generation += 1; abortAll(); publish("checking"); const ticket = generation;
    if (!valid()) { quarantine(); return false; }
    try {
      await perform(identityPath, { timeoutMs: 10_000 }, true);
      if (!isCurrent(ticket, "checking")) return false;
      publish("ready"); return true;
    } catch { if (active && generation === ticket) quarantine(); return false; }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async activate() { if (active) return state.status === "ready"; active = true; return verifyIdentity(); },
    verifyIdentity,
    /** The pre-marker check does not reset generation or unlock a quarantined scope. */
    async preflight() { const ticket = assertReady(); await perform(identityPath, { timeoutMs: 10_000 }); assertReady(ticket); return ticket; },
    request: perform as PosRequest,
    assertReady,
    isReady: () => active && state.status === "ready",
    quarantine,
    dispose() { active = false; generation += 1; abortAll(); publish("disposed"); listeners.clear(); },
  };
}
export type PosScopeController = ReturnType<typeof createPosScopeController>;
