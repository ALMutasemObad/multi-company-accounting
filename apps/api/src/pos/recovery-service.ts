import type { ActorContext } from "../platform/actor-context.js";
import { readPosRecoveryResult } from "./recovery-result.js";
import { POS_RECOVERY_OPERATION, type PosRecoveryOutcome, type PosRecoveryQueryPort } from "./recovery-types.js";

export class PosRecoveryService {
  constructor(private readonly query: PosRecoveryQueryPort, private readonly now: () => number = Date.now) {}

  /** authorize must use the current authenticated session, pos.checkout, entitlement and CSRF.
   * It runs before lookup and again before returning sensitive data; a failed authorization
   * propagates normally and must never be interpreted as a failed original checkout.
   */
  async recover(authorize: () => Promise<ActorContext>, attemptKey: string): Promise<PosRecoveryOutcome> {
    const context = await authorize();
    // Defense in depth for internal callers; public input belongs to the generated guard.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptKey)) return { outcome: "UNKNOWN" };
    const evidence = await this.query.find({ ...context, operation: POS_RECOVERY_OPERATION, attemptKey });
    const current = await authorize();
    const observedAt = this.now();
    if (current.companyId !== context.companyId || current.userId !== context.userId
      || !evidence || evidence.companyId !== context.companyId || evidence.userId !== context.userId
      || evidence.operation !== POS_RECOVERY_OPERATION || evidence.status !== "COMPLETED"
      || !Number.isFinite(observedAt) || !Number.isFinite(evidence.expiresAt.getTime())
      || evidence.expiresAt.getTime() <= observedAt) return { outcome: "UNKNOWN" };
    const result = readPosRecoveryResult(evidence.responseBody);
    return result ? { outcome: "CONFIRMED", result } : { outcome: "UNKNOWN" };
  }
}
