import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { RequestError } from './request-scope';
import type { SubscriptionPlanVersion } from './types';
import { createSubscriptionChangeAttempt, createSubscriptionChangeReview, rememberedSubscriptionChange, rememberSubscriptionChange, sendSubscriptionChange, subscriptionChangeAttemptMatchesCompany, subscriptionChangeFailure, subscriptionChangeFingerprint, subscriptionChangeOutcome, SubscriptionContextMismatch, SUBSCRIPTION_CHANGE_WAIT_MS, type SubscriptionChangeAttempt, type SubscriptionChangeReview } from './subscription-change-safety';

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
    const review = createSubscriptionChangeReview('1', plan, ['2', '1'], 9);
    const attempt = createSubscriptionChangeAttempt(review);
    expect(review.plan.recurringFee).toBe('9007199254740993.1234');
    expect(review.plan.taxRate).toBe('15.1250');
    expect(review.companyId).toBe('1'); expect(attempt.companyId).toBe('1');
    expect(JSON.parse(attempt.body)).toEqual({ expectedCompanyId: '1', targetPlanVersionId: '2101', optionalModuleIds: ['1', '2'], subscriptionVersion: 9 });
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(Object.isFrozen(review.plan.modules[0]!.dependencyIds)).toBe(true);
  });
  it('detaches review and invalidates it for any plan version, price, option or subscription version change', () => {
    const source = structuredClone(plan);
    const review = createSubscriptionChangeReview('1', source, ['2'], 9);
    source.recurringFee = '1';
    expect(review.plan.recurringFee).toBe(plan.recurringFee);
    expect(review.fingerprint).not.toBe(subscriptionChangeFingerprint('1', source, ['2'], 9));
    expect(review.fingerprint).not.toBe(subscriptionChangeFingerprint('1', { ...plan, version: 8 }, ['2'], 9));
    expect(review.fingerprint).not.toBe(subscriptionChangeFingerprint('1', plan, [], 9));
    expect(review.fingerprint).not.toBe(subscriptionChangeFingerprint('1', plan, ['2'], 10));
    expect(review.fingerprint).not.toBe(subscriptionChangeFingerprint('2', plan, ['2'], 9));
  });
  it('keeps unresolved attempts separately by actor and business, without browser storage', () => {
    const record = { attempt: createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, [], 1)), status: 'uncertain' as const };
    rememberSubscriptionChange('user-a:company-a', record);
    expect(rememberedSubscriptionChange('user-b:company-a')).toBeNull();
    expect(rememberedSubscriptionChange('user-a:company-b')).toBeNull();
    expect(rememberedSubscriptionChange('user-a:company-a')).toBe(record);
    rememberSubscriptionChange('user-a:company-a', null);
    expect(rememberedSubscriptionChange('user-a:company-a')).toBeNull();
  });
});

describe('subscription company precondition', () => {
  it('keeps a company ID above MAX_SAFE_INTEGER exact in the review, attempt and transport', () => {
    const companyId = '9007199254740993';
    const attempt = createSubscriptionChangeAttempt(createSubscriptionChangeReview(companyId, plan, [], 1));
    expect(attempt.companyId).toBe(companyId);
    expect(attempt.review.companyId).toBe(companyId);
    expect(JSON.parse(attempt.body).expectedCompanyId).toBe(companyId);
    expect(subscriptionChangeAttemptMatchesCompany(attempt, companyId)).toBe(true);
    expect(subscriptionChangeAttemptMatchesCompany(attempt, '9007199254740992')).toBe(false);
  });
  it.each(['', '0', '-1', '01', '1.0', 'company-a'])('rejects an unproven review identity %s before creating an attempt', companyId => {
    expect(() => createSubscriptionChangeReview(companyId, plan, [], 1)).toThrow(SubscriptionContextMismatch);
  });
  it('does not retrofit a legacy review with the current company', () => {
    const legacy = { ...createSubscriptionChangeReview('1', plan, [], 1) };
    Reflect.deleteProperty(legacy, 'companyId');
    const before = JSON.stringify(legacy);
    expect(() => createSubscriptionChangeAttempt(legacy as SubscriptionChangeReview)).toThrow(SubscriptionContextMismatch);
    expect(JSON.stringify(legacy)).toBe(before);
  });
  it.each(['attempt', 'review', 'body', 'different-body', 'invalid-body'] as const)('never sends or rewrites a saved attempt with %s identity missing or inconsistent', async defect => {
    const good = createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, [], 1));
    const invalid = { ...good, review: { ...good.review } };
    if (defect === 'attempt') Reflect.deleteProperty(invalid, 'companyId');
    if (defect === 'review') Reflect.deleteProperty(invalid.review, 'companyId');
    if (defect === 'body') {
      const body = JSON.parse(invalid.body); Reflect.deleteProperty(body, 'expectedCompanyId');
      invalid.body = JSON.stringify(body);
    }
    if (defect === 'different-body') invalid.body = JSON.stringify({ ...JSON.parse(invalid.body), expectedCompanyId: '2' });
    if (defect === 'invalid-body') invalid.body = '{';
    const attempt = Object.freeze(invalid) as SubscriptionChangeAttempt;
    const before = JSON.stringify(attempt);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(subscriptionChangeAttemptMatchesCompany(attempt, '1')).toBe(false);
    await expect(sendSubscriptionChange(attempt, '1', new AbortController().signal)).rejects.toMatchObject({ code: 'SUBSCRIPTION_CONTEXT_MISMATCH' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(attempt)).toBe(before);
  });
  it('does not send A under B and later sends the same retained bytes only after an explicit A call', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('unknown first outcome'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ change: { state: 'PENDING_APPROVAL' }, paymentCollected: false })));
    vi.stubGlobal('fetch', fetcher);
    const attempt = createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, ['2'], 9));
    const before = JSON.stringify(attempt);
    await expect(sendSubscriptionChange(attempt, '1', new AbortController().signal)).rejects.toBeInstanceOf(RequestError);
    await expect(sendSubscriptionChange(attempt, '2', new AbortController().signal)).rejects.toBeInstanceOf(SubscriptionContextMismatch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(attempt)).toBe(before);
    await expect(sendSubscriptionChange(attempt, '1', new AbortController().signal)).resolves.toBe('PENDING_APPROVAL');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = fetcher.mock.calls[0]![1] as RequestInit;
    const second = fetcher.mock.calls[1]![1] as RequestInit;
    expect(first.body).toBe(attempt.body); expect(second.body).toBe(attempt.body);
    expect(new Headers(first.headers).get('Idempotency-Key')).toBe(attempt.key);
    expect(new Headers(second.headers).get('Idempotency-Key')).toBe(attempt.key);
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
  it.each([new SubscriptionContextMismatch(), new ApiError('', 409, 'SUBSCRIPTION_CONTEXT_MISMATCH'),
    new ApiError('', 409, 'CONFLICT', 'SUBSCRIPTION_CONTEXT_MISMATCH')])('does not release an original unknown attempt after a context refusal: %s', cause => {
    expect(subscriptionChangeOutcome(cause)).toBe('uncertain');
  });
});

