import { useEffect, useRef, useState } from "react";
import type { NavigationAccess, View } from "./app-navigation";
import { useI18n } from "./i18n";
import { Icon } from "./ui";
import { initialRetailStep, retailActions, retailSteps, type RetailFactId, type RetailStepId, type RetailSetupTarget } from "./retail-onboarding-model";
import { canReadRetailFact, initialRetailFacts, readRetailFacts, retailFactDefinitions } from "./retail-onboarding-read";

export function RetailOnboardingGuide({ access, onNavigate, onOpenSetupTarget }: {
  access: NavigationAccess; onNavigate: (view: View) => void;
  onOpenSetupTarget?: (target: RetailSetupTarget) => void;
}) {
  const { t, formatNumber } = useI18n();
  const [selected, setSelected] = useState<RetailStepId>(() => initialRetailStep(access));
  const [facts, setFacts] = useState(() => initialRetailFacts(access));
  const [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  const step = retailSteps.find((item) => item.id === selected)!;
  const actions = retailActions(step, access);
  const canCheck = retailFactDefinitions.some((fact) => canReadRetailFact(fact, access));
  const hasError = Object.values(facts).includes("error");
  const index = retailSteps.indexOf(step);

  async function check() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setFacts(initialRetailFacts(access, true));
    try {
      const result = await readRetailFacts(access, controller.signal);
      if (!controller.signal.aborted) setFacts(result);
    } catch { /* Scope changes cancel the read, never turn it into missing data. */ }
    finally { if (!controller.signal.aborted) setChecking(false); }
  }

  function selectStep(id: RetailStepId, focus = false) {
    setSelected(id);
    if (focus) detailHeading.current?.focus();
  }

  const evidence = (id: RetailFactId) => <li key={id} data-fact={id} data-state={facts[id]}>
    <strong>{t(`home.fact.${id}`)}</strong>
    <span>{t(`home.factState.${facts[id]}`)}</span>
  </li>;

  return <section className="retail-onboarding" aria-labelledby="retail-guide-title">
    <header className="retail-guide-header">
      <div><h2 id="retail-guide-title">{t("home.setup.title")}</h2><p>{t("home.setup.description")}</p></div>
      {canCheck && <button className="retail-button" type="button" onClick={() => void check()} disabled={checking}>
        <Icon name="search" size={18} />{t(checking ? "home.setup.checking" : "home.setup.check")}
      </button>}
    </header>
    <p className="retail-guide-notice">{t("home.setup.readOnly")}</p>
    {checking && <p role="status">{t("home.setup.checking")}</p>}
    {hasError && <p className="retail-read-error" role="alert">{t("home.setup.readError")}</p>}
    <div className="retail-guide-layout">
      <ol className="retail-step-list" aria-label={t("home.setup.steps")}>
        {retailSteps.map((item, stepIndex) => <li key={item.id}>
          <button type="button" className={selected === item.id ? "selected" : ""} aria-current={selected === item.id ? "step" : undefined}
            aria-controls="retail-step-detail" onClick={() => selectStep(item.id)}>
            <span className="retail-step-number" aria-hidden="true">{formatNumber(stepIndex + 1)}</span><span>{t(item.title)}</span>
          </button>
        </li>)}
      </ol>
      <section id="retail-step-detail" className="retail-step-detail" aria-labelledby="retail-step-title" data-step={step.id}>
        <h3 id="retail-step-title" ref={detailHeading} tabIndex={-1}>{t(step.title)}</h3>
        <span className="retail-review-label">{t("home.setup.review")}</span>
        <p>{t(step.description)}</p>
        {step.facts.length > 0 && <ul className="retail-facts" aria-label={t("home.setup.evidence")}>{step.facts.map(evidence)}</ul>}
        <p className="retail-step-note">{t(step.note)}</p>
        {step.id === "catalog" && <p className="retail-price-review">{t("home.setup.priceReview")}</p>}
        <div className="retail-step-actions">
          {actions.map((action) => <button type="button" className="retail-button" key={action.id} data-setup-action={action.id}
            onClick={() => action.target.section && onOpenSetupTarget ? onOpenSetupTarget(action.target) : onNavigate(action.target.view)}>{t(action.label)}<Icon name="back" size={16} /></button>)}
        </div>
        {actions.length === 0 && <p className="retail-access-note">{t("home.setup.noAccess")}</p>}
        {!onOpenSetupTarget && actions.some((action) => action.target.section) && <p className="retail-destination-note">{t("home.setup.pageOnly")}</p>}
        {index < retailSteps.length - 1 && <button type="button" className="retail-next" onClick={() => selectStep(retailSteps[index + 1]!.id, true)}>
          {t("home.setup.next", { value1: t(retailSteps[index + 1]!.title) })}<Icon name="back" size={16} />
        </button>}
      </section>
    </div>
    <p className="retail-launch-note">{t("home.setup.launchBoundary")}</p>
  </section>;
}
