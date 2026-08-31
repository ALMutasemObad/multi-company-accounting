import { useState, type FormEvent } from "react";
import { api, ApiError, login } from "./api";
import type { CurrentAuthorization } from "./types";
import { AUTH_TIMEOUT_MS, uncertainAuthResult } from "./auth-resilience";
import { AuthFeedback } from "./AuthFeedback";
import { localizedBrand } from "./branding";
import { LanguageSwitcher, useI18n } from "./i18n";
import { assertRequestActive, withinRequest } from "./request-scope";
import { Button } from "./ui";
import { useAuthAction } from "./use-auth-action";

export function LoginScreen({ onLoggedIn, onRegister, onForgotPassword }: {
  onLoggedIn: (signal: AbortSignal) => Promise<void>;
  onRegister: () => void;
  onForgotPassword: () => void;
}) {
  const { dir, t } = useI18n();
  const brand = localizedBrand(t);
  const action = useAuthAction();
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionFound, setSessionFound] = useState(false);
  const onError = (cause: unknown) => { if (cause instanceof ApiError && cause.status === 401) setSessionReady(false); };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSessionFound(false);
    const data = new FormData(form);
    void action.run(async (signal) => {
      await login(String(data.get("email")), String(data.get("password")), { signal, timeoutMs: AUTH_TIMEOUT_MS });
      assertRequestActive(signal);
      // Never store credentials for shell recovery or replay them on a read failure.
      const passwordField = form.elements.namedItem("password");
      if (passwordField instanceof HTMLInputElement) passwordField.value = "";
      setSessionReady(true);
      await withinRequest(onLoggedIn, { signal, timeoutMs: AUTH_TIMEOUT_MS });
    }, { timeoutMs: AUTH_TIMEOUT_MS * 2, onError });
  }
  function continueWorkspace() {
    if (sessionReady) void action.run(onLoggedIn, { onError });
    else void action.run((signal) => api<CurrentAuthorization>("/auth/me", { signal }), {
      onSuccess: () => setSessionFound(true), onError,
    });
  }
  return (
    <main className="auth-layout auth-resilient" dir={dir}>
      <div className="auth-language"><LanguageSwitcher /></div>
      <section className="auth-story">
        <div className="auth-brand"><div className="brand-mark">{brand.mark}</div><span>{brand.name}</span></div>
        <div><h1>{t("login.headlineFirst")}<br />{t("login.headlineSecond")}</h1><p>{t("login.storyDescription")}</p></div>
      </section>
      <section className="auth-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-auth-brand"><div className="brand-mark">{brand.mark}</div><strong>{brand.shortName}</strong></div>
          <h2>{t("login.title")}</h2>
          <p>{t("login.description")}</p>
          {sessionReady && <p role="status">{t(action.busy ? "authResilience.workspace" : "authResilience.workspaceHint")}</p>}
          {sessionFound && <p role="status">{t("authResilience.sessionFound")}</p>}
          <AuthFeedback {...action} hint={uncertainAuthResult(action.error) ? (sessionReady ? "authResilience.workspaceHint" : "authResilience.loginUncertain") : undefined} />
          {!sessionReady && <>
            <label><span>{t("login.email")}</span><input name="email" type="email" dir="ltr" autoComplete="username" required disabled={action.busy} /></label>
            <label><span>{t("login.password")}</span><input name="password" type="password" dir="ltr" autoComplete="current-password" required disabled={action.busy} /></label>
            <Button type="submit" disabled={action.busy}>{action.busy ? t("login.checking") : t("login.submit")}</Button>
          </>}
          {(sessionReady || uncertainAuthResult(action.error)) && <div className="auth-recovery">
            <Button type="button" variant="secondary" disabled={action.busy} onClick={continueWorkspace}>{t(sessionReady ? "authResilience.continueWorkspace" : "authResilience.checkSession")}</Button>
          </div>}
          <button className="auth-text-link" type="button" onClick={onForgotPassword}>{t("login.forgotPassword")}</button>
          <button className="auth-text-link" type="button" onClick={onRegister}>{t("login.createAccount")}</button>
          <a className="auth-text-link" href="/plans">{t("publicPlans.viewPage")}</a>
        </form>
      </section>
    </main>
  );
}
