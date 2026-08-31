import { api, ApiError, idempotencyKey } from './api';
import { RequestError } from './request-scope';
import type { SubscriptionPlanVersion } from './types';

export const SUBSCRIPTION_CHANGE_WAIT_MS = 20_000;
export const SUBSCRIPTION_CHANGE_READ_MS = 12_000;

export type SubscriptionChangeReview = {
  readonly companyId: string;
  readonly plan: SubscriptionPlanVersion;
  readonly optionalIds: readonly string[];
  readonly subscriptionVersion: number;
  readonly fingerprint: string;
};
export function subscriptionChangeFingerprint(companyId: string, plan: SubscriptionPlanVersion, optionalIds: readonly string[], version: number) {
  return JSON.stringify([companyId, plan, [...optionalIds].sort(), version]);
}
const validCompanyId = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
export class SubscriptionContextMismatch extends ApiError {
  constructor() { super('', 409, 'SUBSCRIPTION_CONTEXT_MISMATCH'); }
}
export function isSubscriptionContextMismatch(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.code === 'SUBSCRIPTION_CONTEXT_MISMATCH' || cause.reason === 'SUBSCRIPTION_CONTEXT_MISMATCH');
}
export function createSubscriptionChangeReview(companyId: string, plan: SubscriptionPlanVersion, optionalIds: readonly string[], version: number): SubscriptionChangeReview {
  if (!validCompanyId(companyId)) throw new SubscriptionContextMismatch();
  // Detach the reviewed display and request from subsequent catalogue/selection mutations.
  const copy = structuredClone(plan);
  copy.modules.forEach(module => { Object.freeze(module.dependencyIds); Object.freeze(module); });
  Object.freeze(copy.modules); Object.freeze(copy);
  return Object.freeze({ companyId, plan: copy, optionalIds: Object.freeze([...optionalIds].sort()), subscriptionVersion: version,
    fingerprint: subscriptionChangeFingerprint(companyId, copy, optionalIds, version) });
}
export type SubscriptionChangeAttempt = Readonly<{ companyId: string; key: string; body: string; review: SubscriptionChangeReview }>;
export function createSubscriptionChangeAttempt(review: SubscriptionChangeReview): SubscriptionChangeAttempt {
  // Older in-memory reviews have no proven company. Never retrofit an identity.
  if (!validCompanyId(review?.companyId)) throw new SubscriptionContextMismatch();
  return Object.freeze({ companyId: review.companyId, key: idempotencyKey('subscription-change', review.plan.id), review,
    body: JSON.stringify({ expectedCompanyId: review.companyId, targetPlanVersionId: review.plan.id,
      optionalModuleIds: review.optionalIds, subscriptionVersion: review.subscriptionVersion }) });
}
export function subscriptionChangeAttemptMatchesCompany(attempt: SubscriptionChangeAttempt, companyId: string): boolean {
  if (!validCompanyId(companyId) || attempt?.companyId !== companyId || attempt.review?.companyId !== companyId) return false;
  // The retained bytes, not a reconstructed body, are sent on an explicit retry.
  try {
    const body: unknown = JSON.parse(attempt.body);
    return Boolean(body && typeof body === 'object' && 'expectedCompanyId' in body && body.expectedCompanyId === companyId);
  } catch { return false; }
}
export type SubscriptionChangeOutcome = 'uncertain' | 'conflict' | 'rejected';
export function subscriptionChangeOutcome(cause: unknown): SubscriptionChangeOutcome {
  // A rejection in B cannot establish whether an earlier attempt committed in A.
  if (isSubscriptionContextMismatch(cause) || !(cause instanceof ApiError) || cause.status >= 500 || cause.code === 'IDEMPOTENCY_IN_PROGRESS' || cause.code === 'IDEMPOTENCY_MISMATCH') return 'uncertain';
  return cause.status === 409 ? 'conflict' : 'rejected';
}
export async function sendSubscriptionChange(attempt: SubscriptionChangeAttempt, companyId: string, signal: AbortSignal) {
  if (!subscriptionChangeAttemptMatchesCompany(attempt, companyId)) throw new SubscriptionContextMismatch();
  const result = await api<{ change?: { state?: string }; paymentCollected?: boolean }>('/subscription/change-requests', {
    method: 'POST', body: attempt.body, idempotencyKey: attempt.key, signal, timeoutMs: SUBSCRIPTION_CHANGE_WAIT_MS,
  });
  if (result?.paymentCollected !== false || !['PENDING_APPROVAL', 'APPROVED'].includes(result.change?.state ?? '')) throw new RequestError('response');
  return result.change!.state as 'PENDING_APPROVAL' | 'APPROVED';
}

export type SubscriptionChangeRecord = {
  attempt: SubscriptionChangeAttempt;
  status: 'sending' | 'succeeded' | SubscriptionChangeOutcome;
  result?: 'PENDING_APPROVAL' | 'APPROVED';
};
export function subscriptionChangeFailure(attempt: SubscriptionChangeAttempt, cause: unknown, previous: SubscriptionChangeRecord | null) {
  // A failed retry describes that request only. Even an auth/precondition refusal
  // cannot settle an earlier unacknowledged write; retain its exact record.
  const unresolved = previous?.status === 'uncertain';
  const record: SubscriptionChangeRecord = unresolved ? previous : { attempt, status: subscriptionChangeOutcome(cause) };
  return { record, requiresContextRead: isSubscriptionContextMismatch(cause)
    || (unresolved && cause instanceof ApiError && cause.status >= 400 && cause.status < 500) };
}
// Memory only, scoped to actor + business. Remounting must not silently mint a new
// key for an unresolved write. A full browser restart cannot recover this memory;
// the UI explicitly explains that limit. No token or customer data is persisted.
const attempts = new Map<string, SubscriptionChangeRecord>();
export const rememberedSubscriptionChange = (scope: string) => attempts.get(scope) ?? null;
export function rememberSubscriptionChange(scope: string, record: SubscriptionChangeRecord | null) {
  if (record) attempts.set(scope, record); else attempts.delete(scope);
}
