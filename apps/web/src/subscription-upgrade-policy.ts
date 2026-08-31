import type { SubscriptionSnapshot } from './types';
import {
  subscriptionUpgradeSameScope, subscriptionUpgradeScopeKey, validSubscriptionUpgradeDate, validSubscriptionUpgradePage,
  type SubscriptionUpgradeInput, type SubscriptionUpgradePlan,
} from './subscription-upgrade-contract';

type Metric = 'includedUsers' | 'includedEmployees' | 'includedPostedDocuments';
export type SubscriptionUpgradeDifference =
  | { kind: 'quota'; metric: Metric; current: number | null; target: number | null }
  | { kind: 'included-module' | 'removed-module' | 'optional-module'; code: string; displayName: string };
export type SubscriptionUpgradeOffer = Readonly<{
  planVersionId: string; displayName: string; subscriptionVersion: number;
  requiresApproval: boolean; differences: readonly SubscriptionUpgradeDifference[];
}>;
type Notice = 'pendingChange' | 'scheduledChange' | 'cancellationScheduled' | 'zeroBaseFee' | 'unknownBaseFee' | 'grandfathered'
  | 'catalogLoading' | 'catalogError' | 'catalogUnavailable' | 'catalogEmpty' | 'catalogPartial' | 'orderingUnavailable' | 'noVerifiedUpgrade';
export type SubscriptionUpgradeModel = Readonly<{
  state: 'hidden' | 'contact-owner' | 'loading' | 'unavailable' | 'error' | 'confirmed-absent' | 'present';
  scopeKey: string | null;
  status?: SubscriptionSnapshot['subscription']['status'];
  currentPlan?: string;
  notices: readonly Notice[];
  action: 'none' | 'subscribe' | 'compare' | 'review';
  offers: readonly SubscriptionUpgradeOffer[];
}>;

const statuses: readonly string[] = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'];
const metrics: readonly Metric[] = ['includedUsers', 'includedEmployees', 'includedPostedDocuments'];
const validQuota = (value: number | null) => value === null || (Number.isSafeInteger(value) && value >= 0);
const zeroMoney = (value: string | null) => typeof value === 'string' && /^0(?:\.0+)?$/u.test(value);
const validMoney = (value: string | null) => value === null || (typeof value === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value));

/** Commercial facts only. No plan order, no financial calculations, no RBAC changes. */
export function subscriptionUpgradeDifferences(current: SubscriptionUpgradePlan, target: SubscriptionUpgradePlan,
  effectiveModules: SubscriptionSnapshot['effectiveModules']): SubscriptionUpgradeDifference[] {
  const result: SubscriptionUpgradeDifference[] = [];
  if (!validPlan(current) || !validPlan(target) || !validEffectiveModules(effectiveModules)) return result;
  for (const metric of metrics) {
    // A document quota across different cycles has no comparable duration.
    if (metric === 'includedPostedDocuments' && current.billingCycle !== target.billingCycle) continue;
    if (validQuota(current[metric]) && validQuota(target[metric]) && current[metric] !== target[metric]) {
      result.push({ kind: 'quota', metric, current: current[metric], target: target[metric] });
    }
  }
  const available = availableModules(target);
  const byCode = new Map(available.map(module => [module.code, module]));
  const effectiveCodes = new Set(effectiveModules.map(module => module.code));
  for (const module of available) {
    if (module.selectionMode === 'INCLUDED' && !effectiveCodes.has(module.code)) {
      result.push({ kind: 'included-module', code: module.code, displayName: module.displayName });
    }
  }
  for (const module of effectiveModules) {
    const next = byCode.get(module.code);
    if (!next) result.push({ kind: 'removed-module', code: module.code, displayName: module.displayName });
    else if (next.selectionMode === 'OPTIONAL') result.push({ kind: 'optional-module', code: module.code, displayName: module.displayName });
  }
  return result;
}

