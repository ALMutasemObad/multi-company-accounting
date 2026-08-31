import { subscriptionUpgradeScopeKey, type SubscriptionUpgradeScope } from './subscription-upgrade-contract';

/** Create once per signed-in application session and dispose at sign-out. Only
 * actor/company keys are retained in memory, never a snapshot or billing data. */
export function createSubscriptionUpgradeDismissals() {
  const dismissed = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    isDismissed: (scope: SubscriptionUpgradeScope) => dismissed.has(subscriptionUpgradeScopeKey(scope)),
    dismiss(scope: SubscriptionUpgradeScope) {
      const key = subscriptionUpgradeScopeKey(scope);
      if (dismissed.has(key)) return;
      dismissed.add(key);
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
export type SubscriptionUpgradeDismissals = ReturnType<typeof createSubscriptionUpgradeDismissals>;
