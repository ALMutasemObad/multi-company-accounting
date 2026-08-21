import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email: String(data.get("email") ?? "").trim(), locale }),
      });
      setStage("sent");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("passwordReset.requestError"));
    } finally {
      setLoading(false);
    }
  }

  async function completeReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmation") ?? "")) {
      setError(t("passwordReset.passwordMismatch"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api<void>("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      history.replaceState(null, "", `${location.pathname}${location.search}#reset-password`);
      setStage("completed");
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "PASSWORD_RESET_TOKEN_INVALID") {
        setError(t("passwordReset.invalidToken"));
      } else {
        setError(cause instanceof Error ? cause.message : t("passwordReset.resetError"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-layout" dir={dir}>
      <div className="auth-language"><LanguageSwitcher /></div>
      <section className="auth-story">
        <div className="auth-brand"><div className="brand-mark">{brand.mark}</div><span>{brand.name}</span></div>
        <div><span className="section-kicker light">{t("passwordReset.kicker")}</span><h1>{t("passwordReset.storyTitle")}</h1><p>{t("passwordReset.storyDescription")}</p></div>
        <small>{t("passwordReset.securityNote")}</small>
      </section>
      <section className="auth-panel">
        {stage === "request" && <form className="login-card" onSubmit={requestReset}>
          <span className="section-kicker">{t("passwordReset.kicker")}</span>
          <h2>{t("passwordReset.requestTitle")}</h2>
          <p>{t("passwordReset.requestDescription")}</p>
          {error && <div className="form-error" role="alert">{error}</div>}
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
          {error && <div className="form-error" role="alert">{error}</div>}
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
