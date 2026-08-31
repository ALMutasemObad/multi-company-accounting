import { useId } from 'react';
import { localeRegistry, type Locale } from './i18n/locales/registry';
import { subscriptionUpgradeCopy } from './i18n/locales/subscription-upgrade';
import type { SubscriptionUpgradeInput, SubscriptionUpgradeNavigation } from './subscription-upgrade-contract';
import { activateSubscriptionUpgrade } from './subscription-upgrade-actions';
import { subscriptionUpgradeModel, type SubscriptionUpgradeOffer } from './subscription-upgrade-policy';
import './subscription-upgrade.css';

export type SubscriptionUpgradeProps = {
  input: SubscriptionUpgradeInput; locale: Locale; navigation: SubscriptionUpgradeNavigation;
};

export function SubscriptionUpgradeCard({ input, locale, navigation }: SubscriptionUpgradeProps) {
  const heading = useId();
  const copy = subscriptionUpgradeCopy(locale);
  const model = subscriptionUpgradeModel(input);
  if (model.state === 'hidden') return null;
  const description = model.state === 'contact-owner' ? copy.contactOwner
    : model.state === 'confirmed-absent' ? copy.confirmedAbsent
      : model.state === 'present' ? copy.description : copy[model.state];
  return <section className="subscription-upgrade-card" dir={localeRegistry[locale].dir} lang={locale} aria-labelledby={heading}>
    <h2 id={heading}>{copy.title}</h2>
    <p>{description}</p>
    {model.state === 'present' && <dl className="subscription-upgrade-current">
      <div><dt>{copy.currentPlan}</dt><dd><bdi>{model.currentPlan}</bdi></dd></div>
      <div><dt>{copy.statusLabel}</dt><dd>{copy[`status.${model.status!}`]}</dd></div>
    </dl>}
    {model.notices.length > 0 && <ul className="subscription-upgrade-notices">{model.notices.map(notice => <li key={notice}>{copy[notice]}</li>)}</ul>}
    {model.offers.map(offer => <SubscriptionUpgradeComparison key={offer.planVersionId} offer={offer} locale={locale}
      onReview={() => { activateSubscriptionUpgrade(input, navigation, { planVersionId: offer.planVersionId }); }} />)}
    {model.action !== 'none' && <div className="subscription-upgrade-actions">
      <button type="button" className="subscription-upgrade-button" onClick={() => { activateSubscriptionUpgrade(input, navigation, 'primary'); }}>
        {model.action === 'subscribe' ? copy.subscribe : model.action === 'review' ? copy.reviewSubscription : copy.viewPlans}
      </button>
      <p>{copy.notAutomatic}</p>
    </div>}
  </section>;
}

function SubscriptionUpgradeComparison({ offer, locale, onReview }: { offer: SubscriptionUpgradeOffer; locale: Locale; onReview: () => void }) {
  const copy = subscriptionUpgradeCopy(locale);
  const heading = useId();
  const quotas = offer.differences.filter(difference => difference.kind === 'quota');
  const modules = offer.differences.filter(difference => difference.kind !== 'quota');
  return <section className="subscription-upgrade-comparison" aria-labelledby={heading}>
    <h3 id={heading}><bdi>{offer.displayName}</bdi></h3>
    {quotas.length > 0 && <div className="subscription-upgrade-table-wrap" role="region" tabIndex={0} aria-label={copy.documentedDifferences}><table>
      <caption>{copy.documentedDifferences}</caption>
      <thead><tr><th scope="col">{copy.documentedDifferences}</th><th scope="col">{copy.currentValue}</th><th scope="col">{copy.targetValue}</th></tr></thead>
      <tbody>{quotas.map(difference => <tr key={difference.metric}>
        <th scope="row">{copy[`metric.${difference.metric}`]}</th>
        <td>{difference.current ?? copy.unavailableValue}</td><td>{difference.target ?? copy.unavailableValue}</td>
      </tr>)}</tbody>
    </table></div>}
    {modules.length > 0 && <ul>{modules.map(difference => <li key={`${difference.kind}:${difference.code}`}>
      <span>{difference.kind === 'included-module' ? copy.includedModule : difference.kind === 'removed-module' ? copy.removedModule : copy.optionalModule}</span>{' '}
      <bdi>{difference.displayName}</bdi>
    </li>)}</ul>}
    <p>{copy.comparisonCaveat}</p>
    <p>{offer.requiresApproval ? copy.requestApproval : copy.manualReview}</p>
    <button type="button" className="subscription-upgrade-button" onClick={onReview}>{copy.compareUpgrade}: <bdi>{offer.displayName}</bdi></button>
  </section>;
}