describe('failed retries cannot resolve an earlier uncertain attempt', () => {
  it.each([
    new ApiError('', 401, 'UNAUTHENTICATED'),
    new ApiError('', 403, 'FORBIDDEN'),
    new ApiError('', 403, 'INVALID_CSRF'),
    new ApiError('', 400, 'BAD_REQUEST'),
    new ApiError('', 409, 'VERSION_CONFLICT'),
    new ApiError('', 412, 'PRECONDITION_FAILED'),
    new ApiError('', 422, 'VALIDATION_FAILED'),
    new ApiError('', 429, 'RATE_LIMITED'),
    new SubscriptionContextMismatch(),
  ])('retains the exact prior record and requires a fresh context read after %s', cause => {
    const attempt = createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, ['2'], 9));
    const previous = Object.freeze({ attempt, status: 'uncertain' as const });
    const before = JSON.stringify(previous);
    const failure = subscriptionChangeFailure(attempt, cause, previous);
    expect(failure.record).toBe(previous);
    expect(failure.record.status).toBe('uncertain');
    expect(failure.requiresContextRead).toBe(true);
    expect(JSON.stringify(previous)).toBe(before);
  });
  it.each([new ApiError('', 503, 'UNAVAILABLE'), new RequestError('network'), new RequestError('response'), new RequestError('cancelled')])('also retains a failed transport retry without inventing a context mismatch: %s', cause => {
    const attempt = createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, [], 9));
    const previous = Object.freeze({ attempt, status: 'uncertain' as const });
    const failure = subscriptionChangeFailure(attempt, cause, previous);
    expect(failure.record).toBe(previous);
    expect(failure.requiresContextRead).toBe(false);
  });
  it.each(['FORBIDDEN', 'INVALID_CSRF'])('still distinguishes a first-request %s rejection from a retry of an unknown write', code => {
    const attempt = createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, [], 9));
    const failure = subscriptionChangeFailure(attempt, new ApiError('', 403, code), null);
    expect(failure.record).toEqual({ attempt, status: 'rejected' });
    expect(failure.requiresContextRead).toBe(false);
  });
  it('keeps a first-request context refusal uncertain and blocked', () => {
    const attempt = createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, [], 9));
    const failure = subscriptionChangeFailure(attempt, new SubscriptionContextMismatch(), null);
    expect(failure.record).toEqual({ attempt, status: 'uncertain' });
    expect(failure.requiresContextRead).toBe(true);
  });
});

describe('bounded opt-in transport with no automatic replay', () => {
  it('reuses the exact key and body only on a second explicit call', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ change: { state: 'PENDING_APPROVAL' }, paymentCollected: false })));
    vi.stubGlobal('fetch', fetcher);
    const attempt = createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, ['2'], 9));
    await expect(sendSubscriptionChange(attempt, '1', new AbortController().signal)).rejects.toBeInstanceOf(RequestError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await sendSubscriptionChange(attempt, '1', new AbortController().signal)).toBe('PENDING_APPROVAL');
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
    const pending = sendSubscriptionChange(createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, [], 1)), '1', new AbortController().signal);
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
    const pending = sendSubscriptionChange(createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, [], 1)), '1', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['', '{"change":{"state":"UNKNOWN"},"paymentCollected":false}'])('treats missing or unknown success bodies as uncertain', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(sendSubscriptionChange(createSubscriptionChangeAttempt(createSubscriptionChangeReview('1', plan, [], 1)), '1', new AbortController().signal)).rejects.toMatchObject({ kind: 'response' });
  });
});
