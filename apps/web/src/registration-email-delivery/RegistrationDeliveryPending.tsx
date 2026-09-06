import type { ReactNode } from "react";
import type { Locale } from "../i18n";
import { Button } from "../ui";
import { deliveryCopyFor } from "./copy";

export function RegistrationDeliveryPending({
  locale,
  busy,
  resendAccepted,
  feedback,
  resendLabel,
  resendingLabel,
  backLabel,
  recoveryLink,
  onResend,
  onBack,
}: {
  locale: Locale;
  busy: boolean;
  resendAccepted: boolean;
  feedback: ReactNode;
  resendLabel: string;
  resendingLabel: string;
  backLabel: string;
  recoveryLink?: ReactNode;
  onResend: () => void;
  onBack: () => void;
}) {
  const copy = deliveryCopyFor(locale);
  return <div className="registration-result">
    <h2>{copy.acceptedTitle}</h2>
    <p>{copy.acceptedDescription}</p>
    <div className="registration-result-actions">
      {feedback}
      {resendAccepted && <p role="status">{copy.resendAccepted}</p>}
      <p>{copy.resendHelp}</p>
      <Button onClick={onResend} disabled={busy} variant="secondary">{busy ? resendingLabel : resendLabel}</Button>
      <Button onClick={onBack} variant="ghost">{backLabel}</Button>
      {recoveryLink}
    </div>
  </div>;
}
