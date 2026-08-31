import { useEffect, useRef, useState } from "react";
import { localizedBrand } from "./branding";
import { formatCurrencyDecimal, isZeroDecimal } from "./decimal-format";
import { LanguageSwitcher, useI18n } from "./i18n";
import { PublicPlansComparison } from "./PublicPlansComparison";
import { publicOfferDecimal } from "./public-offers";
import type { PublicSubscriptionCatalog, PublicSubscriptionPlan } from "./public-plans";
import { PlansDiscoveryFeatures } from "./PlansDiscoveryFeatures";
import { PlansDiscoveryJourney, PlansDiscoveryPlanActions } from "./PlansDiscoveryJourney";
import { plansDiscoveryMaxPage, readPlansDiscoveryPage } from "./PlansDiscoveryRead";
import { Button, Icon } from "./ui";
import "./public-plans.css";

export function PublicPlansPage() {
  const { dir, t } = useI18n();
  const brand = localizedBrand(t);
  const [catalog, setCatalog] = useState<PublicSubscriptionCatalog | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const focusAfterLoad = useRef(false);
  const navigatePage = (next: number) => {
    focusAfterLoad.current = true;
    setLoading(true); setFailed(false); setCatalog(null); setPage(next);
  };

  useEffect(() => { document.title = `${t("publicPlans.pageTitle")} | ${brand.shortName}`; }, [t, brand.shortName]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setFailed(false); setCatalog(null);
    void readPlansDiscoveryPage(page, controller.signal)
      .then((result) => { if (active) setCatalog(result); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [page, retry]);
  useEffect(() => {
    if (!loading && focusAfterLoad.current) {
      focusAfterLoad.current = false;
      document.getElementById("plans-catalog")?.focus();
    }
  }, [loading]);

  return <div className="public-plans" dir={dir}>
    <a className="plans-skip-link" href="#plans-catalog">{t("publicPlans.skip")}</a>
    <header className="plans-nav">
      <a className="plans-brand" href="/plans" aria-label={brand.name}><span className="brand-mark">{brand.mark}</span><strong>{brand.shortName}</strong></a>
      <nav aria-label={t("publicPlans.navigation")}><a href="#plans-catalog">{t("publicPlans.pageTitle")}</a>{!loading && !failed && !!catalog?.plans.length && <a href="/plans#plans-features-title">{t("publicPlans.featuresTitle")}</a>}<a href="#plans-faq">{t("publicPlans.faqTitle")}</a></nav>
      <div className="plans-nav-actions"><LanguageSwitcher /><a className="plans-login" href="/#login">{t("login.submit")}</a></div>
    </header>
    <main>
      <section className="plans-hero" aria-labelledby="plans-title">
        <h1 id="plans-title">{t("publicPlans.headline")}<br /><em>{t("publicPlans.headlineAccent")}</em></h1>
        <span className="plans-eyebrow"><span aria-hidden="true" />{t("publicPlans.eyebrow")}</span>
        <p>{t("publicPlans.intro")}</p>
        <div className="plans-promises">{(["clear", "modular", "grow"] as const).map((key) => <span key={key}><Icon name="check" size={16} />{t(`publicPlans.promise.${key}`)}</span>)}</div>
        <a className="plans-explore" href="#plans-catalog">{t("publicPlans.explore")}<Icon name="arrowDown" size={17} /></a>
      </section>

      <PlansDiscoveryJourney />

      <section className="plans-catalog" id="plans-catalog" tabIndex={-1} aria-labelledby="plans-catalog-title" aria-busy={loading}>
        <div className="plans-section-heading"><div><h2 id="plans-catalog-title">{t("publicPlans.catalogTitle")}</h2><p>{t("publicPlans.catalogEyebrow")}</p></div><p>{t("publicPlans.catalogNote")}</p></div>
        <p className="plans-listing-note">{t("publicPlans.listingScope")}</p>
        <PublicPlansCatalog key={`${page}-${retry}`} loading={loading} failed={failed} catalog={catalog} page={page} onPage={navigatePage} onRetry={() => { focusAfterLoad.current = true; setRetry((value) => value + 1); }} />
      </section>

      <section className="plans-benefits" aria-labelledby="plans-benefits-title"><div className="plans-benefits-intro"><h2 id="plans-benefits-title">{t("publicPlans.benefitsTitle")}</h2><p>{t("publicPlans.benefitsEyebrow")}</p><p>{t("publicPlans.benefitsDescription")}</p></div><div className="plans-benefit-grid">
        <article><Icon name="accounts" size={28} /><h3>{t("publicPlans.benefit.oneTitle")}</h3><p>{t("publicPlans.benefit.oneBody")}</p></article>
        <article><Icon name="dashboard" size={28} /><h3>{t("publicPlans.benefit.twoTitle")}</h3><p>{t("publicPlans.benefit.twoBody")}</p></article>
        <article><Icon name="users" size={28} /><h3>{t("publicPlans.benefit.threeTitle")}</h3><p>{t("publicPlans.benefit.threeBody")}</p></article>
      </div></section>

      <section className="plans-faq" id="plans-faq" aria-labelledby="plans-faq-title"><div><h2 id="plans-faq-title">{t("publicPlans.faqTitle")}</h2><p>{t("publicPlans.faqEyebrow")}</p><p>{t("publicPlans.faqIntro")}</p></div><div className="plans-faq-list">
        {(["payment", "modules", "tax", "change"] as const).map((key) => <details key={key}><summary>{t(`publicPlans.faq.${key}Question`)}</summary><p>{t(`publicPlans.faq.${key}Answer`)}</p></details>)}
      </div></section>

      <section className="plans-bottom-cta"><div><h2>{t("publicPlans.bottomTitle")}</h2><p>{t("publicPlans.bottomDescription")}</p></div><a className="plans-cta" href="/#register">{t("publicPlans.createAccount")}<Icon name="back" size={18} /></a></section>
    </main>
    <footer className="plans-footer"><strong>{brand.shortName}</strong><p>{t("publicPlans.footer")}</p><a href="/#subscription">{t("publicPlans.existingAccount")}</a></footer>
  </div>;
}

export function PublicPlansCatalog({ loading, failed, catalog, page, onPage, onRetry }: {
  loading: boolean; failed: boolean; catalog: PublicSubscriptionCatalog | null; page: number;
  onPage: (page: number) => void; onRetry: () => void;
}) {
  const { t } = useI18n();
  if (loading || (catalog && catalog.meta.page !== page)) return <><p role="status" className="plans-status">{t("publicPlans.loading")}</p><div className="plans-grid plans-skeleton" aria-hidden="true">{[0, 1, 2].map((id) => <div key={id}><span /><span /><span /><span /></div>)}</div></>;
  if (failed || !catalog) return <div className="plans-empty" role="alert"><h3>{t("publicPlans.loadErrorTitle")}</h3><p>{t("publicPlans.loadError")}</p><Button onClick={onRetry}>{t("common.retry")}</Button></div>;
  const lastPage = Math.min(catalog.meta.totalPages, plansDiscoveryMaxPage);
  return <>
    {catalog.plans.length ? <>
      <p className="plans-scope" role="status">{t("publicPlans.pageScope", { page: catalog.meta.page, count: catalog.plans.length, total: catalog.meta.total })}</p>
      <p className="plans-listing-note" id="plans-selection-storage">{t("publicPlans.selectionStorage")}</p>
      <div className="plans-grid">{catalog.plans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div>
      <PlansDiscoveryFeatures catalog={catalog} />
      {catalog.plans.length > 1 && <PublicPlansComparison catalog={catalog} />}
      {lastPage > 1 && <nav className="plans-pager" aria-label={t("publicPlans.pagination")}><Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("common.previous")}</Button><span>{t("publicPlans.page", { current: page, total: catalog.meta.totalPages })}</span><Button variant="secondary" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>{t("common.next")}</Button></nav>}
      {catalog.meta.totalPages > plansDiscoveryMaxPage && <p className="plans-listing-note">{t("publicPlans.catalogLimit", { pages: plansDiscoveryMaxPage })}</p>}
      <p className="plans-price-note">{t("publicPlans.priceNote")}</p>
    </> : <div className="plans-empty" role="status"><h3>{t(page > 1 ? "publicPlans.emptyPageTitle" : "publicPlans.emptyTitle")}</h3><p>{t(page > 1 ? "publicPlans.emptyPageDescription" : "publicPlans.emptyDescription")}</p>{page > 1 ? <Button onClick={() => onPage(1)}>{t("publicPlans.firstPage")}</Button> : <><a className="plans-cta" href="/#register">{t("publicPlans.createAccount")}</a><small>{t("publicPlans.noCharge")}</small></>}</div>}
    <p className="plans-price-note">{t("publicPlans.currentTerms")}</p>
  </>;
}

function PlanCard({ plan }: { plan: PublicSubscriptionPlan }) {
  const { intlLocale, formatNumber, t } = useI18n();
  const money = (value: string) => formatCurrencyDecimal(value, plan.currencyCode, intlLocale, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  const included = plan.modules.filter((module) => module.selectionMode === "INCLUDED");
  const optional = plan.modules.filter((module) => module.selectionMode === "OPTIONAL");
  const extras = [
    { label: t("publicPlans.additionalUser"), value: plan.pricePerAdditionalUser },
    { label: t("publicPlans.additionalEmployee"), value: plan.pricePerAdditionalEmployee },
    { label: t("publicPlans.additionalDocument"), value: plan.pricePerAdditionalPostedDocument },
  ];
  return <article className="plans-card" aria-labelledby={`plan-${plan.id}-title`}>
    <header><h3 id={`plan-${plan.id}-title`}>{plan.displayName}</h3><span className="plans-card-kicker">{plan.trialDays > 0 ? t("publicPlans.trial", { days: plan.trialDays }) : isZeroDecimal(plan.recurringFee) ? t("publicPlans.freeBadge") : t("publicPlans.paidBadge")}</span><p>{plan.description || t("publicPlans.defaultDescription")}</p></header>
    <div className="plans-price"><strong><bdi>{money(plan.recurringFee)}</bdi></strong><span>{t(`publicPlans.cycle.${plan.billingCycle}`)}</span><small>{isZeroDecimal(plan.taxRate) ? t("publicPlans.taxZero") : t("publicPlans.taxExtra", { rate: publicOfferDecimal(plan.taxRate) })}</small></div>
    <PlansDiscoveryPlanActions plan={plan} />
    <p className="plans-card-policy">{plan.requiresApproval ? t("publicPlans.approval") : t("publicPlans.reviewFirst")}</p>
    <div className="plans-card-features"><h4>{t("publicPlans.includes")}</h4><ul className="plans-limits">
      <li><Icon name="check" size={17} />{t("publicPlans.users", { count: formatNumber(plan.includedUsers) })}</li>
      <li><Icon name="check" size={17} />{t("publicPlans.employees", { count: formatNumber(plan.includedEmployees) })}</li>
      <li><Icon name="check" size={17} />{t("publicPlans.documents", { count: formatNumber(plan.includedPostedDocuments) })}</li>
    </ul><ul>{included.map((module) => <li key={module.code}><Icon name="check" size={17} /><span>{module.displayName}</span></li>)}</ul></div>
    {(optional.length > 0 || extras.some((item) => item.value !== null)) && <details className="plans-addons"><summary>{t("publicPlans.addons")}</summary><ul>
      {optional.map((module) => <li key={module.code}><span>{module.displayName}</span><strong><bdi>{module.additionalRecurringFee === null ? t("publicPlans.featureUnconfigured") : money(module.additionalRecurringFee)}</bdi></strong></li>)}
      {extras.filter((item) => item.value !== null).map((item) => <li key={item.label}><span>{item.label}</span><strong><bdi>{money(item.value!)}</bdi></strong></li>)}
    </ul><small>{t("publicPlans.addonsNote")}</small></details>}
  </article>;
}
