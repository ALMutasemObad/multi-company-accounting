import { useMemo, useState, type ReactNode } from "react";
import type { CashierContextSnapshot } from "./cashier-context-controller";
import type { PosSaleContext } from "./PosOperatingContext";
import { Button, Modal } from "./ui";
import "./pos-experience-styles.css";

type WizardCopy = {
  title: string; description: string; context: string; details: string; review: string;
  contextHelp: string; detailsHelp: string; reviewHelp: string; previous: string; next: string;
  finish: string; close: string; ready: string; needsReview: string; customer: string; descriptionLabel: string;
  exchangeRate: string; paymentReference: string; period: string; warehouse: string; cashAccount: string;
  paymentMethod: string; currency: string;
};

const copy: Record<"ar" | "en", WizardCopy> = {
  ar: {
    title: "إعداد جلسة البيع", description: "ثلاث خطوات قصيرة قبل البيع. لا تنشئ هذه الشاشة بيعًا أو قيدًا، ولا تمس السلة.",
    context: "سياق البيع", details: "تفاصيل البيع والدفع", review: "مراجعة الجاهزية",
    contextHelp: "اختر التاريخ والفترة والمستودع والصندوق وطريقة الدفع والعملة.",
    detailsHelp: "أدخل العميل ووصف البيع وما يلزم للتحصيل.", reviewHelp: "راجع الملخص ثم فعّل الجلسة. يمكنك العودة لتعديل أي اختيار.",
    previous: "السابق", next: "التالي", finish: "تفعيل جلسة البيع", close: "إغلاق والعودة للسلة",
    ready: "الجلسة جاهزة للبيع", needsReview: "أكمل الاختيارات المطلوبة ثم راجع الجلسة.",
    customer: "العميل", descriptionLabel: "وصف البيع", exchangeRate: "سعر الصرف", paymentReference: "مرجع التحصيل",
    period: "الفترة المالية", warehouse: "المستودع", cashAccount: "الصندوق / البنك", paymentMethod: "طريقة التحصيل", currency: "العملة",
  },
  en: {
    title: "Prepare sale session", description: "Three short steps before selling. This screen creates no sale or entry and never changes the basket.",
    context: "Sale context", details: "Sale & payment details", review: "Readiness review",
    contextHelp: "Choose the date, period, warehouse, cash account, payment method, and currency.",
    detailsHelp: "Enter the customer, sale description, and any collection details.", reviewHelp: "Review the summary, then enable the session. You can return to any step to adjust it.",
    previous: "Back", next: "Next", finish: "Enable selling session", close: "Close and return to basket",
    ready: "Session is ready to sell", needsReview: "Complete the required selections, then review the session.",
    customer: "Customer", descriptionLabel: "Sale description", exchangeRate: "Exchange rate", paymentReference: "Payment reference",
    period: "Fiscal period", warehouse: "Warehouse", cashAccount: "Cash / bank account", paymentMethod: "Payment method", currency: "Currency",
  },
};

export function PosSessionWizard({ locale, onClose, sessionContext, saleDetails, snapshot, value, blocked, onReview }: {
  locale: "ar" | "en" | "hi" | "ur";
  onClose: () => void;
  sessionContext: ReactNode;
  saleDetails: ReactNode;
  snapshot: CashierContextSnapshot;
  value: PosSaleContext;
  blocked: boolean;
  onReview: () => boolean;
}) {
  const text = copy[locale === "ar" ? "ar" : "en"];
  const [step, setStep] = useState(0);
  const steps = useMemo(() => [text.context, text.details, text.review], [text]);
  const field = (label: string, value: string | null | undefined) => <div><dt>{label}</dt><dd><bdi>{value?.trim() || "—"}</bdi></dd></div>;
  const closeSafely = () => onClose(); // The wizard owns no draft: all edits remain in their existing controllers and the basket is untouched.
  const review = () => { if (onReview()) closeSafely(); };

  return <Modal wide title={text.title} description={text.description} onClose={closeSafely}>
    <div className="pos-session-wizard" dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"}>
      <ol className="pos-session-wizard-steps" aria-label={text.title}>
        {steps.map((label, index) => <li key={label} className={index === step ? "active" : index < step ? "complete" : ""}>
          <button type="button" aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button>
        </li>)}
      </ol>
      <section className="pos-session-wizard-body" aria-live="polite">
        {step === 0 && <><h3>{text.context}</h3><p>{text.contextHelp}</p>{sessionContext}</>}
        {step === 1 && <><h3>{text.details}</h3><p>{text.detailsHelp}</p>{saleDetails}</>}
        {step === 2 && <><h3>{text.review}</h3><p>{text.reviewHelp}</p>
          <div className={`pos-session-wizard-status ${snapshot.reviewed ? "ready" : ""}`} role="status">{snapshot.reviewed ? text.ready : text.needsReview}</div>
          <dl className="pos-session-wizard-summary">
            {field(text.period, snapshot.period.status === "RESOLVED" ? snapshot.period.period.name : null)}
            {field(text.warehouse, snapshot.fields.warehouseId.reference?.label)}
            {field(text.cashAccount, snapshot.fields.cashBankAccountId.reference?.label)}
            {field(text.paymentMethod, snapshot.fields.paymentMethodId.reference?.label)}
            {field(text.currency, snapshot.fields.currencyId.reference?.label)}
            {field(text.customer, value.customerLabel)}
            {field(text.descriptionLabel, value.description)}
            {field(text.exchangeRate, value.exchangeRate)}
            {field(text.paymentReference, value.referenceNumber)}
          </dl>
        </>}
      </section>
      <footer className="pos-session-wizard-actions">
        <Button variant="ghost" onClick={closeSafely}>{text.close}</Button>
        <span />
        {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>{text.previous}</Button>}
        {step < 2 ? <Button onClick={() => setStep(step + 1)}>{text.next}</Button>
          : <Button icon="check" disabled={blocked || !snapshot.canReview} onClick={review}>{text.finish}</Button>}
      </footer>
    </div>
  </Modal>;
}
