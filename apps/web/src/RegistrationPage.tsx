import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { localizedBrand } from "./branding";
import { localizedReferenceName, LanguageSwitcher, localeDetails, resolveLocale, supportedLocales, useI18n, type Locale } from "./i18n";
import { Button, Spinner } from "./ui";

type RegistrationOptions = {
  currencies: Array<{ code: string; nameAr: string; decimals: number }>;
  locales: Locale[];
  timezones: string[];
  chartTemplates: Array<{ code: string; nameAr: string; nameEn: string }>;
  passwordPolicy: { minLength: number; maxLength: number };
};

type RegistrationState = "form" | "pending" | "verifying" | "completed" | "verification-error";

function registrationError(cause: unknown, t: ReturnType<typeof useI18n>["t"]) {
  if (cause instanceof ApiError && cause.code === "REGISTRATION_TOKEN_INVALID") return t("registration.invalidToken");
  if (cause instanceof ApiError && cause.code === "REGISTRATION_CONFLICT") return t("registration.conflict");
  if (cause instanceof ApiError && cause.code === "RATE_LIMITED") return t("registration.rateLimited");
  if (cause instanceof ApiError && cause.code === "PROVISIONING_FAILED") return t("registration.provisioningFailed");
  return cause instanceof Error ? cause.message : t("registration.error");
}

