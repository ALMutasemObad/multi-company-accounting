import { useId } from "react";
import { posRecoveryDictionaries } from "./i18n/locales/pos-recovery";
import type { PosRecoveryState } from "./pos-recovery-model";
import "./pos-recovery-styles.css";

export type PosRecoveryPanelProps = {
  locale: "ar" | "en" | "hi" | "ur";
  state: PosRecoveryState;
  canCheckout: boolean;
  barcodePending: boolean;
  onCheck: () => void;
  onNewSale: () => void;
  onReviewRejected?: () => void;
  rejectionMessage?: string | undefined;
};

/** Presentation only. Mount in the authorized user/company keyed POS experience. */
export function PosRecoveryPanel(props: PosRecoveryPanelProps) {
  const copy = posRecoveryDictionaries[props.locale]; const titleId = useId();
  const state: PosRecoveryState = props.canCheckout ? props.state : { status: "blocked", reason: "permission" };
  if (state.status === "ready") return null;
  return <section className="pos-recovery" dir={props.locale === "ar" || props.locale === "ur" ? "rtl" : "ltr"}
    aria-labelledby={titleId} aria-busy={state.status === "checking" || state.status === "pending" || state.status === "initializing"}>
    <h2 id={titleId}>{copy.title}</h2>
    {state.status === "blocked" && <p role="alert">{copy[state.reason]}</p>}
    {(state.status === "initializing" || state.status === "pending" || state.status === "checking") && <p role="status">{copy[state.status]}</p>}
    {state.status === "unknown" && <>
      <p role="alert">{copy.unknown}</p>
      {state.reason !== "unconfirmed" && <p>{copy[state.reason]}</p>}
      <button type="button" onClick={props.onCheck}>{copy.check}</button>
    </>}
    {state.status === "rejected" && <>
      <p role="alert">{copy.rejected}</p><p>{copy.reviewHelp}</p>{props.rejectionMessage && <p>{props.rejectionMessage}</p>}
      <button type="button" disabled={props.barcodePending || !props.onReviewRejected} onClick={props.onReviewRejected}>{copy.review}</button>
    </>}
    {state.status === "confirmed" && <>
      <p role="status">{copy.confirmed}</p><p>{copy.historical}</p>
      <dl>
        <div><dt>{copy.invoice}</dt><dd><bdi>{state.result.invoice.documentNumber}</bdi> · <bdi>{state.result.invoice.id}</bdi></dd></div>
        <div><dt>{copy.receipt}</dt><dd><bdi>{state.result.receipt.documentNumber}</bdi> · <bdi>{state.result.receipt.id}</bdi></dd></div>
        <div><dt>{copy.total}</dt><dd><bdi>{state.result.invoice.total}</bdi></dd></div>
      </dl>
      <button type="button" disabled={props.barcodePending} onClick={props.onNewSale}>{copy.newSale}</button>
    </>}
  </section>;
}
