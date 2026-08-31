import { useState, type ReactNode } from "react";
import { formatCurrencyDecimal } from "./decimal-format";
import { useI18n } from "./i18n";
import { comparedModuleCodes, publicOfferDecimal } from "./public-offers";
import type { PublicSubscriptionCatalog, PublicSubscriptionPlan } from "./public-plans";

export function PublicPlansComparison({ catalog }: { catalog: PublicSubscriptionCatalog }) {
  const { t, formatNumber, intlLocale } = useI18n();
  const [leftId, setLeftId] = useState(catalog.plans[0]?.id ?? "");
  const [rightId, setRightId] = useState(catalog.plans[1]?.id ?? "");
  const selected = [leftId, rightId].flatMap((id) => catalog.plans.find((plan) => plan.id === id) ?? []);
  const money = (plan: PublicSubscriptionPlan, value: string | null) => value === null
    ? t("subscription.notConfigured") : formatCurrencyDecimal(value, plan.currencyCode, intlLocale, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  const allowance = (value: number | null) => value === null ? t("subscription.notConfigured") : formatNumber(value);
  const row = (label: string, value: (plan: PublicSubscriptionPlan) => ReactNode, key = label) =>
    <tr key={key}><th scope="row">{label}</th>{selected.map((plan) => <td key={plan.id}>{value(plan)}</td>)}</tr>;
  return <details className="plans-comparison">
    <summary>{t("publicPlans.compareTitle")}</summary>
    <p id="plans-compare-scope">{t("publicPlans.compareScope", { page: catalog.meta.page, count: catalog.plans.length })}</p>
    <div className="plans-compare-selectors">{(["left", "right"] as const).map((side) => <label key={side}>
      <span>{t(`publicPlans.compare.${side}`)}</span><select value={side === "left" ? leftId : rightId} onChange={(event) => side === "left" ? setLeftId(event.target.value) : setRightId(event.target.value)}>
        {catalog.plans.map((plan) => <option key={plan.id} value={plan.id} disabled={plan.id === (side === "left" ? rightId : leftId)}>{plan.displayName}</option>)}
      </select>
    </label>)}</div>
    <p id="plans-compare-help">{t("publicPlans.compareHelp")}</p>
    <div className="plans-comparison-scroll" role="region" tabIndex={0} aria-label={t("publicPlans.compareTitle")} aria-describedby="plans-compare-scope plans-compare-help">
      <table><caption>{t("publicPlans.compareCaption")}</caption><thead><tr><th scope="col">{t("publicPlans.compareFeature")}</th>{selected.map((plan) => <th scope="col" key={plan.id}>{plan.displayName}</th>)}</tr></thead><tbody>
        {row(t("subscription.recurringFee"), (plan) => <bdi>{money(plan, plan.recurringFee)}</bdi>)}
        {row(t("platformSubscriptions.billingCycle"), (plan) => t(`subscription.cycle.${plan.billingCycle}`))}
        {row(t("platformSubscriptions.taxRate"), (plan) => <bdi>{publicOfferDecimal(plan.taxRate)}%</bdi>)}
        {row(t("subscription.users"), (plan) => allowance(plan.includedUsers))}
        {row(t("subscription.employees"), (plan) => allowance(plan.includedEmployees))}
        {row(t("publicPlans.compareDocuments"), (plan) => allowance(plan.includedPostedDocuments))}
        {row(t("publicPlans.additionalUser"), (plan) => <bdi>{money(plan, plan.pricePerAdditionalUser)}</bdi>)}
        {row(t("publicPlans.additionalEmployee"), (plan) => <bdi>{money(plan, plan.pricePerAdditionalEmployee)}</bdi>)}
        {row(t("publicPlans.additionalDocument"), (plan) => <bdi>{money(plan, plan.pricePerAdditionalPostedDocument)}</bdi>)}
        {row(t("publicPlans.compareApproval"), (plan) => plan.requiresApproval ? t("publicPlans.approval") : t("publicPlans.reviewFirst"))}
        {comparedModuleCodes(selected).map((code) => row(selected.flatMap((plan) => plan.modules).find((module) => module.code === code)!.displayName, (plan) => {
          const module = plan.modules.find((item) => item.code === code);
          return !module ? t("publicPlans.notOffered") : module.selectionMode === "INCLUDED" ? t("platformSubscriptions.includedModule") : <>{t("platformSubscriptions.optionalModule")} · <bdi>{money(plan, module.additionalRecurringFee)}</bdi></>;
        }, code))}
      </tbody></table>
    </div>
    <p>{t("publicPlans.addonsNote")}</p>
  </details>;
}
