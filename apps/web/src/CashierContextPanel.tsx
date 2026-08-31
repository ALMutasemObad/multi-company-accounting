import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CashierContextController, CashierContextReviewed } from "./cashier-context-controller";
import { cashierContextFields, type CashierContextField } from "./cashier-context-model";
import { cashierContextDictionaries } from "./i18n/locales/cashier-context";
import "./cashier-context-panel.css";

export type CashierContextPickerProps = { field: CashierContextField; id: string | null; label: string; disabled: boolean; onSelect: (id: string | null) => void };
export type CashierContextPanelProps = {
  controller: CashierContextController;
  /** Derived from current authorization, independently of the controller; hides stale content during scope transitions. */
  currentScopeKey: string;
  locale: keyof typeof cashierContextDictionaries;
  renderPicker?: (props: CashierContextPickerProps) => ReactNode;
  /** Only changes the owner's draft. Never submits checkout or replaces its immutable attempt body. */
  onReviewed: (value: CashierContextReviewed) => void;
};

export function CashierContextPanel(props: CashierContextPanelProps) {
  const state = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot);
  const text = cashierContextDictionaries[props.locale];
  if (!props.currentScopeKey || props.currentScopeKey !== state.scopeKey) return <p role="status">{text.scopeChanged}</p>;
  return <CashierContextContent key={state.scopeKey} {...props} />;
}

function CashierContextContent({ controller, currentScopeKey, locale, renderPicker, onReviewed }: CashierContextPanelProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const text = cashierContextDictionaries[locale];
  const [editing, setEditing] = useState<CashierContextField | null>(null);
  const [remember, setRemember] = useState(false);
  const titleId = useId();
  useEffect(() => {
    if (!state.canReview && !state.reviewed) return;
    const timer = setTimeout(() => controller.expireReview(), controller.getReviewRemainingMs() + 1);
    return () => clearTimeout(timer);
  }, [controller, state]);
  const canAct = () => controller.getSnapshot().scopeKey === currentScopeKey && controller.getSnapshot().canEdit;
  return <section className="cashier-context-panel" dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"} lang={locale} aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <h2 id={titleId}>{text.title}</h2><p>{text.help}</p>
    {state.lock && <p role="status">{text.locked}</p>}
    {state.verificationExpired && <p role="status">{text.expired}</p>}
    <div className="cashier-context-date">
      <label><span>{text.date}</span><input type="date" value={state.documentDate} disabled={!state.canEdit} onChange={(event) => { if (canAct()) void controller.changeDate(event.target.value); }} /></label>
      <div aria-live="polite"><strong>{text.period}</strong><p>{state.period.status === "RESOLVED" ? state.period.period.name : text[state.period.status]}</p>
        {state.period.status === "RESOLVED" && <p>{text.server}</p>}</div>
    </div>
    <p>{text.advisory}</p>
    <dl className="cashier-context-fields">{cashierContextFields.map((field) => {
      const value = state.fields[field];
      const disabled = !state.canEdit || value.status === "forbidden" || value.status === "not-required";
      return <div className="cashier-context-field" key={field}>
        <dt>{text[field]}</dt><dd><bdi>{value.reference?.label ?? text[value.status]}</bdi>
          <p className="cashier-context-source">{text[value.source]}</p>
          {value.reference && <p>{text[value.status]}</p>}
          {value.reference?.requiresReference && <p>{text.referenceRequired}</p>}
          {value.status !== "not-required" && <button type="button" disabled={disabled} onClick={() => { if (canAct()) setEditing(editing === field ? null : field); }}>{editing === field ? text.cancelEdit : text.edit} {text[field]}</button>}
          {editing === field && !disabled && <div className="cashier-context-picker">{renderPicker ? renderPicker({ field, id: value.id, label: value.reference?.label ?? "", disabled,
            onSelect: (id) => { if (canAct()) { void controller.select(field, id); setEditing(null); } },
          }) : <p role="status">{text.pickerUnavailable}</p>}</div>}
        </dd>
      </div>;
    })}</dl>
    <p>{text.noExchangeRate}</p>
    <label className="cashier-context-remember"><input type="checkbox" checked={remember} disabled={!state.canEdit} onChange={(event) => setRemember(event.target.checked)} /><span>{text.remember}</span></label>
    <p>{text.rememberHelp}</p>
    <div className="cashier-context-actions">
      <button type="button" disabled={!state.canReview} onClick={() => { if (canAct()) { const result = controller.review(remember); if (result) { setEditing(null); onReviewed(result); } } }}>{text.review}</button>
      <button type="button" disabled={!state.canEdit} onClick={() => { if (canAct()) controller.saveDraft(); }}>{text.saveDraft}</button>
      <button type="button" disabled={!state.canEdit} onClick={() => { if (canAct()) void controller.refresh(); }}>{text.refresh}</button>
    </div>
    {state.reviewed && <p role="status">{text.reviewed}</p>}
    {state.hasSavedDraft && <p role="status">{text.savedDraft}</p>}
  </section>;
}
