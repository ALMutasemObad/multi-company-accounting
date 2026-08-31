import { describe, expect, it, vi } from 'vitest';
import type { SubscriptionSnapshot } from './types';
import { subscriptionUpgradeFromCatalog, subscriptionUpgradeFromSnapshot } from './subscription-upgrade-contract';
import { subscriptionUpgradeDifferences, subscriptionUpgradeModel } from './subscription-upgrade-policy';
import { activateSubscriptionUpgrade } from './subscription-upgrade-actions';
import { createSubscriptionUpgradeDismissals } from './subscription-upgrade-dismissal';
import { observedAt, readBatchId, upgradeInput, upgradePlan, upgradeScope, upgradeSnapshot, verifiedUpgradeInput } from './subscription-upgrade-test-fixtures';

describe('S1 subscription truth and authorization', () => {
  it.each(['loading', 'unavailable', 'error'] as const)('never interprets %s as no subscription', state => {
    const model = subscriptionUpgradeModel({ ...upgradeInput(), subscription: { state } });
    expect(model).toMatchObject({ state, action: 'none', offers: [] });
    expect(model.currentPlan).toBeUndefined();
  });

  it('treats a missing row/404 read as unavailable evidence, never confirmed absence', () => {
    expect(subscriptionUpgradeFromSnapshot(upgradeScope, undefined as unknown as SubscriptionSnapshot, readBatchId)).toEqual({ state: 'error' });
    const missingRow = { ...upgradeInput(), subscription: { state: 'error' as const } };
    expect(subscriptionUpgradeModel(missingRow).action).toBe('none');
    const ports = { openCatalog: vi.fn(), openSubscription: vi.fn(), reviewUpgrade: vi.fn() };
    expect(activateSubscriptionUpgrade(missingRow, ports, 'primary')).toBe(false);
    expect(ports.openCatalog).not.toHaveBeenCalled();
  });

  it('offers subscribe only with explicit owner absence bound to the same scope', () => {
    const input = { ...upgradeInput(), subscription: { state: 'confirmed-absent' as const, scope: upgradeScope, observedAt, source: 'subscription-owner' as const } };
    expect(subscriptionUpgradeModel(input)).toMatchObject({ state: 'confirmed-absent', action: 'subscribe' });
    expect(subscriptionUpgradeModel({ ...input, access: { ...input.access, companyId: '43' } }).action).toBe('none');
    expect(subscriptionUpgradeModel({ ...input, subscription: { ...input.subscription, observedAt: '' } }).state).toBe('error');
  });

  it.each(['new-business', 'legacy-migrated'] as const)('keeps %s Legacy full access as a present ACTIVE subscription', () => {
    // Registration and migration currently use the same owner facts; provenance
    // is deliberately not guessed from current.source=MIGRATION or plan price.
    const snapshot = upgradeSnapshot();
    snapshot.current.source = 'MIGRATION';
    snapshot.current.plan = upgradePlan({ planCode: 'LEGACY_COMPANY_42', displayName: 'Legacy full access', recurringFee: '0.0000',
      selfServicePolicy: 'DISABLED', includedUsers: null, includedEmployees: null, includedPostedDocuments: null });
    snapshot.current.quote = { currencyCode: 'SAR', baseRecurringFee: '0.0000', optionalRecurringFee: '0.0000', totalRecurringFee: '0.0000' };
    snapshot.effectiveModules[0]!.source = 'GRANDFATHERED';
    const original = structuredClone(snapshot);
    const model = subscriptionUpgradeModel(upgradeInput(snapshot));
    expect(model).toMatchObject({ state: 'present', status: 'ACTIVE', currentPlan: 'Legacy full access', action: 'compare', offers: [] });
    expect(model.notices).toEqual(['zeroBaseFee', 'grandfathered', 'orderingUnavailable']);
    expect(snapshot).toEqual(original);
    expect(JSON.stringify(model)).not.toMatch(/confirmed-absent|BASIC|FREE/u);
  });

  it.each(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'] as const)('preserves server status %s without deriving it from dates', status => {
    const snapshot = upgradeSnapshot(); snapshot.subscription.status = status;
    snapshot.subscription.trialEndsAt = '2020-01-01T00:00:00.000Z';
    const model = subscriptionUpgradeModel(verifiedUpgradeInput(snapshot));
    expect(model.status).toBe(status);
    expect(model.action).toBe(['TRIALING', 'ACTIVE'].includes(status) ? 'compare' : 'review');
    if (!['TRIALING', 'ACTIVE'].includes(status)) expect(model.offers).toEqual([]);
  });

  it('keeps pending/scheduled/cancel-at-period-end separate and suppresses new upgrade invitations', () => {
    const snapshot = upgradeSnapshot();
    snapshot.pending = { ...snapshot.current, state: 'PENDING_APPROVAL' };
    snapshot.scheduled = { ...snapshot.current, effectiveAt: '2026-10-01T00:00:00.000Z' };
    snapshot.subscription.cancelAtPeriodEnd = true;
    expect(subscriptionUpgradeModel(verifiedUpgradeInput(snapshot))).toMatchObject({ status: 'ACTIVE', action: 'review', offers: [],
      notices: ['pendingChange', 'scheduledChange', 'cancellationScheduled'] });
  });

  it.each([[], ['subscriptions.view'], ['subscriptions.manage'], ['pos.checkout']].map(permissions => ({ permissions })))('does not disclose snapshot/billing to permissions $permissions', ({ permissions }) => {
    const input = verifiedUpgradeInput();
    const model = subscriptionUpgradeModel({ ...input, access: { ...input.access, permissions: new Set(permissions) } });
    expect(model).toMatchObject({ state: 'contact-owner', action: 'none', offers: [], notices: [] });
    expect(model.status).toBeUndefined(); expect(model.currentPlan).toBeUndefined();
  });

  it('discards responses captured under a different actor/company and hides without a selected company', () => {
    const input = verifiedUpgradeInput();
    expect(subscriptionUpgradeModel({ ...input, access: { ...input.access, actorId: '99' } }).state).toBe('unavailable');
    expect(subscriptionUpgradeModel({ ...input, access: { ...input.access, companyId: '43' } }).state).toBe('unavailable');
    expect(subscriptionUpgradeModel({ ...input, access: { ...input.access, companyId: null } }).state).toBe('hidden');
    expect(subscriptionUpgradeFromSnapshot(upgradeScope, upgradeSnapshot({ company: { id: '43', code: 'B', name: 'Other', active: true } }), readBatchId)).toEqual({ state: 'error' });
  });

  it('rejects unknown server statuses and detaches successful reads from later caller mutation', () => {
    const snapshot = upgradeSnapshot(); const read = subscriptionUpgradeFromSnapshot(upgradeScope, snapshot, readBatchId);
    snapshot.current.plan.displayName = 'Changed after read';
    expect(subscriptionUpgradeModel({ ...upgradeInput(), subscription: read }).currentPlan).toBe('Current test plan');
    const malformed = upgradeSnapshot(); Object.assign(malformed.subscription, { status: 'BASIC' });
    expect(subscriptionUpgradeModel(upgradeInput(malformed)).state).toBe('error');
  });

  it('fails safely on null plan/module/effectiveModule and malformed pending change JSON', () => {
    for (const patch of [
      { effectiveModules: [null] }, { pending: {} },
      { current: { ...upgradeSnapshot().current, plan: { ...upgradePlan(), modules: [null] } } },
      { current: { ...upgradeSnapshot().current, plan: { ...upgradePlan(), displayName: {} } } },
    ]) {
      const snapshot = Object.assign(upgradeSnapshot(), patch);
      expect(subscriptionUpgradeModel(upgradeInput(snapshot)).state).toBe('error');
    }
    expect(subscriptionUpgradeFromCatalog(upgradeScope, {
      plans: [null], meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
    } as unknown as Parameters<typeof subscriptionUpgradeFromCatalog>[1], observedAt, readBatchId)).toEqual({ state: 'error' });
  });
});