export function RegistrationPage({ onBackToLogin }: { onBackToLogin: () => void }) {
  const { dir, locale, setLocale, t } = useI18n();
  const brand = localizedBrand(t);
  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [state, setState] = useState<RegistrationState>("form");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const verificationStarted = useRef(false);

  useEffect(() => {
    void api<RegistrationOptions>("/auth/register/options")
      .then(setOptions)
      .catch((cause) => setError(registrationError(cause, t)));
  }, [t]);

  useEffect(() => {
    const token = new URLSearchParams(location.hash.split("?", 2)[1] ?? "").get("token");
    if (!token || verificationStarted.current) return;
    verificationStarted.current = true;
    setState("verifying");
    setError("");
    let cancelled = false;
    const verify = async (attempt = 0): Promise<void> => {
      try {
        const result = await api<{ status: "COMPLETED"; companyId: string; userId: string } | { status: "IN_PROGRESS" }>("/auth/register/verify", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        if (result.status === "IN_PROGRESS" && attempt < 2) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));
          return verify(attempt + 1);
        }
        if (result.status === "IN_PROGRESS") throw new Error(t("registration.provisioningFailed"));
        const url = new URL(location.href);
        history.replaceState(null, "", `${url.pathname}${url.search}#register`);
        setState("completed");
      } catch (cause) {
        if (cancelled) return;
        setError(registrationError(cause, t));
        setState("verification-error");
      }
    };
    void verify();
    return () => { cancelled = true; };
  }, [t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("passwordConfirmation"))) {
      setError(t("registration.passwordMismatch"));
      setBusy(false);
      return;
    }
    const submittedEmail = String(form.get("email")).trim();
    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: submittedEmail,
          password,
          displayName: String(form.get("displayName")),
          organizationName: String(form.get("organizationName")),
          companyName: String(form.get("companyName")),
          timezone: String(form.get("timezone")),
          baseCurrencyCode: String(form.get("baseCurrencyCode")),
          locale,
          chartTemplateCode: String(form.get("chartTemplateCode")),
        }),
      });
      setEmail(submittedEmail);
      setState("pending");
    } catch (cause) {
      setError(registrationError(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/register/resend", { method: "POST", body: JSON.stringify({ email }) });
    } catch (cause) {
      setError(registrationError(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const defaultTimezone = options?.timezones.includes(browserTimezone) ? browserTimezone : options?.timezones.includes("Asia/Aden") ? "Asia/Aden" : "UTC";
  const defaultCurrency = options?.currencies.find((currency) => currency.code === "YER")?.code ?? options?.currencies[0]?.code;
  const defaultChart = options?.chartTemplates[0]?.code;

  return (
    <main className="auth-layout registration-layout" dir={dir}>
      <div className="auth-language"><LanguageSwitcher /></div>
      <section className="auth-story registration-story">
        <div className="auth-brand"><div className="brand-mark">{brand.mark}</div><span>{brand.name}</span></div>
        <div>
          <span className="section-kicker light">{t("registration.storyKicker")}</span>
          <h1>{t("registration.storyTitle")}</h1>
          <p>{t("registration.storyDescription")}</p>
        </div>
        <small>{t("registration.securityNote")}</small>
      </section>
      <section className="auth-panel registration-panel">
        <div className="registration-card">
          <div className="mobile-auth-brand"><div className="brand-mark">{brand.mark}</div><strong>{brand.shortName}</strong></div>
          {state === "form" && (
            <>
              <span className="section-kicker">{t("registration.kicker")}</span>
              <h2>{t("registration.title")}</h2>
              <p>{t("registration.description")}</p>
              {error && <div className="form-error" role="alert">{error}</div>}
              {!options && !error && <Spinner label={t("registration.loadingOptions")} />}
              {options && (
                <form className="registration-form" onSubmit={submit}>
                  <label><span>{t("registration.displayName")}</span><input name="displayName" autoComplete="name" maxLength={160} required /></label>
                  <label><span>{t("registration.email")}</span><input name="email" type="email" dir="ltr" autoComplete="email" maxLength={320} required /></label>
                  <label><span>{t("registration.password")}</span><input name="password" type="password" dir="ltr" autoComplete="new-password" minLength={options.passwordPolicy.minLength} maxLength={options.passwordPolicy.maxLength} required /><small>{t("registration.passwordHint", { min: options.passwordPolicy.minLength })}</small></label>
                  <label><span>{t("registration.passwordConfirmation")}</span><input name="passwordConfirmation" type="password" dir="ltr" autoComplete="new-password" minLength={options.passwordPolicy.minLength} required /></label>
                  <label><span>{t("registration.organizationName")}</span><input name="organizationName" maxLength={200} required /></label>
                  <label><span>{t("registration.companyName")}</span><input name="companyName" maxLength={200} required /></label>
                  <label><span>{t("registration.timezone")}</span><select name="timezone" defaultValue={defaultTimezone}>{options.timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></label>
                  <label><span>{t("registration.baseCurrency")}</span><select name="baseCurrencyCode" defaultValue={defaultCurrency}>{options.currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} — {localizedReferenceName(currency)}</option>)}</select></label>
                  <label><span>{t("registration.interfaceLanguage")}</span><select value={locale} onChange={(event) => setLocale(resolveLocale(event.target.value))}>{supportedLocales.filter((item) => options.locales.includes(item)).map((item) => <option key={item} value={item}>{localeDetails[item].nativeName}</option>)}</select></label>
                  <label><span>{t("registration.chartTemplate")}</span><select name="chartTemplateCode" defaultValue={defaultChart}>{options.chartTemplates.map((template) => <option key={template.code} value={template.code}>{localizedReferenceName(template)}</option>)}</select></label>
                  <div className="registration-actions">
                    <Button type="submit" disabled={busy}>{busy ? t("registration.submitting") : t("registration.submit")}</Button>
                    <Button type="button" variant="ghost" onClick={onBackToLogin}>{t("registration.backToLogin")}</Button>
                  </div>
                </form>
              )}
            </>
          )}
          {state === "pending" && <RegistrationResult title={t("registration.pendingTitle")} description={t("registration.pendingDescription")} error={error}><Button onClick={() => void resend()} disabled={busy} variant="secondary">{busy ? t("registration.resending") : t("registration.resend")}</Button><Button onClick={onBackToLogin} variant="ghost">{t("registration.backToLogin")}</Button></RegistrationResult>}
          {state === "verifying" && <RegistrationResult title={t("registration.verifyingTitle")} description={t("registration.verifyingDescription")}><Spinner /></RegistrationResult>}
          {state === "completed" && <RegistrationResult title={t("registration.completedTitle")} description={t("registration.completedDescription")}><Button onClick={onBackToLogin}>{t("registration.signIn")}</Button></RegistrationResult>}
          {state === "verification-error" && <RegistrationResult title={t("registration.verificationErrorTitle")} description={t("registration.verificationErrorDescription")} error={error}><Button onClick={onBackToLogin}>{t("registration.backToLogin")}</Button></RegistrationResult>}
        </div>
      </section>
    </main>
  );
}

function RegistrationResult({ title, description, error, children }: { title: string; description: string; error?: string; children: ReactNode }) {
  return <div className="registration-result"><div className="registration-result-mark">✓</div><h2>{title}</h2><p>{description}</p>{error && <div className="form-error" role="alert">{error}</div>}<div className="registration-result-actions">{children}</div></div>;
}
