import type { SubscriptionCatalog, SubscriptionPlanVersion, SubscriptionSnapshot } from './types';

/** Capture this scope when starting the read, never after it completes. */
export type SubscriptionUpgradeScope = Readonly<{ actorId: string; companyId: string }>;
export type SubscriptionUpgradeAccess = Readonly<{
  actorId: string;
  companyId: string | null;
  permissions: ReadonlySet<string>;
}>;
export type SubscriptionUpgradeRead =
  | { state: 'loading' | 'unavailable' | 'error' }
  | { state: 'ready'; scope: SubscriptionUpgradeScope; readBatchId: string; snapshot: SubscriptionSnapshot }
  /** Reserved for explicit owner evidence. A 404/missing row is NOT this fact.
   * The current API has no such successful response and no adapter emits it. */
  | { state: 'confirmed-absent'; scope: SubscriptionUpgradeScope; observedAt: string; source: 'subscription-owner' };

export type SubscriptionUpgradeCatalogRead =
  | { state: 'loading' | 'unavailable' | 'error' }
  | { state: 'ready'; scope: SubscriptionUpgradeScope; readBatchId: string; observedAt: string; catalog: SubscriptionCatalog };

/** Optional owner-provided relationship, not an API or a client tier heuristic.
 * No production adapter currently supplies it. Version + generatedAt bind the
 * relationship to the same snapshot; targets may be on any catalog page. */
export type SubscriptionUpgradeRelationships =
  | { state: 'unavailable' }
  | {
    state: 'verified'; source: 'subscription-owner'; scope: SubscriptionUpgradeScope; readBatchId: string;
    fromPlanVersionId: string; subscriptionVersion: number; snapshotGeneratedAt: string;
    targetPlanVersionIds: readonly string[];
  };

export type SubscriptionUpgradeInput = Readonly<{
  access: SubscriptionUpgradeAccess;
  subscription: SubscriptionUpgradeRead;
  catalog: SubscriptionUpgradeCatalogRead;
  relationships?: SubscriptionUpgradeRelationships;
}>;

/** UI intents only: the host must navigate to the existing explicit review flow.
 * These ports must never POST, auto-select a replacement, collect payment, or
 * grant capabilities. The server revalidates authorization and versions there. */
export type SubscriptionUpgradeNavigation = Readonly<{
  openCatalog: (intent: 'subscribe' | 'compare') => void;
  openSubscription: () => void;
  reviewUpgrade: (selection: Readonly<{ targetPlanVersionId: string; subscriptionVersion: number }>) => void;
}>;

export function subscriptionUpgradeScopeKey(scope: SubscriptionUpgradeScope): string {
  return JSON.stringify([scope.actorId, scope.companyId]);
}

export function subscriptionUpgradeSameScope(access: SubscriptionUpgradeAccess, scope: SubscriptionUpgradeScope): boolean {
  return Boolean(access.companyId && access.actorId && scope && access.actorId === scope.actorId && access.companyId === scope.companyId);
}

/** Use only on a successful /subscription read. The owner endpoint omits company;
 * the request's captured scope must therefore be retained by the host. Generate
 * a new readBatchId per combined snapshot/catalog load, never reuse an old one. */
export function subscriptionUpgradeFromSnapshot(scope: SubscriptionUpgradeScope, snapshot: SubscriptionSnapshot, readBatchId: string): SubscriptionUpgradeRead {
  if (!scope.actorId || !scope.companyId || !readBatchId || !snapshot?.subscription || !snapshot.current?.plan
    || !Array.isArray(snapshot.effectiveModules) || !validSubscriptionUpgradeDate(snapshot.generatedAt)
    || (snapshot.company && snapshot.company.id !== scope.companyId)) return { state: 'error' };
  return { state: 'ready', scope: { ...scope }, readBatchId, snapshot: structuredClone(snapshot) };
}

export function subscriptionUpgradeFromCatalog(scope: SubscriptionUpgradeScope, catalog: SubscriptionCatalog, observedAt: string, readBatchId: string): SubscriptionUpgradeCatalogRead {
  if (!scope.actorId || !scope.companyId || !readBatchId || !validSubscriptionUpgradeDate(observedAt)
    || !Array.isArray(catalog?.plans) || !validSubscriptionUpgradePage(catalog)) return { state: 'error' };
  return { state: 'ready', scope: { ...scope }, readBatchId, observedAt, catalog: structuredClone(catalog) };
}

export function validSubscriptionUpgradeDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function validSubscriptionUpgradePage(catalog: SubscriptionCatalog): boolean {
  const meta = catalog?.meta;
  return Boolean(meta && Array.isArray(catalog.plans) && catalog.plans.every(plan => plan && typeof plan.id === 'string')
    && [meta.page, meta.pageSize, meta.total, meta.totalPages].every(Number.isSafeInteger)
    && meta.page >= 1 && meta.pageSize >= 1 && meta.total >= 0
    && meta.totalPages === Math.ceil(meta.total / meta.pageSize)
    && catalog.plans.length <= meta.pageSize && catalog.plans.length <= meta.total
    && (meta.total === 0 ? meta.page === 1 && catalog.plans.length === 0
      : meta.page <= meta.totalPages && catalog.plans.length === Math.min(meta.pageSize, meta.total - (meta.page - 1) * meta.pageSize))
    && new Set(catalog.plans.map(plan => plan.id)).size === catalog.plans.length);
}

export type SubscriptionUpgradePlan = SubscriptionPlanVersion;