describe('S1 catalog and upgrade relationship', () => {
  it('never infers a higher/basic plan from name, price, code, version number or catalog order', () => {
    const current = upgradeSnapshot(); current.current.plan.planCode = 'BASIC'; current.current.plan.displayName = 'Basic';
    const candidate = upgradePlan({ id: '202', displayName: 'Premium', recurringFee: '9999999999999.0000', includedUsers: 100, versionNumber: 999 });
    const model = subscriptionUpgradeModel(upgradeInput(current, [candidate]));
    expect(model.action).toBe('compare'); expect(model.offers).toEqual([]); expect(model.notices).toContain('orderingUnavailable');
  });

  it('requires owner relations for the exact current subscription snapshot and target version', () => {
    const input = verifiedUpgradeInput();
    expect(subscriptionUpgradeModel(input).offers.map(offer => offer.planVersionId)).toEqual(['202']);
    if (input.relationships?.state !== 'verified') throw new Error('test setup');
    for (const patch of [{ fromPlanVersionId: 'unknown' }, { subscriptionVersion: 2 }, { readBatchId: 'older-load' }, { snapshotGeneratedAt: '2026-08-30T12:00:00.000Z' }, { scope: { ...upgradeScope, actorId: '8' } }]) {
      expect(subscriptionUpgradeModel({ ...input, relationships: { ...input.relationships, ...patch } }).offers).toEqual([]);
    }
    expect(subscriptionUpgradeModel({ ...input, relationships: { ...input.relationships, targetPlanVersionIds: ['404'] } }).notices).toContain('noVerifiedUpgrade');
  });

  it('rejects a stale catalog from another read batch even when actor/company and relation match', () => {
    const input = verifiedUpgradeInput();
    if (input.catalog.state !== 'ready') throw new Error('test setup');
    const model = subscriptionUpgradeModel({ ...input, catalog: { ...input.catalog, readBatchId: 'older-load', observedAt: '2026-08-01T00:00:00.000Z' } });
    expect(model).toMatchObject({ state: 'present', action: 'compare', offers: [] });
    expect(model.notices).toContain('catalogUnavailable');
  });

  it('does not replace a related plan missing from the page or call a partial catalog complete', () => {
    const input = verifiedUpgradeInput();
    const page = { plans: [upgradePlan({ id: '999', includedUsers: 99 })], meta: { page: 1, pageSize: 1, total: 2, totalPages: 2 } };
    const model = subscriptionUpgradeModel({ ...input, catalog: subscriptionUpgradeFromCatalog(upgradeScope, page, observedAt, readBatchId) });
    expect(model.offers).toEqual([]); expect(model.notices).toEqual(['catalogPartial', 'noVerifiedUpgrade']);
    const secondPage = { plans: [upgradePlan({ id: '202', includedUsers: 5 })], meta: { ...page.meta, page: 2 } };
    expect(subscriptionUpgradeModel({ ...input, catalog: subscriptionUpgradeFromCatalog(upgradeScope, secondPage, observedAt, readBatchId) }).offers).toHaveLength(1);
  });

  it.each(['loading', 'unavailable', 'error'] as const)('keeps the current subscription when catalog is %s', state => {
    const model = subscriptionUpgradeModel({ ...verifiedUpgradeInput(), catalog: { state } });
    expect(model.state).toBe('present'); expect(model.action).toBe('compare'); expect(model.offers).toEqual([]);
  });

  it('distinguishes empty, malformed, cross-company and duplicate catalog results', () => {
    expect(subscriptionUpgradeModel(upgradeInput(upgradeSnapshot(), [])).notices).toContain('catalogEmpty');
    const input = verifiedUpgradeInput();
    if (input.catalog.state !== 'ready') throw new Error('test setup');
    expect(subscriptionUpgradeModel({ ...input, catalog: { ...input.catalog, scope: { ...upgradeScope, companyId: '43' } } }).notices).toContain('catalogUnavailable');
    expect(subscriptionUpgradeFromCatalog(upgradeScope, { plans: [], meta: { page: 1, pageSize: 1, total: 2, totalPages: 2 } }, observedAt, readBatchId)).toEqual({ state: 'error' });
    expect(subscriptionUpgradeModel(verifiedUpgradeInput(upgradeSnapshot(), [upgradePlan({ id: '202' }), upgradePlan({ id: '202' })])).notices).toContain('catalogError');
  });

  it.each([
    { publicationStatus: 'DRAFT' as const }, { retiredAt: observedAt }, { selfServicePolicy: 'DISABLED' as const },
    { publishedAt: null }, { publishedAt: 'invalid' }, { publishedAt: '2099-01-01T00:00:00.000Z' },
    { effectiveFrom: '2099-01-01T00:00:00.000Z' }, { recurringFee: null }, { includedUsers: Number.NaN },
  ])('does not offer unavailable plan %j', patch => {
    expect(subscriptionUpgradeModel(verifiedUpgradeInput(upgradeSnapshot(), [upgradePlan({ id: '202', includedUsers: 5, ...patch })])).offers).toEqual([]);
  });

  it('requires a documented gain even with an owner relationship; includes reductions and optional changes', () => {
    expect(subscriptionUpgradeModel(verifiedUpgradeInput(upgradeSnapshot(), [upgradePlan({ id: '202' })])).offers).toEqual([]);
    const current = upgradeSnapshot();
    const target = upgradePlan({ id: '202', includedUsers: 5, includedEmployees: 1, modules: [
      { ...upgradePlan().modules[0]!, selectionMode: 'OPTIONAL' },
      { id: '2', code: 'SALES', displayName: 'Sales', active: true, selectionMode: 'INCLUDED', additionalRecurringFee: null, dependencyIds: [] },
      { id: '3', code: 'CRM', displayName: 'Not ready', active: false, selectionMode: 'OPTIONAL', additionalRecurringFee: null, dependencyIds: [] },
    ] });
    const differences = subscriptionUpgradeModel(verifiedUpgradeInput(current, [target])).offers[0]!.differences;
    expect(differences).toContainEqual({ kind: 'quota', metric: 'includedEmployees', current: 2, target: 1 });
    expect(differences).toContainEqual({ kind: 'optional-module', code: 'CORE_ACCOUNTING', displayName: 'Accounting' });
    expect(differences).toContainEqual({ kind: 'included-module', code: 'SALES', displayName: 'Sales' });
    expect(JSON.stringify(differences)).not.toContain('Not ready');
  });

  it('does not advertise inactive, missing-dependency or cyclic included modules', () => {
    for (const patch of [{ active: false }, { dependencyIds: ['404'] }, { dependencyIds: ['1'] }]) {
      const plan = upgradePlan({ id: '202', includedUsers: 5, modules: [{ ...upgradePlan().modules[0]!, ...patch }] });
      expect(subscriptionUpgradeModel(verifiedUpgradeInput(upgradeSnapshot(), [plan])).offers).toEqual([]);
    }
  });

  it('does not promise an included feature that needs an optional module purchase', () => {
    const plan = upgradePlan({ id: '202', includedUsers: 5, modules: [
      { ...upgradePlan().modules[0]!, selectionMode: 'OPTIONAL' },
      { id: '2', code: 'SALES', displayName: 'Sales', active: true, selectionMode: 'INCLUDED', additionalRecurringFee: null, dependencyIds: ['1'] },
    ] });
    expect(subscriptionUpgradeModel(verifiedUpgradeInput(upgradeSnapshot(), [plan])).offers).toEqual([]);
  });

  it('does not count unknown quotas as unlimited or compare document quotas across billing cycles', () => {
    const current = upgradePlan({ includedUsers: null, includedPostedDocuments: null });
    const target = upgradePlan({ id: '202', includedUsers: 5, includedPostedDocuments: 900, billingCycle: 'ANNUAL' });
    expect(subscriptionUpgradeDifferences(current, target, [])).toContainEqual({ kind: 'quota', metric: 'includedUsers', current: null, target: 5 });
    expect(subscriptionUpgradeDifferences(current, target, []).some(difference => difference.kind === 'quota' && difference.metric === 'includedPostedDocuments')).toBe(false);
    const snapshot = upgradeSnapshot(); snapshot.current.plan = upgradePlan({ includedUsers: null });
    expect(subscriptionUpgradeModel(verifiedUpgradeInput(snapshot, [upgradePlan({ id: '202', includedUsers: 5 })])).offers).toEqual([]);
  });
});

