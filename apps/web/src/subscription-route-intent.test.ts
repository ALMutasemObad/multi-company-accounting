import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscriptionRouteIntent, withoutSubscriptionPlanIntent } from './subscription-route-intent';
import { resolveSubscriptionPlanSelection } from './subscription-usage';

afterEach(() => vi.unstubAllGlobals());

describe('subscription page URL changes are untrusted choices', () => {
  it('keeps BIGINT exact and distinguishes forward/back choices without storage', () => {
    vi.stubGlobal('sessionStorage', { getItem() { throw new Error('blocked'); } });
    const first = subscriptionRouteIntent('#subscription?plan=2101')!;
    const second = subscriptionRouteIntent('#subscription?plan=9007199254740993')!;
    expect(first.key).not.toBe(second.key);
    expect(second.planId).toBe('9007199254740993');
    expect(subscriptionRouteIntent('#subscription?plan=2101')).toEqual(first);
  });

  it('does not restore a saved plan when Back removes the explicit parameter', () => {
    const getItem = vi.fn(() => JSON.stringify({ id: '2101', expiresAt: Date.now() + 60_000 }));
    vi.stubGlobal('sessionStorage', { getItem });
    expect(subscriptionRouteIntent('#subscription')?.planId).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
  });

  it.each(['plan=', 'plan=0', 'plan=1&plan=2', 'plan=1&plan=1', 'plan=javascript:alert(1)', 'plan=%201'])('clears invalid or ambiguous %s without defaulting to an available plan', query => {
    const intent = subscriptionRouteIntent(`#subscription?${query}`)!;
    expect(intent.planId).toBeNull();
    expect(resolveSubscriptionPlanSelection(['2101'], intent.planId ?? '', false)).toEqual({ selectedId: '', missing: false });
  });

  it('a missing URL choice stays empty on a partial catalog instead of selecting a replacement', () => {
    const intent = subscriptionRouteIntent('#subscription?plan=2102')!;
    const missing = resolveSubscriptionPlanSelection(['2101'], intent.planId!, false);
    expect(missing).toEqual({ selectedId: '', missing: true });
    expect(resolveSubscriptionPlanSelection(['2102'], missing.selectedId, false).selectedId).toBe('');
  });

  it('ignores unrelated route/query changes and carries no activation instruction', () => {
    expect(subscriptionRouteIntent('#subscription?plan=2101&token=secret&activate=true&redirect=https://invalid.example'))
      .toEqual(subscriptionRouteIntent('#subscription?plan=2101'));
    for (const hash of ['#home?plan=2101', '#login?plan=2101', '#subscription-other?plan=2101', '#reset-password?plan=2101']) {
      expect(subscriptionRouteIntent(hash)).toBeNull();
    }
  });
});

describe('consuming a protected link removes only its plan intent', () => {
  it('preserves unrelated parameters, their repeated values and encoded content', () => {
    const result = withoutSubscriptionPlanIntent('#subscription?tab=billing&plan=2102&tag=a&tag=b&return=%2Fx%3Fy%3D1');
    expect(result).toBe('#subscription?tab=billing&tag=a&tag=b&return=%2Fx%3Fy%3D1');
  });

  it('removes every plan parameter, including duplicate or invalid values', () => {
    expect(withoutSubscriptionPlanIntent('#subscription?plan=2101&plan=invalid&plan=')).toBe('#subscription');
  });

  it.each(['#subscription', '#subscription?', '#subscription?tab=billing%20details'])('does not rewrite an unchanged %s', hash => {
    expect(withoutSubscriptionPlanIntent(hash)).toBe(hash);
  });

  it('does not rewrite another route', () => {
    for (const hash of ['#home?plan=2102', '#login?plan=2102', '#subscription-other?plan=2102']) {
      expect(withoutSubscriptionPlanIntent(hash)).toBe(hash);
    }
  });
});
