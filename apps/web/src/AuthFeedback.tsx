import { authErrorMessage } from "./auth-resilience";
import { useEffect, useRef } from "react";
import { useI18n, type TranslationKey } from "./i18n";
import { Button } from "./ui";
import "./auth-resilience.css";

export function AuthFeedback({ busy, error, cancel, hint }: { busy: boolean; error: unknown; cancel: () => void; hint?: TranslationKey }) {
  const { t } = useI18n();
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error != null) alert.current?.focus(); }, [error]);
  return <>
    {error != null && <div className="form-error" role="alert" ref={alert} tabIndex={-1}>{authErrorMessage(error, t)}{hint && <p>{t(hint)}</p>}</div>}
    {busy && <div className="auth-wait"><p role="status">{t("authResilience.wait")}</p><Button type="button" variant="ghost" onClick={cancel}>{t("authResilience.cancel")}</Button></div>}
  </>;
}