describe('S1 explicit navigation and quiet dismissal', () => {
  it('performs no action until invoked and carries the exact plan/version to review', () => {
    const navigation = { openCatalog: vi.fn(), openSubscription: vi.fn(), reviewUpgrade: vi.fn() };
    const input = verifiedUpgradeInput(); subscriptionUpgradeModel(input);
    expect(navigation.reviewUpgrade).not.toHaveBeenCalled();
    expect(activateSubscriptionUpgrade(input, navigation, { planVersionId: '202' })).toBe(true);
    expect(navigation.reviewUpgrade).toHaveBeenCalledExactlyOnceWith({ targetPlanVersionId: '202', subscriptionVersion: 3 });
    expect(activateSubscriptionUpgrade(input, navigation, { planVersionId: '404' })).toBe(false);
    const permissions = input.access.permissions as Set<string>; permissions.delete('subscriptions.manage');
    expect(activateSubscriptionUpgrade(input, navigation, { planVersionId: '202' })).toBe(false);
    expect(navigation.reviewUpgrade).toHaveBeenCalledTimes(1);
  });

  it('keeps neutral browse, confirmed subscribe, and subscription review as distinct manual intents', () => {
    const navigation = { openCatalog: vi.fn(), openSubscription: vi.fn(), reviewUpgrade: vi.fn() };
    activateSubscriptionUpgrade(upgradeInput(), navigation, 'primary');
    expect(navigation.openCatalog).toHaveBeenLastCalledWith('compare');
    activateSubscriptionUpgrade({ ...upgradeInput(), subscription: { state: 'confirmed-absent', scope: upgradeScope, observedAt, source: 'subscription-owner' } }, navigation, 'primary');
    expect(navigation.openCatalog).toHaveBeenLastCalledWith('subscribe');
    const snapshot = upgradeSnapshot(); snapshot.subscription.status = 'SUSPENDED';
    activateSubscriptionUpgrade(upgradeInput(snapshot), navigation, 'primary');
    expect(navigation.openSubscription).toHaveBeenCalledExactlyOnceWith();
  });

  it('remembers dismissal across remounts/refreshes in the same session without leaking to another actor or company', () => {
    const store = createSubscriptionUpgradeDismissals(); const listener = vi.fn(); const unsubscribe = store.subscribe(listener);
    store.dismiss(upgradeScope); store.dismiss(upgradeScope);
    expect(store.isDismissed({ ...upgradeScope })).toBe(true); expect(listener).toHaveBeenCalledTimes(1);
    expect(store.isDismissed({ ...upgradeScope, actorId: '8' })).toBe(false);
    expect(store.isDismissed({ ...upgradeScope, companyId: '43' })).toBe(false);
    unsubscribe(); store.dismiss({ ...upgradeScope, companyId: '43' }); expect(listener).toHaveBeenCalledTimes(1);
    expect(createSubscriptionUpgradeDismissals().isDismissed(upgradeScope)).toBe(false);
  });
});
