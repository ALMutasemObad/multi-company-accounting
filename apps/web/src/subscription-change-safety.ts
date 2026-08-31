import { api, ApiError, idempotencyKey } from './api';
import { RequestError } from './request-scope';
import type { SubscriptionPlanVersion } from './types';

export const SUBSCRIPTION_CHANGE_WAIT_MS = 20_000;
export const SUBSCRIPTION_CHANGE_READ_MS = 12_000;

export type SubscriptionChangeReview = {
  readonly plan: SubscriptionPlanVersion;
  readonly optionalIds: readonly string[];
  readonly subscriptionVersion: number;
  readonly fingerprint: string;
};
export function subscriptionChangeFingerprint(plan: SubscriptionPlanVersion, optionalIds: readonly string[], version: number) {
  return JSON.stringify([plan, [...optionalIds].sort(), version]);
}
export function createSubscriptionChangeReview(plan: SubscriptionPlanVersion, optionalIds: readonly string[], version: number): SubscriptionChangeReview {
  // Detach the reviewed display and request from subsequent catalogue/selection mutations.
  const copy = structuredClone(plan);
  copy.modules.forEach(module => { Object.freeze(module.dependencyIds); Object.freeze(module); });
  Object.freeze(copy.modules); Object.freeze(copy);
  return Object.freeze({ plan: copy, optionalIds: Object.freeze([...optionalIds].sort()), subscriptionVersion: version,
    fingerprint: subscriptionChangeFingerprint(copy, optionalIds, version) });
}
export type SubscriptionChangeAttempt = Readonly<{ key: string; body: string; review: SubscriptionChangeReview }>;
export function createSubscriptionChangeAttempt(review: SubscriptionChangeReview): SubscriptionChangeAttempt {
  return Object.freeze({ key: idempotencyKey('subscription-change', review.plan.id), review,
    body: JSON.stringify({ targetPlanVersionId: review.plan.id, optionalModuleIds: review.optionalIds, subscriptionVersion: review.subscriptionVersion }) });
}
export type SubscriptionChangeOutcome = 'uncertain' | 'conflict' | 'rejected';
export function subscriptionChangeOutcome(cause: unknown): SubscriptionChangeOutcome {
  if (!(cause instanceof ApiError) || cause.status >= 500 || cause.code === 'IDEMPOTENCY_IN_PROGRESS' || cause.code === 'IDEMPOTENCY_MISMATCH') return 'uncertain';
  return cause.status === 409 ? 'conflict' : 'rejected';
}
export async function sendSubscriptionChange(attempt: SubscriptionChangeAttempt, signal: AbortSignal) {
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
// Memory only, scoped to actor + business. Remounting must not silently mint a new
// key for an unresolved write. A full browser restart cannot recover this memory;
// the UI explicitly explains that limit. No token or customer data is persisted.
const attempts = new Map<string, SubscriptionChangeRecord>();
export const rememberedSubscriptionChange = (scope: string) => attempts.get(scope) ?? null;
export function rememberSubscriptionChange(scope: string, record: SubscriptionChangeRecord | null) {
  if (record) attempts.set(scope, record); else attempts.delete(scope);
}
