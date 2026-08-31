import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionUpgradeCard } from './SubscriptionUpgradeCard';
import { SubscriptionUpgradeBanner } from './SubscriptionUpgradeBanner';
import { createSubscriptionUpgradeDismissals } from './subscription-upgrade-dismissal';
import { subscriptionUpgradeCopy } from './i18n/locales/subscription-upgrade';
import { localeRegistry, type Locale } from './i18n/locales/registry';
import { observedAt, upgradeInput, upgradeScope, upgradeSnapshot, verifiedUpgradeInput } from './subscription-upgrade-test-fixtures';

const navigation = () => ({ openCatalog: vi.fn(), openSubscription: vi.fn(), reviewUpgrade: vi.fn() });

describe('S1 isolated subscription components', () => {
  it.each(Object.keys(localeRegistry) as Locale[])('renders %s with correct direction and complete copy without a shared dictionary provider', locale => {
    const copy = subscriptionUpgradeCopy(locale);
    const keys = Object.keys(subscriptionUpgradeCopy('ar')).sort();
    expect(Object.keys(copy).sort()).toEqual(keys);
    expect(Object.values(copy).every(value => value.trim().length > 0)).toBe(true);
    const ports = navigation();
    const markup = renderToStaticMarkup(<SubscriptionUpgradeCard input={verifiedUpgradeInput()} locale={locale} navigation={ports} />);
    expect(markup).toContain(`dir="${localeRegistry[locale].dir}"`); expect(markup).toContain(`lang="${locale}"`);
    expect(markup).toContain(copy.title); expect(markup).toContain(copy.compareUpgrade);
    expect(markup).toContain(copy['metric.includedUsers']); expect(markup).toContain(copy.notAutomatic);
    expect(markup).not.toMatch(/undefined|NaN|role="dialog"|role="alert"/u);
    expect(ports.reviewUpgrade).not.toHaveBeenCalled(); expect(ports.openCatalog).not.toHaveBeenCalled();
  });

  it('renders an explicit Subscribe button only for confirmed absence', () => {
    const input = { ...upgradeInput(), subscription: { state: 'confirmed-absent' as const, scope: upgradeScope, observedAt, source: 'subscription-owner' as const } };
    const markup = renderToStaticMarkup(<SubscriptionUpgradeCard input={input} locale="en" navigation={navigation()} />);
    expect(markup).toContain('>Subscribe</button>'); expect(markup).toContain(subscriptionUpgradeCopy('en').confirmedAbsent);
    for (const state of ['loading', 'error', 'unavailable'] as const) {
      const unknown = renderToStaticMarkup(<SubscriptionUpgradeCard input={{ ...input, subscription: { state } }} locale="en" navigation={navigation()} />);
      expect(unknown).not.toContain('<button'); expect(unknown).not.toContain(subscriptionUpgradeCopy('en').confirmedAbsent);
    }
  });

  it('does not disclose plan name, billing values, state, or pending request to a view-only employee', () => {
    const snapshot = upgradeSnapshot(); snapshot.current.plan.displayName = 'PRIVATE_PLAN_SENTINEL';
    snapshot.subscription.status = 'PAST_DUE'; snapshot.pending = { ...snapshot.current, state: 'PENDING_APPROVAL' };
    snapshot.current.quote.totalRecurringFee = '7654321.0000';
    const original = upgradeInput(snapshot);
    const input = { ...original, access: { ...original.access, permissions: new Set(['subscriptions.view']) } };
    const markup = renderToStaticMarkup(<SubscriptionUpgradeCard input={input} locale="en" navigation={navigation()} />);
    expect(markup).toContain(subscriptionUpgradeCopy('en').contactOwner);
    expect(markup).not.toMatch(/PRIVATE_PLAN_SENTINEL|7654321|Past due|under review|<button/u);
  });

  it('escapes owner-controlled names and gives each component a unique accessible heading', () => {
    const input = verifiedUpgradeInput();
    if (input.catalog.state !== 'ready') throw new Error('test setup');
    input.catalog.catalog.plans[0]!.displayName = '<script>no</script>';
    const markup = renderToStaticMarkup(<><SubscriptionUpgradeCard input={input} locale="en" navigation={navigation()} />
      <SubscriptionUpgradeCard input={input} locale="en" navigation={navigation()} /></>);
    expect(markup).not.toContain('<script>'); expect(markup).toContain('&lt;script&gt;no&lt;/script&gt;');
    const ids = [...markup.matchAll(/ id="([^"]+)"/gu)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows neutral browsing without a verified relationship and no invented higher/basic/free label', () => {
    const markup = renderToStaticMarkup(<SubscriptionUpgradeCard input={upgradeInput()} locale="en" navigation={navigation()} />);
    expect(markup).toContain(subscriptionUpgradeCopy('en').orderingUnavailable);
    expect(markup).toContain('>View plans</button>'); expect(markup).not.toContain('Candidate test plan');
    expect(markup).not.toContain(subscriptionUpgradeCopy('en').compareUpgrade);
  });

  it('has no overlay or cashier hook, hides loading/error banners, and respects dismissal after remount', () => {
    const store = createSubscriptionUpgradeDismissals(); const input = upgradeInput();
    const render = () => renderToStaticMarkup(<SubscriptionUpgradeBanner input={input} locale="ar" navigation={navigation()} dismissals={store} />);
    expect(render()).toContain(subscriptionUpgradeCopy('ar').dismiss);
    expect(render()).not.toMatch(/role="dialog"|role="alert"|autofocus|pos|checkout/iu);
    store.dismiss(upgradeScope); expect(render()).toBe('');
    for (const state of ['loading', 'error', 'unavailable'] as const) {
      expect(renderToStaticMarkup(<SubscriptionUpgradeBanner input={{ ...input, subscription: { state } }} locale="en"
        navigation={navigation()} dismissals={createSubscriptionUpgradeDismissals()} />)).toBe('');
    }
  });
});
