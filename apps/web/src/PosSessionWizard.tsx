import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CashierContextSnapshot } from "./cashier-context-controller";
import type { PosSaleContext } from "./PosOperatingContext";
import { useI18n } from "./i18n";
import { arPos, enPos, hiPos, urPos } from "./i18n/locales/pos";
import { posDecimal } from "./pos-experience-money";
import { Button, Modal } from "./ui";
import "./pos-experience-styles.css";

export function isPosSessionDetailsComplete(snapshot: CashierContextSnapshot, value: PosSaleContext) {
  const rate = posDecimal(value.exchangeRate, 8, 11);
  return snapshot.canReview && Boolean(value.documentDate && value.customerId && value.customerLabel.trim() && value.description.trim()
    && rate !== null && /[1-9]/u.test(rate) && (!snapshot.fields.paymentMethodId.reference?.requiresReference || value.referenceNumber.trim()));
}

const posCopy = { ar: arPos, en: enPos, hi: hiPos, ur: urPos };

/**
 * Session copy remains in the POS feature dictionary until the generated
 * aggregate locale modules are refreshed by the integration owner.
 */
export function posSessionCopy(locale: "ar" | "en" | "hi" | "ur") {
  return posCopy[locale];
}

export function PosSessionWizard({ locale, onClose, sessionContext, saleDetails, snapshot, value, blocked, onReview }: {
  locale: "ar" | "en" | "hi" | "ur";
  onClose: () => void;
  sessionContext: ReactNode;
  saleDetails: ReactNode;
  snapshot: CashierContextSnapshot;
  value: PosSaleContext;
  blocked: boolean;
  onReview: (rememberForNextSale: boolean) => boolean;
}) {
  const { t } = useI18n();
  const copy = posSessionCopy(locale);
  const [step, setStep] = useState(0);
  const [remember, setRemember] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const complete = isPosSessionDetailsComplete(snapshot, value);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const steps = [copy["pos.sessionStepContext"], copy["pos.sessionStepDetails"], copy["pos.sessionStepReview"]];
  const field = (label: string, fieldValue: string | null | undefined) => <div><dt>{label}</dt><dd><bdi>{fieldValue?.trim() || "—"}</bdi></dd></div>;
  const closeSafely = () => onClose(); // The wizard owns no draft: all edits remain in their existing controllers and the basket is untouched.
  const review = () => { if (complete && onReview(remember)) closeSafely(); };

  return <Modal size="large" className="pos-session-wizard-modal" title={copy["pos.sessionWizardTitle"]} description={copy["pos.sessionWizardDescription"]} onClose={closeSafely}>
    <div className="pos-session-wizard" dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"}>
      <ol className="pos-session-wizard-steps" aria-label={copy["pos.sessionWizardTitle"]}>
        {steps.map((label, index) => <li key={label} className={index === step ? "active" : index < step ? "complete" : ""}>
          <button type="button" aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button>
        </li>)}
      </ol>
      <section className="pos-session-wizard-body">
        {step === 0 && <><h3 ref={heading} tabIndex={-1}>{copy["pos.sessionStepContext"]}</h3><p>{copy["pos.sessionContextHelp"]}</p>{sessionContext}</>}
        {step === 1 && <><h3 ref={heading} tabIndex={-1}>{copy["pos.sessionStepDetails"]}</h3><p>{copy["pos.sessionDetailsHelp"]}</p>{saleDetails}</>}
        {step === 2 && <><h3 ref={heading} tabIndex={-1}>{copy["pos.sessionStepReview"]}</h3><p>{copy["pos.sessionReviewHelp"]}</p>
          <div className={`pos-session-wizard-status ${complete && snapshot.reviewed ? "ready" : ""}`} role="status">{complete && snapshot.reviewed ? copy["pos.sessionReady"] : complete ? copy["pos.sessionReadyToActivate"] : copy["pos.sessionIncomplete"]}</div>
          <dl className="pos-session-wizard-summary">
            {field(t("pos.period"), snapshot.period.status === "RESOLVED" ? snapshot.period.period.name : null)}
            {field(t("pos.warehouse"), snapshot.fields.warehouseId.reference?.label)}
            {field(t("pos.cashAccount"), snapshot.fields.cashBankAccountId.reference?.label)}
            {field(t("pos.paymentMethod"), snapshot.fields.paymentMethodId.reference?.label)}
            {field(t("pos.currency"), snapshot.fields.currencyId.reference?.label)}
            {field(t("pos.customer"), value.customerLabel)}
            {field(t("pos.descriptionLabel"), value.description)}
            {field(t("pos.exchangeRate"), value.exchangeRate)}
            {field(t("pos.reference"), value.referenceNumber)}
          </dl>
          <label className="pos-session-wizard-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={blocked || !complete} /><span>{copy["pos.sessionRemember"]}</span></label>
        </>}
      </section>
      <footer className="pos-session-wizard-actions">
        <Button variant="ghost" onClick={closeSafely}>{copy["pos.sessionClose"]}</Button>
        <span />
        {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>{t("common.previous")}</Button>}
        {step < 2 ? <Button onClick={() => setStep(step + 1)}>{t("common.next")}</Button>
          : <Button icon="check" disabled={blocked || !complete} onClick={review}>{copy["pos.sessionActivate"]}</Button>}
      </footer>
    </div>
  </Modal>;
}
