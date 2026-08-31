import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { RequestError } from './request-scope';
import type { SubscriptionPlanVersion } from './types';
import { createSubscriptionChangeAttempt, createSubscriptionChangeReview, rememberedSubscriptionChange, rememberSubscriptionChange, sendSubscriptionChange, subscriptionChangeFingerprint, subscriptionChangeOutcome, SUBSCRIPTION_CHANGE_WAIT_MS } from './subscription-change-safety';

const plan: SubscriptionPlanVersion = {
  id: '2101', planId: '1101', planCode: 'TEST_ONLY', versionNumber: 2, displayName: 'Test', description: null,
  billingCycle: 'ANNUAL', currencyCode: 'SAR', recurringFee: '9007199254740993.1234',
  includedUsers: null, pricePerAdditionalUser: '0.0001', includedEmployees: null, pricePerAdditionalEmployee: null,
  includedPostedDocuments: null, pricePerAdditionalPostedDocument: null, taxRate: '15.1250', paymentTermsDays: 0,
  trialDays: 0, effectiveFrom: '2026-08-01T00:00:00Z', selfServicePolicy: 'REQUEST_ONLY', publicationStatus: 'PUBLISHED',
  publishedAt: '2026-08-01T00:00:00Z', retiredAt: null, version: 7,
  modules: [{ id: '2', code: 'TEST', displayName: 'Add-on', active: true, selectionMode: 'OPTIONAL', additionalRecurringFee: '0.0001', dependencyIds: ['1'] }],
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('immutable review and attempt', () => {
  it('retains exact decimals, selected add-ons and original version; sends no client price/tax fields', () => {
    const review = createSubscriptionChangeReview(plan, ['2', '1'], 9);
    const attempt = createSubscriptionChangeAttempt(review);
    expect(review.plan.recurringFee).toBe('9007199254740993.1234');
    expect(review.plan.taxRate).toBe('15.1250');
    expect(JSON.parse(attempt.body)).toEqual({ targetPlanVersionId: '2101', optionalModuleIds: ['1', '2'], subscriptionVersion: 9 });
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(Object.isFrozen(review.plan.modules[0]!.dependencyIds)).toBe(true);
  });
  it('detaches review and invalidates it for any plan version, price, option or subscription version change', () => {
    const source = structuredClone(plan);
    const review = createSubscriptionChangeReview(source, ['2'], 9);
    source.recurringFee = '1';
    expect(review.plan.recurringFee).toBe(plan.recurringFee);
    expect(review.fingerprint).not.toBe(subscriptionChangeFingerprint(source, ['2'], 9));
    expect(review.fingerprint).not.toBe(subscriptionChangeFingerprint({ ...plan, version: 8 }, ['2'], 9));
    expect(review.fingerprint).not.toBe(subscriptionChangeFingerprint(plan, [], 9));
    expect(review.fingerprint).not.toBe(subscriptionChangeFingerprint(plan, ['2'], 10));
  });
  it('keeps unresolved attempts separately by actor and business, without browser storage', () => {
    const record = { attempt: createSubscriptionChangeAttempt(createSubscriptionChangeReview(plan, [], 1)), status: 'uncertain' as const };
    rememberSubscriptionChange('user-a:company-a', record);
    expect(rememberedSubscriptionChange('user-b:company-a')).toBeNull();
    expect(rememberedSubscriptionChange('user-a:company-b')).toBeNull();
    expect(rememberedSubscriptionChange('user-a:company-a')).toBe(record);
    rememberSubscriptionChange('user-a:company-a', null);
    expect(rememberedSubscriptionChange('user-a:company-a')).toBeNull();
  });
});

describe('outcome classification', () => {
  it.each([new RequestError('network'), new RequestError('response'), new RequestError('cancelled'), new RequestError('timeout'), new ApiError('', 500), new ApiError('', 409, 'IDEMPOTENCY_IN_PROGRESS'), new ApiError('', 409, 'IDEMPOTENCY_MISMATCH')])('preserves an uncertain result: %s', cause => {
    expect(subscriptionChangeOutcome(cause)).toBe('uncertain');
  });
  it('separates a definitive version conflict and rejection', () => {
    expect(subscriptionChangeOutcome(new ApiError('', 409, 'VERSION_CONFLICT'))).toBe('conflict');
    for (const status of [400, 401, 403, 429]) expect(subscriptionChangeOutcome(new ApiError('', status))).toBe('rejected');
  });
});

describe('bounded opt-in transport with no automatic replay', () => {
  it('reuses the exact key and body only on a second explicit call', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ change: { state: 'PENDING_APPROVAL' }, paymentCollected: false })));
    vi.stubGlobal('fetch', fetcher);
    const attempt = createSubscriptionChangeAttempt(createSubscriptionChangeReview(plan, ['2'], 9));
    await expect(sendSubscriptionChange(attempt, new AbortController().signal)).rejects.toBeInstanceOf(RequestError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await sendSubscriptionChange(attempt, new AbortController().signal)).toBe('PENDING_APPROVAL');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = fetcher.mock.calls[0]![1] as RequestInit;
    const second = fetcher.mock.calls[1]![1] as RequestInit;
    expect(first.body).toBe(second.body);
    expect(new Headers(first.headers).get('Idempotency-Key')).toBe(new Headers(second.headers).get('Idempotency-Key'));
  });
  it('times out even when the transport ignores abort and never replays', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const pending = sendSubscriptionChange(createSubscriptionChangeAttempt(createSubscriptionChangeReview(plan, [], 1)), new AbortController().signal);
    const check = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(SUBSCRIPTION_CHANGE_WAIT_MS + 1);
    await check;
    finish(new Response(JSON.stringify({ change: { state: 'APPROVED' }, paymentCollected: false })));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancels waiting without claiming rollback or a successful late result', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetcher);
    const pending = sendSubscriptionChange(createSubscriptionChangeAttempt(createSubscriptionChangeReview(plan, [], 1)), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['', '{"change":{"state":"UNKNOWN"},"paymentCollected":false}'])('treats missing or unknown success bodies as uncertain', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(sendSubscriptionChange(createSubscriptionChangeAttempt(createSubscriptionChangeReview(plan, [], 1)), new AbortController().signal)).rejects.toMatchObject({ kind: 'response' });
  });
});
