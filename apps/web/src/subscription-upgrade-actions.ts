import type { SubscriptionUpgradeInput, SubscriptionUpgradeNavigation } from './subscription-upgrade-contract';
import { subscriptionUpgradeModel } from './subscription-upgrade-policy';

export type SubscriptionUpgradeIntent = 'primary' | { planVersionId: string };

/** Re-evaluate scope, facts, and permission at activation. There is no mount effect,
 * request, retry, or write behind this helper. */
export function activateSubscriptionUpgrade(input: SubscriptionUpgradeInput, navigation: SubscriptionUpgradeNavigation,
  intent: SubscriptionUpgradeIntent): boolean {
  const model = subscriptionUpgradeModel(input);
  if (intent === 'primary') {
    if (model.action === 'subscribe') navigation.openCatalog('subscribe');
    else if (model.action === 'compare') navigation.openCatalog('compare');
    else if (model.action === 'review') navigation.openSubscription();
    else return false;
  } else {
    const offer = model.offers.find(item => item.planVersionId === intent.planVersionId);
    if (!offer) return false;
    navigation.reviewUpgrade({ targetPlanVersionId: offer.planVersionId, subscriptionVersion: offer.subscriptionVersion });
  }
  return true;
}
