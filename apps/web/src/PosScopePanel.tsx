import { posScopeDictionaries } from "./i18n/locales/pos-scope";
import type { PosScopeSnapshot } from "./pos-scope-controller";
import "./cashier-context-panel.css";

export function PosScopePanel({ state, locale, onVerify, canVerify = true }: { state: PosScopeSnapshot; locale: keyof typeof posScopeDictionaries; onVerify: () => void; canVerify?: boolean }) {
  const text = posScopeDictionaries[locale]; const checking = canVerify && (state.status === "checking" || state.status === "initializing");
  return <section className="cashier-context-panel" dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"} aria-busy={checking}>
    <h2>{text.title}</h2>{!canVerify ? <p role="alert">{text.noAccess}</p> : checking ? <p role="status">{text.checking}</p> : <><p role="alert">{text.stopped}</p><p>{text.retained}</p>
      <button type="button" onClick={onVerify}>{text.verify}</button></>}
  </section>;
}
