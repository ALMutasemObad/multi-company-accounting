import { formatCurrencyDecimal } from "./decimal-format";
import { useI18n } from "./i18n";
import { comparedModuleCodes } from "./public-offers";
import type { PublicSubscriptionCatalog } from "./public-plans";

export function PlansDiscoveryFeatures({ catalog }: { catalog: PublicSubscriptionCatalog }) {
  const { t, formatNumber, intlLocale } = useI18n();
  return <section className="plans-features" aria-labelledby="plans-features-title">
    <h2 id="plans-features-title">{t("publicPlans.featuresTitle")}</h2>
    <p id="plans-features-scope">{t("publicPlans.featuresScope", { page: catalog.meta.page, count: catalog.plans.length })}</p>
    <p id="plans-features-terms">{t("publicPlans.featuresCaption")}</p>
    <p id="plans-features-help">{t("publicPlans.compareHelp")}</p>
    <div className="plans-features-scroll" role="region" tabIndex={0} aria-labelledby="plans-features-title" aria-describedby="plans-features-scope plans-features-terms plans-features-help">
      <table><caption className="sr-only">{t("publicPlans.featuresTitle")}</caption>
        <thead><tr><th scope="col">{t("publicPlans.compareFeature")}</th>{catalog.plans.map((plan) => <th scope="col" key={plan.id}>{plan.displayName}<span>{t(`publicPlans.cycle.${plan.billingCycle}`)}</span></th>)}</tr></thead>
        <tbody>
          {(["includedUsers", "includedEmployees", "includedPostedDocuments"] as const).map((field, index) => <tr key={field}>
            <th scope="row">{t((["publicPlans.featureUsers", "publicPlans.featureEmployees", "publicPlans.compareDocuments"] as const)[index]!)}</th>
            {catalog.plans.map((plan) => <td key={plan.id}>{formatNumber(plan[field])}</td>)}
          </tr>)}
          {comparedModuleCodes(catalog.plans).map((code) => <tr key={code}>
            <th scope="row">{catalog.plans.flatMap((plan) => plan.modules).find((module) => module.code === code)!.displayName}</th>
            {catalog.plans.map((plan) => {
              const module = plan.modules.find((item) => item.code === code);
              return <td key={plan.id}>{!module ? t("publicPlans.notOffered") : module.selectionMode === "INCLUDED" ? t("publicPlans.featureIncluded") : <>{t("publicPlans.featureOptional")}<span><bdi>{module.additionalRecurringFee === null ? t("publicPlans.featureUnconfigured") : formatCurrencyDecimal(module.additionalRecurringFee, plan.currencyCode, intlLocale, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}</bdi></span></>}</td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}