function availableModules(plan: SubscriptionUpgradePlan) {
  const modules = plan.modules;
  const byId = new Map(modules.map(module => [module.id, module]));
  const resolved = new Map<string, boolean>();
  const available = (id: string, visiting: ReadonlySet<string>): boolean => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    const module = byId.get(id);
    if (!module?.active || visiting.has(id)) return false;
    const next = new Set(visiting); next.add(id);
    const valid = module.dependencyIds.every(dependency => available(dependency, next)
      && (module.selectionMode !== 'INCLUDED' || byId.get(dependency)?.selectionMode === 'INCLUDED'));
    resolved.set(id, valid);
    return valid;
  };
  return modules.filter(module => available(module.id, new Set()));
}

function validPlan(plan: SubscriptionUpgradePlan): boolean {
  return Boolean(plan && typeof plan.id === 'string' && plan.id && typeof plan.displayName === 'string' && plan.displayName
    && Array.isArray(plan.modules)
    && metrics.every(metric => validQuota(plan[metric])) && validMoney(plan.recurringFee)
    && ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(plan.billingCycle)
    && plan.modules.every(module => module && typeof module.id === 'string' && typeof module.code === 'string'
      && typeof module.displayName === 'string' && typeof module.active === 'boolean'
      && ['INCLUDED', 'OPTIONAL'].includes(module.selectionMode) && Array.isArray(module.dependencyIds)
      && module.dependencyIds.every(id => typeof id === 'string'))
    && new Set(plan.modules.map(module => module.id)).size === plan.modules.length
    && new Set(plan.modules.map(module => module.code)).size === plan.modules.length
    && plan.modules.every(module => module.id && module.code && module.displayName));
}

function eligiblePlan(plan: SubscriptionUpgradePlan, observedAt: string): boolean {
  if (!validPlan(plan)) return false;
  const available = new Set(availableModules(plan).map(module => module.id));
  return plan.publicationStatus === 'PUBLISHED' && plan.publishedAt !== null && validSubscriptionUpgradeDate(plan.publishedAt)
    && Date.parse(plan.publishedAt) <= Date.parse(observedAt) && plan.retiredAt === null
    && ['REQUEST_ONLY', 'IMMEDIATE_FREE'].includes(plan.selfServicePolicy) && plan.recurringFee !== null
    && validSubscriptionUpgradeDate(plan.effectiveFrom) && Date.parse(plan.effectiveFrom) <= Date.parse(observedAt)
    && plan.modules.filter(module => module.selectionMode === 'INCLUDED').every(module => available.has(module.id));
}

function validEffectiveModules(modules: SubscriptionSnapshot['effectiveModules']): boolean {
  return Array.isArray(modules) && modules.every(module => module && typeof module.id === 'string'
    && typeof module.code === 'string' && typeof module.displayName === 'string'
    && ['PLAN', 'ADD_ON', 'GRANDFATHERED'].includes(module.source));
}

function hasDocumentedGain(differences: readonly SubscriptionUpgradeDifference[]): boolean {
  return differences.some(difference => difference.kind === 'included-module'
    || (difference.kind === 'quota' && difference.current !== null && difference.target !== null && difference.target > difference.current));
}

