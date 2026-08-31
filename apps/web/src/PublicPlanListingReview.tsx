import { useEffect, useState } from "react";
import { formatCurrencyDecimal } from "./decimal-format";
import { useI18n } from "./i18n";
import { publicOfferDecimal, publicOfferReadiness } from "./public-offers";
import type { SubscriptionPlanVersion } from "./types";
import { Button } from "./ui";
import "./public-offers-admin.css";

export function PublicPlanListingReview({ plan, busy, onPublicListing }: {
  plan: { active: boolean; code: string; versions: SubscriptionPlanVersion[] };
  busy: boolean;
  onPublicListing: (version: SubscriptionPlanVersion) => Promise<void>;
}) {
  const { t } = useI18n();
  return <section className="public-plan-listing-controls public-offers-review">
    <h3>{t("publicPlans.listingTitle")}</h3><p>{t("publicPlans.listingHint")}</p>
    <ol className="public-offers-steps"><li>{t("publicPlans.operator.prepare")}</li><li>{t("publicPlans.operator.publish")}</li><li>{t("publicPlans.operator.inspect")}</li></ol>
    <a href="/plans" target="_blank" rel="noopener noreferrer">{t("publicPlans.viewPage")}</a>
    {plan.versions.map((version) => <ListingVersion key={`${version.id}-${version.version}`} plan={plan} version={version} busy={busy} onPublicListing={onPublicListing} />)}
  </section>;
}

function ListingVersion({ plan, version, busy, onPublicListing }: {
  plan: { active: boolean; code: string }; version: SubscriptionPlanVersion; busy: boolean;
  onPublicListing: (version: SubscriptionPlanVersion) => Promise<void>;
}) {
  const { t, intlLocale, formatDateTime, formatNumber } = useI18n();
  const [acknowledged, setAcknowledged] = useState(false);
  const [now, setNow] = useState(Date.now);
  // Dates remain informative without requiring a page reload at the boundary.
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(interval); }, []);
  const checks = publicOfferReadiness(plan, version, now);
  const ready = checks.every((check) => check.passed);
  const money = (value: string | null) => value === null ? t("subscription.notConfigured") : formatCurrencyDecimal(value, version.currencyCode, intlLocale, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  const count = (value: number | null) => value === null ? t("subscription.notConfigured") : formatNumber(value);
  return <article className="public-offers-version">
    <h4>{version.displayName} · {t("subscription.versionLabel", { value1: version.versionNumber })}</h4>
    <dl className="public-offers-facts">
      <div><dt>{t("platformSubscriptions.publication")}</dt><dd>{t(`platformSubscriptions.publication.${version.publicationStatus}`)}</dd></div>
      <div><dt>{t("publicPlans.operator.availability")}</dt><dd>{version.retiredAt ? t("publicPlans.operator.retired") : Date.parse(version.effectiveFrom) <= now ? t("publicPlans.operator.effective") : t("publicPlans.operator.future")} · {formatDateTime(version.effectiveFrom)}</dd></div>
      <div><dt>{t("platformSubscriptions.selfService")}</dt><dd>{t(`subscription.policy.${version.selfServicePolicy}`)}</dd></div>
      <div><dt>{t("publicPlans.listingTitle")}</dt><dd>{!version.publiclyListed ? t("publicPlans.operator.hidden") : ready ? t("publicPlans.operator.listed") : t("publicPlans.operator.suspended")}</dd></div>
      <div><dt>{t("subscription.recurringFee")}</dt><dd><bdi>{money(version.recurringFee)}</bdi> · {t(`subscription.cycle.${version.billingCycle}`)}</dd></div>
      <div><dt>{t("subscription.users")}</dt><dd>{count(version.includedUsers)}</dd></div>
      <div><dt>{t("subscription.employees")}</dt><dd>{count(version.includedEmployees)}</dd></div>
      <div><dt>{t("publicPlans.compareDocuments")}</dt><dd>{count(version.includedPostedDocuments)}</dd></div>
    </dl>
    <details className="public-offers-checks public-offers-preview">
      <summary>{t("publicPlans.operator.preview")}</summary>
      <p>{version.description || t("publicPlans.defaultDescription")}</p>
      <dl className="public-offers-facts">
        <div><dt>{t("platformSubscriptions.taxRate")}</dt><dd><bdi>{publicOfferDecimal(version.taxRate)}%</bdi></dd></div>
        <div><dt>{t("platformSubscriptions.trialDays")}</dt><dd>{formatNumber(version.trialDays)}</dd></div>
        <div><dt>{t("publicPlans.additionalUser")}</dt><dd><bdi>{money(version.pricePerAdditionalUser)}</bdi></dd></div>
        <div><dt>{t("publicPlans.additionalEmployee")}</dt><dd><bdi>{money(version.pricePerAdditionalEmployee)}</bdi></dd></div>
        <div><dt>{t("publicPlans.additionalDocument")}</dt><dd><bdi>{money(version.pricePerAdditionalPostedDocument)}</bdi></dd></div>
      </dl>
      <ul>{version.modules.map((module) => <li key={module.id}><strong>{module.displayName}</strong><span>{module.selectionMode === "INCLUDED" ? t("platformSubscriptions.includedModule") : <>{t("platformSubscriptions.optionalModule")} · <bdi>{money(module.additionalRecurringFee)}</bdi></>}</span></li>)}</ul>
      <p>{t("publicPlans.addonsNote")}</p>
    </details>
    <details className="public-offers-checks" open={!ready && !version.publiclyListed}>
      <summary>{t("publicPlans.operator.checklist")}</summary>
      <ul>{checks.map((check) => <li key={check.key} data-passed={check.passed}><strong>{t(check.passed ? "publicPlans.operator.ready" : "publicPlans.operator.actionNeeded")}</strong><span>{t(`publicPlans.check.${check.key}`)}</span></li>)}</ul>
      <p>{t("publicPlans.operator.serverCheck")}</p>
    </details>
    {!version.publiclyListed && <label className="public-offers-ack"><input type="checkbox" checked={acknowledged} disabled={!ready || busy} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{t("publicPlans.operator.acknowledge")}</span></label>}
    <Button variant="secondary" disabled={busy || (!version.publiclyListed && (!ready || !acknowledged))} onClick={() => void onPublicListing(version)}>{version.publiclyListed ? t("publicPlans.hidePublicly") : t("publicPlans.showPublicly")}</Button>
    <p>{t("publicPlans.operator.hideNote")}</p>
  </article>;
}
