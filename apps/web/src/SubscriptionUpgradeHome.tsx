import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuthorization } from './authorization-context';
import { useI18n } from './i18n';
import { SubscriptionUpgradeBanner } from './SubscriptionUpgradeBanner';
import { subscriptionUpgradeFromSnapshot, type SubscriptionUpgradeAccess, type SubscriptionUpgradeRead } from './subscription-upgrade-contract';
import type { SubscriptionUpgradeDismissals } from './subscription-upgrade-dismissal';
import type { SubscriptionSnapshot } from './types';

type Props = { dismissals: SubscriptionUpgradeDismissals; onOpenSubscription: () => void };

export function SubscriptionUpgradeHome(props: Props) {
  const { user, selectedCompany, permissionSet, modules } = useAuthorization();
  if (!selectedCompany) return null;
  const key = JSON.stringify([user.id, selectedCompany.id, [...permissionSet].sort(), [...modules].sort()]);
  return <SubscriptionUpgradeHomeBody key={key} {...props}
    access={{ actorId: user.id, companyId: selectedCompany.id, permissions: permissionSet }} />;
}

function SubscriptionUpgradeHomeBody({ access, dismissals, onOpenSubscription }: Props & { access: SubscriptionUpgradeAccess }) {
  const { locale } = useI18n();
  const [subscription, setSubscription] = useState<SubscriptionUpgradeRead>({ state: 'loading' });
  const permitted = access.permissions.has('subscriptions.view') && access.permissions.has('subscriptions.manage');
  const actorId = access.actorId;
  const companyId = access.companyId!;
  useEffect(() => {
    // An employee's generic guidance must not trigger commercial reads.
    if (!permitted || dismissals.isDismissed({ actorId, companyId })) return;
    const controller = new AbortController();
    const readBatchId = crypto.randomUUID();
    void api<SubscriptionSnapshot>('/subscription?page=1&pageSize=1', { signal: controller.signal, timeoutMs: 10_000 })
      .then(snapshot => {
        if (!controller.signal.aborted) setSubscription(subscriptionUpgradeFromSnapshot({ actorId, companyId }, snapshot, readBatchId));
      })
      .catch(() => { if (!controller.signal.aborted) setSubscription({ state: 'error' }); });
    return () => controller.abort();
  }, [actorId, companyId, permitted, dismissals]);

  return <SubscriptionUpgradeBanner locale={locale} dismissals={dismissals}
    input={{ access, subscription, catalog: { state: 'unavailable' }, relationships: { state: 'unavailable' } }}
    navigation={{
      // Existing authenticated catalog/review, not a purchase or full-page reload.
      openCatalog: onOpenSubscription,
      openSubscription: onOpenSubscription,
      reviewUpgrade: onOpenSubscription,
    }} />;
}