export function subscriptionUpgradeModel(input: SubscriptionUpgradeInput): SubscriptionUpgradeModel {
  const { access, subscription, catalog, relationships } = input;
  const empty: SubscriptionUpgradeModel = { state: 'hidden', scopeKey: null, notices: [], action: 'none', offers: [] };
  if (!access.companyId || !access.actorId) return empty;
  const base = { ...empty, scopeKey: subscriptionUpgradeScopeKey({ actorId: access.actorId, companyId: access.companyId }) };
  // Do this before touching the supplied snapshot; employees receive no commercial facts.
  if (!access.permissions.has('subscriptions.view') || !access.permissions.has('subscriptions.manage')) {
    return { ...base, state: 'contact-owner' };
  }
  if (subscription.state !== 'ready' && subscription.state !== 'confirmed-absent') {
    return { ...base, state: ['loading', 'unavailable', 'error'].includes(subscription.state) ? subscription.state : 'error' };
  }
  if (!subscriptionUpgradeSameScope(access, subscription.scope)) return { ...base, state: 'unavailable' };
  if (subscription.state === 'confirmed-absent') {
    return subscription.source === 'subscription-owner' && validSubscriptionUpgradeDate(subscription.observedAt)
      ? { ...base, state: 'confirmed-absent', action: 'subscribe' } : { ...base, state: 'error' };
  }
  const snapshot = subscription.snapshot;
  if (!subscription.readBatchId || !snapshot?.subscription || !snapshot.current || !validPlan(snapshot.current.plan)
    || !statuses.includes(snapshot.subscription.status) || !Number.isSafeInteger(snapshot.subscription.version)
    || snapshot.subscription.version < 0 || !validSubscriptionUpgradeDate(snapshot.generatedAt)
    || !validEffectiveModules(snapshot.effectiveModules) || snapshot.current.state !== 'APPROVED'
    || (snapshot.pending !== null && snapshot.pending?.state !== 'PENDING_APPROVAL')
    || (snapshot.scheduled !== null && snapshot.scheduled?.state !== 'APPROVED')
    || typeof snapshot.subscription.cancelAtPeriodEnd !== 'boolean'
    || (snapshot.company && snapshot.company.id !== access.companyId)) return { ...base, state: 'error' };

  const notices: Notice[] = [];
  if (snapshot.pending) notices.push('pendingChange');
  if (snapshot.scheduled) notices.push('scheduledChange');
  if (snapshot.subscription.cancelAtPeriodEnd) notices.push('cancellationScheduled');
  if (snapshot.current.plan.recurringFee === null) notices.push('unknownBaseFee');
  else if (zeroMoney(snapshot.current.plan.recurringFee)) notices.push('zeroBaseFee');
  if (snapshot.effectiveModules.some(module => module.source === 'GRANDFATHERED')) notices.push('grandfathered');
  const present: SubscriptionUpgradeModel = { ...base, state: 'present', status: snapshot.subscription.status,
    currentPlan: snapshot.current.plan.displayName, notices, action: 'compare' };
  // Operational statuses and already-open changes get a management entry, not an upsell.
  if (!['ACTIVE', 'TRIALING'].includes(snapshot.subscription.status) || snapshot.pending || snapshot.scheduled || snapshot.subscription.cancelAtPeriodEnd) {
    return { ...present, action: 'review' };
  }
  if (catalog.state !== 'ready') {
    notices.push(catalog.state === 'loading' ? 'catalogLoading' : catalog.state === 'error' ? 'catalogError' : 'catalogUnavailable');
    return present;
  }
  if (!subscriptionUpgradeSameScope(access, catalog.scope) || !catalog.readBatchId || catalog.readBatchId !== subscription.readBatchId) {
    notices.push('catalogUnavailable'); return present;
  }
  if (!validSubscriptionUpgradeDate(catalog.observedAt) || !validSubscriptionUpgradePage(catalog.catalog)) {
    notices.push('catalogError'); return present;
  }
  if (!catalog.catalog.plans.length) { notices.push('catalogEmpty'); return present; }
  if (catalog.catalog.meta.total > catalog.catalog.plans.length) notices.push('catalogPartial');
  if (!relationships || relationships.state !== 'verified' || relationships.source !== 'subscription-owner'
    || !subscriptionUpgradeSameScope(access, relationships.scope) || relationships.readBatchId !== subscription.readBatchId
    || !Array.isArray(relationships.targetPlanVersionIds) || !relationships.targetPlanVersionIds.every(id => typeof id === 'string')
    || relationships.fromPlanVersionId !== snapshot.current.plan.id || relationships.subscriptionVersion !== snapshot.subscription.version
    || relationships.snapshotGeneratedAt !== snapshot.generatedAt) {
    notices.push('orderingUnavailable'); return present;
  }
  const offers = catalog.catalog.plans.filter(plan => plan.id !== snapshot.current.plan.id
    && relationships.targetPlanVersionIds.includes(plan.id) && eligiblePlan(plan, catalog.observedAt))
    .map(plan => ({ planVersionId: plan.id, displayName: plan.displayName, subscriptionVersion: snapshot.subscription.version,
      requiresApproval: plan.selfServicePolicy === 'REQUEST_ONLY' || !zeroMoney(plan.recurringFee),
      differences: subscriptionUpgradeDifferences(snapshot.current.plan, plan, snapshot.effectiveModules) }))
    .filter(offer => hasDocumentedGain(offer.differences));
  if (!offers.length) notices.push('noVerifiedUpgrade');
  return { ...present, offers };
}
