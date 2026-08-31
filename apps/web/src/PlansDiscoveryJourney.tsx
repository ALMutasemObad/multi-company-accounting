import { useI18n } from "./i18n";
import { registrationPlanHref, rememberSubscriptionPlan, type PublicSubscriptionPlan } from "./public-plans";

export function PlansDiscoveryJourney() {
  const { t } = useI18n();
  return <section className="plans-journey" aria-labelledby="plans-journey-title">
    <h2 id="plans-journey-title">{t("publicPlans.journey.title")}</h2>
    <div className="plans-journey-grid">
      <article><h3>{t("publicPlans.journey.newTitle")}</h3><p>{t("publicPlans.journey.newBody")}</p><a className="plans-text-link" href="/#register">{t("publicPlans.createAccount")}</a></article>
      <article><h3>{t("publicPlans.journey.existingTitle")}</h3><p>{t("publicPlans.journey.existingBody")}</p><div className="plans-journey-links"><a className="plans-text-link" href="/#login">{t("login.submit")}</a><a className="plans-text-link" href="/#subscription">{t("publicPlans.existingAccount")}</a></div></article>
    </div>
  </section>;
}

export function PlansDiscoveryPlanActions({ plan }: { plan: Pick<PublicSubscriptionPlan, "id" | "displayName"> }) {
  const { t } = useI18n();
  const remember = () => rememberSubscriptionPlan(plan.id);
  return <div className="plans-plan-actions">
    <a className="plans-cta" href={registrationPlanHref(plan.id)} onClick={remember} aria-describedby="plans-selection-storage" aria-label={`${t("publicPlans.choose")} — ${plan.displayName}`}>{t("publicPlans.choose")}</a>
    {/* The baseline captures URL intents only on #register. Do not emit an
        unintegrated #login?plan= URL: the plain route consumes the clicked
        preference in this tab. Shared URL preservation belongs to integration. */}
    <a className="plans-text-link" href="/#login" onClick={remember} aria-describedby="plans-selection-storage" aria-label={`${t("publicPlans.loginPlan")} — ${plan.displayName}`}>{t("publicPlans.loginPlan")}</a>
  </div>;
}
