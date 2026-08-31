import { useId, useSyncExternalStore } from 'react';
import { localeRegistry } from './i18n/locales/registry';
import { subscriptionUpgradeCopy } from './i18n/locales/subscription-upgrade';
import { activateSubscriptionUpgrade } from './subscription-upgrade-actions';
import { subscriptionUpgradeModel } from './subscription-upgrade-policy';
import type { SubscriptionUpgradeDismissals } from './subscription-upgrade-dismissal';
import type { SubscriptionUpgradeProps } from './SubscriptionUpgradeCard';
import './subscription-upgrade.css';

/** Optional home-page placement only. No modal, timer, focus stealing, or POS hook.
 * Supply the same dismissal store across remounts in a signed-in session. */
export function SubscriptionUpgradeBanner({ input, locale, navigation, dismissals }: SubscriptionUpgradeProps & { dismissals: SubscriptionUpgradeDismissals }) {
  const heading = useId();
  const scope = { actorId: input.access.actorId, companyId: input.access.companyId ?? '' };
  const dismissed = useSyncExternalStore(dismissals.subscribe, () => dismissals.isDismissed(scope), () => dismissals.isDismissed(scope));
  const model = subscriptionUpgradeModel(input);
  if (dismissed || ['hidden', 'loading', 'unavailable', 'error'].includes(model.state)) return null;
  const copy = subscriptionUpgradeCopy(locale);
  return <aside className="subscription-upgrade-banner" dir={localeRegistry[locale].dir} lang={locale} aria-labelledby={heading}>
    <div className="subscription-upgrade-banner-content">
      <h2 id={heading}>{copy.title}</h2>
      <p>{model.state === 'contact-owner' ? copy.contactOwner : model.state === 'confirmed-absent' ? copy.confirmedAbsent : copy.description}</p>
    </div>
    <div className="subscription-upgrade-banner-actions">
      {model.action !== 'none' && <button type="button" className="subscription-upgrade-button" onClick={() => { activateSubscriptionUpgrade(input, navigation, 'primary'); }}>
        {model.action === 'subscribe' ? copy.subscribe : model.action === 'review' ? copy.reviewSubscription : copy.viewPlans}
      </button>}
      <button type="button" className="subscription-upgrade-dismiss" onClick={() => dismissals.dismiss(scope)}>{copy.dismiss}</button>
    </div>
  </aside>;
}
