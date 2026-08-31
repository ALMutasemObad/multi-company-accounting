import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { initialSellingProfileFields, sellingProfileSaveCommand, type SellingProfileEditorFields,
  type SellingProfileEditorValue, type SellingProfileReferenceOption, type SellingProfileSaveCommand,
  type SellingProfileSaveOutcome } from "./selling-profile-editor-model";
import { sellingProfileDictionaries } from "./i18n/locales/selling-profile";
import "./selling-profile-editor.css";
import { getSellingProfileAttempt, isUnresolvedSellingAttempt, sellingProfileAttemptFields,
  sellingProfileAttemptScope, sendSellingProfileAttempt, subscribeSellingProfileAttempt } from "./selling-profile-attempts";

export type ItemSellingProfileEditorProps = {
  scopeKey: string; itemId: string; itemName: string; profile: SellingProfileEditorValue | null;
  locale: "ar" | "en" | "hi" | "ur"; canManage: boolean;
  currencies: SellingProfileReferenceOption[]; accounts: SellingProfileReferenceOption[]; taxes: SellingProfileReferenceOption[];
  onSave: (command: SellingProfileSaveCommand, idempotencyKey: string) => Promise<SellingProfileSaveOutcome>;
  onReload: () => void;
};

/** Scope/item/version changes remount local draft state. No financial browser storage. */
export function ItemSellingProfileEditor(props: ItemSellingProfileEditorProps) {
  return <Editor key={`${props.scopeKey}:${props.itemId}:${props.profile?.version ?? "new"}`} {...props} />;
}

function Editor(props: ItemSellingProfileEditorProps) {
  const copy = sellingProfileDictionaries[props.locale];
  const id = useId();
  const scope = sellingProfileAttemptScope(props.scopeKey, props.itemId);
  const subscribe = useCallback((listener: () => void) => subscribeSellingProfileAttempt(scope, listener), [scope]);
  const snapshot = useCallback(() => getSellingProfileAttempt(scope), [scope]);
  const attempt = useSyncExternalStore(subscribe, snapshot, snapshot);
  const initialProfile = attempt?.outcome?.status === "saved"
    && attempt.outcome.profile.version > (props.profile?.version ?? 0) ? attempt.outcome.profile : props.profile;
  const [profile, setProfile] = useState(initialProfile);
  const [fields, setFields] = useState(() => sellingProfileAttemptFields(initialProfile, attempt));
  const [localStatus, setStatus] = useState<"idle" | "saved" | "conflict" | "rejected" | "capacity">("idle");
  const handledAttempt = useRef<string | null>(null);
  const status = attempt?.status === "sending" ? "saving" : attempt?.status === "unknown" ? "unknown" : localStatus;
  useEffect(() => {
    if (!attempt?.outcome || isUnresolvedSellingAttempt(attempt) || handledAttempt.current === attempt.key) return;
    handledAttempt.current = attempt.key;
    if (attempt.outcome.status === "saved") {
      const latest = props.profile && props.profile.version > attempt.outcome.profile.version ? props.profile : attempt.outcome.profile;
      setProfile(latest); setFields(initialSellingProfileFields(latest)); setStatus("saved");
    } else if (attempt.outcome.status === "rejected") {
      setStatus(attempt.outcome.reason === "VERSION_CONFLICT" ? "conflict" : "rejected");
    }
  }, [attempt, props.profile]);
  const command = sellingProfileSaveCommand(props.itemId, profile, fields, props);
  const locked = !props.canManage || status === "saving" || status === "unknown";
  const change = <K extends keyof SellingProfileEditorFields>(field: K, value: SellingProfileEditorFields[K]) => {
    setFields(current => ({ ...current, [field]: value })); setStatus("idle");
  };
  const save = async (retry: boolean) => {
    if (!props.canManage) return;
    if (!retry && (locked || !command)) return;
    try { await sendSellingProfileAttempt(scope, command, props.onSave, retry); } catch { setStatus("capacity"); }
  };
  const select = (field: "currencyId" | "revenueAccountId" | "taxRateId", label: string, options: SellingProfileReferenceOption[]) => {
    const value = fields[field];
    const missing = value !== "" && !options.some(option => option.id === value);
    return <label className="selling-profile-editor__field" htmlFor={`${id}-${field}`}>
      <span>{label}</span>
      <select id={`${id}-${field}`} value={value} onChange={event => change(field, event.target.value)}>
        <option value="">{field === "taxRateId" ? copy.noTax : copy.choose}</option>
        {missing && <option value={value} disabled>{copy.unavailable} ({value})</option>}
        {options.map(option => <option key={option.id} value={option.id} disabled={!option.isAvailable}>{option.label}{!option.isAvailable ? ` — ${copy.unavailable}` : ""}</option>)}
      </select>
    </label>;
  };
  return <section className="selling-profile-editor" dir={props.locale === "ar" || props.locale === "ur" ? "rtl" : "ltr"}
    aria-labelledby={`${id}-title`} aria-busy={status === "saving"}>
    <h2 id={`${id}-title`}>{copy.title}</h2><p className="selling-profile-editor__item">{props.itemName}</p><p>{copy.description}</p>
    {!props.canManage && <p role="status">{copy.readOnly}</p>}
    <form onSubmit={event => { event.preventDefault(); void save(false); }}>
      <fieldset disabled={locked}>
        <div className="selling-profile-editor__grid">
          <label className="selling-profile-editor__field" htmlFor={`${id}-price`}><span>{copy.price}</span>
            <input id={`${id}-price`} inputMode="decimal" dir="ltr" type="text" maxLength={20} value={fields.unitPrice}
              aria-describedby={`${id}-price-help`} onChange={event => change("unitPrice", event.target.value)} />
          </label>
          {select("currencyId", copy.currency, props.currencies)}
          {select("revenueAccountId", copy.account, props.accounts)}
          {select("taxRateId", copy.tax, props.taxes)}
        </div>
        <p id={`${id}-price-help`}>{copy.priceHelp}</p><p>{copy.currencyHelp}</p>
        {profile && <label className="selling-profile-editor__active"><input type="checkbox" checked={fields.isActive}
          onChange={event => change("isActive", event.target.checked)} />{copy.active}</label>}
      </fieldset>
      {!command && props.canManage && <p>{copy.references}</p>}
      <div className="selling-profile-editor__actions">
        <button type="submit" disabled={locked || !command}>{status === "saving" ? copy.saving : copy.save}</button>
        {status === "unknown" && props.canManage && <button type="button" onClick={() => void save(true)}>{copy.retry}</button>}
        {(status === "unknown" || status === "conflict") && <button type="button" onClick={props.onReload}>{copy.reload}</button>}
      </div>
      {status !== "idle" && status !== "saving" && <p role={status === "saved" ? "status" : "alert"}>{copy[status]}</p>}
    </form>
  </section>;
}
