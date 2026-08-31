import { subscriptionPlanForRoute, subscriptionRouteBase } from './public-plans';

export type SubscriptionRouteIntent = Readonly<{ key: string; planId: string | null }>;

/** Observe only explicit subscription-page URL intent. Removing the parameter
 * clears the choice; a stale storage preference must not undo Back/Forward.
 * Eligibility still comes exclusively from the authenticated catalog page. */
export function subscriptionRouteIntent(hash: string): SubscriptionRouteIntent | null {
  if (subscriptionRouteBase(hash) !== '#subscription') return null;
  const queryStart = hash.indexOf('?');
  const values = new URLSearchParams(queryStart < 0 ? '' : hash.slice(queryStart + 1)).getAll('plan');
  return {
    key: JSON.stringify(values),
    planId: values.length ? subscriptionPlanForRoute(hash) : null,
  };
}

/** Remove only plan parameters, leaving other routes and unrelated query values intact. */
export function withoutSubscriptionPlanIntent(hash: string): string {
  if (subscriptionRouteBase(hash) !== '#subscription') return hash;
  const queryStart = hash.indexOf('?');
  if (queryStart < 0) return hash;
  const query = new URLSearchParams(hash.slice(queryStart + 1));
  if (!query.has('plan')) return hash;
  query.delete('plan');
  const remaining = query.toString();
  return `#subscription${remaining ? `?${remaining}` : ''}`;
}
