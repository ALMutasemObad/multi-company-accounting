import type { SubscriptionPlanVersion, SubscriptionSnapshot } from './types';
import { subscriptionUpgradeFromCatalog, subscriptionUpgradeFromSnapshot, type SubscriptionUpgradeInput } from './subscription-upgrade-contract';

// Test-only fixtures. None are imported by production components/adapters.
export const upgradeScope = { actorId: '7', companyId: '42' };
export const observedAt = '2026-08-31T12:00:00.000Z';
export const readBatchId = 'test-read-batch-1';
export function upgradePlan(overrides: Partial<SubscriptionPlanVersion> = {}): SubscriptionPlanVersion {
  return { id: '101', planId: '10', planCode: 'TEST_CURRENT', versionNumber: 1, displayName: 'Current test plan',
    description: null, billingCycle: 'MONTHLY', currencyCode: 'SAR', recurringFee: '10.0000',
    includedUsers: 2, includedEmployees: 2, includedPostedDocuments: 100,
    pricePerAdditionalUser: null, pricePerAdditionalEmployee: null, pricePerAdditionalPostedDocument: null,
    taxRate: '0.0000', paymentTermsDays: 0, trialDays: 0, effectiveFrom: '2026-08-01T00:00:00.000Z',
    selfServicePolicy: 'REQUEST_ONLY', publicationStatus: 'PUBLISHED', publishedAt: '2026-08-01T00:00:00.000Z', retiredAt: null,
    version: 1, modules: [{ id: '1', code: 'CORE_ACCOUNTING', displayName: 'Accounting', active: true,
      selectionMode: 'INCLUDED', additionalRecurringFee: null, dependencyIds: [] }], ...overrides };
}
export function upgradeSnapshot(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  const plan = upgradePlan();
  return { subscription: { status: 'ACTIVE', version: 3, startsAt: observedAt, trialEndsAt: null,
    currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    current: { id: '8', state: 'APPROVED', source: 'COMPANY_OWNER', requestedAt: observedAt,
      effectiveAt: observedAt, decidedAt: observedAt, decisionReason: null,
      quote: { currencyCode: 'SAR', baseRecurringFee: '10.0000', optionalRecurringFee: '0.0000', totalRecurringFee: '10.0000' },
      plan, modules: [{ id: '1', code: 'CORE_ACCOUNTING', displayName: 'Accounting', selectionMode: 'INCLUDED' }] },
    effectiveModules: [{ id: '1', code: 'CORE_ACCOUNTING', displayName: 'Accounting', source: 'PLAN' }],
    scheduled: null, pending: null, history: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    generatedAt: observedAt, ...overrides };
}
export function upgradeInput(snapshot = upgradeSnapshot(), plans = [upgradePlan({ id: '202', planId: '20', displayName: 'Candidate test plan', includedUsers: 5 })]): SubscriptionUpgradeInput {
  return { access: { ...upgradeScope, permissions: new Set(['subscriptions.view', 'subscriptions.manage']) },
    subscription: subscriptionUpgradeFromSnapshot(upgradeScope, snapshot, readBatchId),
    catalog: subscriptionUpgradeFromCatalog(upgradeScope, { plans, meta: { page: 1, pageSize: 100, total: plans.length, totalPages: plans.length ? 1 : 0 } }, observedAt, readBatchId),
    relationships: { state: 'unavailable' } };
}
export function verifiedUpgradeInput(snapshot = upgradeSnapshot(), plans?: SubscriptionPlanVersion[]): SubscriptionUpgradeInput {
  return { ...upgradeInput(snapshot, plans), relationships: { state: 'verified', source: 'subscription-owner', scope: upgradeScope, readBatchId,
    fromPlanVersionId: snapshot.current.plan.id, subscriptionVersion: snapshot.subscription.version, snapshotGeneratedAt: snapshot.generatedAt,
    targetPlanVersionIds: ['202'] } };
}
