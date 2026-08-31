import { useMemo, useState, type FormEvent } from "react";
import { authPost, uncertainAuthResult } from "./auth-resilience";
import { AuthFeedback } from "./AuthFeedback";
import { useAuthAction } from "./use-auth-action";
import { localizedBrand } from "./branding";
import { LanguageSwitcher, useI18n } from "./i18n";
import { Button } from "./ui";

function tokenFromHash() {
  const query = location.hash.split("?", 2)[1] ?? "";
  return new URLSearchParams(query).get("token") ?? "";
}

export function PasswordResetPage({ onBackToLogin }: { onBackToLogin: () => void }) {
  const { dir, locale, t } = useI18n();
  const brand = localizedBrand(t);
  const token = useMemo(tokenFromHash, []);
  const [stage, setStage] = useState<"request" | "sent" | "reset" | "completed">(token ? "reset" : "request");
  const [validationError, setValidationError] = useState("");
  const action = useAuthAction();
  const loading = action.busy;

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setValidationError("");
    const data = new FormData(event.currentTarget);
    void action.run((signal) => authPost("/auth/password/forgot", { email: String(data.get("email") ?? "").trim(), locale }, signal), {
      onSuccess: () => setStage("sent"),
    });
  }

  async function completeReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setValidationError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmation") ?? "")) {
      setValidationError(t("passwordReset.passwordMismatch"));
      return;
    }
    void action.run((signal) => authPost<void>("/auth/password/reset", { token, password }, signal), { onSuccess: () => {
      history.replaceState(null, "", `${location.pathname}${location.search}#reset-password`);
      setStage("completed");
    } });
  }

  return (
    <main className="auth-layout auth-resilient" dir={dir}>
      <div className="auth-language"><LanguageSwitcher /></div>
      <section className="auth-story">
        <div className="auth-brand"><div className="brand-mark">{brand.mark}</div><span>{brand.name}</span></div>
        <div><h1>{t("passwordReset.storyTitle")}</h1><p>{t("passwordReset.storyDescription")}</p></div>
        <small>{t("passwordReset.securityNote")}</small>
      </section>
      <section className="auth-panel">
        {stage === "request" && <form className="login-card" onSubmit={requestReset}>
          <h2>{t("passwordReset.requestTitle")}</h2>
          <p>{t("passwordReset.requestDescription")}</p>
          <AuthFeedback {...action} hint={uncertainAuthResult(action.error) ? "authResilience.mailUncertain" : undefined} />
          <label><span>{t("login.email")}</span><input name="email" type="email" dir="ltr" autoComplete="email" required /></label>
          <Button type="submit" disabled={loading}>{loading ? t("common.loading") : t("passwordReset.sendLink")}</Button>
          <button className="auth-text-link" type="button" onClick={onBackToLogin}>{t("passwordReset.backToLogin")}</button>
        </form>}
        {stage === "sent" && <div className="login-card">
          <h2>{t("passwordReset.sentTitle")}</h2>
          <p>{t("passwordReset.sentDescription")}</p>
          <Button type="button" onClick={onBackToLogin}>{t("passwordReset.backToLogin")}</Button>
        </div>}
        {stage === "reset" && <form className="login-card" onSubmit={completeReset}>
          <h2>{t("passwordReset.resetTitle")}</h2>
          <p>{t("passwordReset.resetDescription")}</p>
          {validationError && <div className="form-error" role="alert">{validationError}</div>}
          <AuthFeedback {...action} hint={uncertainAuthResult(action.error) ? "authResilience.resetUncertain" : undefined} />
          <label><span>{t("passwordReset.newPassword")}</span><input name="password" type="password" dir="ltr" autoComplete="new-password" minLength={12} maxLength={1024} required /></label>
          <label><span>{t("passwordReset.confirmPassword")}</span><input name="confirmation" type="password" dir="ltr" autoComplete="new-password" minLength={12} maxLength={1024} required /></label>
          <Button type="submit" disabled={loading}>{loading ? t("common.saving") : t("passwordReset.savePassword")}</Button>
          <button className="auth-text-link" type="button" onClick={onBackToLogin}>{t("passwordReset.backToLogin")}</button>
        </form>}
        {stage === "completed" && <div className="login-card">
          <h2>{t("passwordReset.completedTitle")}</h2>
          <p>{t("passwordReset.completedDescription")}</p>
          <Button type="button" onClick={onBackToLogin}>{t("passwordReset.signIn")}</Button>
        </div>}
      </section>
    </main>
  );
}
