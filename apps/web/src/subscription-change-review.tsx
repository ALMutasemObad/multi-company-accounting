import { useI18n } from './i18n';
import type { SubscriptionChangeReview } from './subscription-change-safety';
import './subscription-change-safety.css';

export function SubscriptionChangeReviewDetails({ review }: { review: SubscriptionChangeReview }) {
  const { t } = useI18n();
  const plan = review.plan;
  const money = (value: string | null) => value === null ? t('subscriptionChanges.notConfigured') : <bdi dir="ltr">{value} {plan.currencyCode}</bdi>;
  const optional = plan.modules.filter(module => review.optionalIds.includes(module.id));
  return <section className="subscription-change-review" aria-labelledby="subscription-change-review-title" tabIndex={-1}>
    <h3 id="subscription-change-review-title">{t('subscriptionChanges.reviewTitle')}</h3>
    <dl>
      <div><dt>{t('subscription.plan')}</dt><dd>{plan.displayName} · {plan.planCode} · {t('subscription.versionLabel', { value1: plan.versionNumber })}</dd></div>
      <div><dt>{t('subscriptionChanges.cycle')}</dt><dd>{t(`subscription.cycle.${plan.billingCycle}`)}</dd></div>
      <div><dt>{t('subscriptionChanges.currency')}</dt><dd><bdi>{plan.currencyCode}</bdi></dd></div>
      <div><dt>{t('subscriptionChanges.baseFee')}</dt><dd>{money(plan.recurringFee)}</dd></div>
      <div><dt>{t('subscriptionChanges.userFee')}</dt><dd>{money(plan.pricePerAdditionalUser)}</dd></div>
      <div><dt>{t('subscriptionChanges.employeeFee')}</dt><dd>{money(plan.pricePerAdditionalEmployee)}</dd></div>
      <div><dt>{t('subscriptionChanges.documentFee')}</dt><dd>{money(plan.pricePerAdditionalPostedDocument)}</dd></div>
      <div><dt>{t('subscriptionChanges.taxRate')}</dt><dd><bdi dir="ltr">{plan.taxRate}%</bdi></dd></div>
      <div><dt>{t('subscriptionChanges.taxAmount')}</dt><dd>{t('subscriptionChanges.serverCalculated')}</dd></div>
    </dl>
    <h4>{t('subscription.optionalModules')}</h4>
    {optional.length ? <ul>{optional.map(module => <li key={module.id}><span>{module.displayName}</span><strong>{money(module.additionalRecurringFee)}</strong></li>)}</ul> : <p>{t('subscriptionChanges.noAddons')}</p>}
    <p>{t('subscriptionChanges.priceSafety')}</p>
  </section>;
}
