import { ApiError, idempotencyKey } from "./api";
import { storageKey } from "./branding";

export type BillingCommand = "checkout" | "cancel" | "retry";
export type BillingIssue = "unknown" | "conflict" | "throttled" | "rejected";
export type BillingAttempt = Readonly<{
  schema: 1; scope: string; command: BillingCommand; resourceId: string; invoiceId: string;
  version: number; body: string; key: string;
  outcome: "unknown" | "confirmed" | "rejected"; issue: BillingIssue;
}>;
export type BillingAttemptInput = Pick<BillingAttempt, "scope" | "command" | "resourceId" | "invoiceId" | "version">;
export class BillingAttemptLocked extends Error {}
export class BillingStorageUnavailable extends Error {}
type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const slot = (scope: string) => storageKey(`billing-recovery.v1.${scope}`);
const bodyFor = (command: BillingCommand, version: number) => JSON.stringify(command === "checkout" ? { invoiceVersion: version } : { version });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

/** One unresolved command per user/activity in this tab. No financial data or checkout URL is stored.
 * Session storage survives reload, but is NOT a cross-tab/server lock or an idempotency receipt.
 * A missing row in a paginated read must never release an unknown attempt.
 */
export class BillingAttemptStore {
  constructor(private readonly storage: () => AttemptStorage = () => globalThis.sessionStorage) {}
  read(scope: string): BillingAttempt | null {
    try {
      const raw = this.storage().getItem(slot(scope));
      if (raw === null) return null;
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object") throw new BillingStorageUnavailable();
      const item = value as Record<string, unknown>;
      if (item.schema !== 1 || item.scope !== scope || !["checkout", "cancel", "retry"].includes(String(item.command))
        || typeof item.resourceId !== "string" || !uuid.test(item.resourceId)
        || typeof item.invoiceId !== "string" || !uuid.test(item.invoiceId)
        || !Number.isSafeInteger(item.version) || Number(item.version) < 0
        || typeof item.key !== "string" || item.key.length < 16 || item.key.length > 100
        || item.body !== bodyFor(item.command as BillingCommand, item.version as number)
        || !["unknown", "confirmed", "rejected"].includes(String(item.outcome))
        || !["unknown", "conflict", "throttled", "rejected"].includes(String(item.issue))) throw new BillingStorageUnavailable();
      return Object.freeze({ schema: 1, scope, command: item.command as BillingCommand, resourceId: item.resourceId,
        invoiceId: item.invoiceId, version: item.version as number, body: item.body as string, key: item.key,
        outcome: item.outcome as BillingAttempt["outcome"], issue: item.issue as BillingIssue });
    } catch { throw new BillingStorageUnavailable(); }
  }
  begin(input: BillingAttemptInput): BillingAttempt {
    if (this.read(input.scope)) throw new BillingAttemptLocked();
    if (!uuid.test(input.resourceId) || !uuid.test(input.invoiceId) || !Number.isSafeInteger(input.version) || input.version < 0) throw new BillingStorageUnavailable();
    // The short prefix keeps real UUID resource + UUID nonce below the API's 100-character limit.
    const attempt: BillingAttempt = Object.freeze({ ...input, schema: 1, body: bodyFor(input.command, input.version),
      key: idempotencyKey(`billing-${input.command}`, input.resourceId), outcome: "unknown", issue: "unknown" });
    this.save(attempt); // Persist BEFORE dispatch; storage failure must not send a financial command.
    return attempt;
  }
  settle(attempt: BillingAttempt, outcome: BillingAttempt["outcome"], issue: BillingIssue = "unknown") {
    if (this.read(attempt.scope)?.key !== attempt.key) throw new BillingAttemptLocked();
    const updated = Object.freeze({ ...attempt, outcome, issue });
    this.save(updated);
    return updated;
  }
  releaseReviewed(attempt: BillingAttempt) {
    const current = this.read(attempt.scope);
    if (!current || current.key !== attempt.key || current.outcome === "unknown") return false;
    try { this.storage().removeItem(slot(attempt.scope)); }
    catch { throw new BillingStorageUnavailable(); }
    if (this.read(attempt.scope)) throw new BillingStorageUnavailable();
    return true;
  }
  private save(attempt: BillingAttempt) {
    try { this.storage().setItem(slot(attempt.scope), JSON.stringify(attempt)); }
    catch { throw new BillingStorageUnavailable(); }
    const saved = this.read(attempt.scope);
    if (!saved || Object.entries(attempt).some(([key, value]) => saved[key as keyof BillingAttempt] !== value)) throw new BillingStorageUnavailable();
  }
}

export function billingCommandFailure(cause: unknown): { outcome: "unknown" | "rejected"; issue: BillingIssue } {
  // A provider effect can precede a conflict or server error. Do not infer rollback from either.
  if (cause instanceof ApiError) {
    if (cause.status === 409) return { outcome: "unknown", issue: "conflict" };
    if (cause.status === 429) return { outcome: "rejected", issue: "throttled" };
    if ([400, 401, 403].includes(cause.status)) return { outcome: "rejected", issue: "rejected" };
    if (cause.status === 422) return { outcome: "unknown", issue: "rejected" };
  }
  return { outcome: "unknown", issue: "unknown" };
}

export const billingAttemptStore = new BillingAttemptStore();
