import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { AUTH_VERIFICATION_TIMEOUT_MS, authPost, uncertainAuthResult } from "./auth-resilience";
import { AuthFeedback } from "./AuthFeedback";
import { useAuthAction } from "./use-auth-action";
import { RequestError } from "./request-scope";
import { localizedBrand } from "./branding";
import { localizedReferenceName, LanguageSwitcher, localeDetails, resolveLocale, supportedLocales, useI18n, type Locale } from "./i18n";
import { Button, Spinner } from "./ui";
import { preferredSubscriptionPlan } from "./public-plans";

type RegistrationOptions = {
  currencies: Array<{ code: string; nameAr: string; decimals: number }>;
  locales: Locale[];
  timezones: string[];
  chartTemplates: Array<{ code: string; nameAr: string; nameEn: string }>;
  passwordPolicy: { minLength: number; maxLength: number };
};

type RegistrationState = "form" | "pending" | "verifying" | "completed" | "verification-error";

export function RegistrationPage({ onBackToLogin }: { onBackToLogin: () => void }) {
  const { dir, locale, setLocale, t } = useI18n();
  const brand = localizedBrand(t);
  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [state, setState] = useState<RegistrationState>("form");
  const [email, setEmail] = useState("");
  const [validationError, setValidationError] = useState("");
  const [inProgress, setInProgress] = useState(false);
  const token = useMemo(() => new URLSearchParams(location.hash.split("?", 2)[1] ?? "").get("token"), []);
  const optionsAction = useAuthAction();
  const action = useAuthAction();
  const busy = action.busy;
  const runOptions = optionsAction.run;
  const runVerification = action.run;
  const loadOptions = useCallback(() => {
    void runOptions((signal) => api<RegistrationOptions>("/auth/register/options", { signal }), { onSuccess: setOptions });
  }, [runOptions]);

  useEffect(() => {
    if (!token) loadOptions();
  }, [loadOptions, token]);

  const verify = useCallback(() => {
    if (!token) return;
    setState("verifying");
    setInProgress(false);
    void runVerification(async (signal) => {
      const result = await authPost<{ status: "COMPLETED" | "IN_PROGRESS" }>("/auth/register/verify", { token }, signal);
      if (result?.status !== "COMPLETED" && result?.status !== "IN_PROGRESS") throw new RequestError("response");
      return result;
    }, {
      timeoutMs: AUTH_VERIFICATION_TIMEOUT_MS,
      onSuccess: (result) => {
        if (result.status === "IN_PROGRESS") { setInProgress(true); setState("verification-error"); return; }
        const url = new URL(location.href);
        history.replaceState(null, "", `${url.pathname}${url.search}#register`);
        setState("completed");
      },
      onError: () => setState("verification-error"),
    });
  }, [token, runVerification]);
  useEffect(() => {
    if (!token) return;
    // Defer the initial POST past StrictMode's effect cleanup; never replay a sent POST.
    const timer = window.setTimeout(verify, 0);
    return () => window.clearTimeout(timer);
  }, [token, verify]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options || busy) return;
    setValidationError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("passwordConfirmation"))) {
      setValidationError(t("registration.passwordMismatch"));
      return;
    }
    const submittedEmail = String(form.get("email")).trim();
    void action.run((signal) => authPost("/auth/register", {
          email: submittedEmail,
          password,
          displayName: String(form.get("displayName")),
          organizationName: String(form.get("organizationName")),
          companyName: String(form.get("companyName")),
          timezone: String(form.get("timezone")),
          baseCurrencyCode: String(form.get("baseCurrencyCode")),
          locale,
          chartTemplateCode: String(form.get("chartTemplateCode")),
        }, signal), { onSuccess: () => {
      setEmail(submittedEmail);
      setState("pending");
    } });
  }

  async function resend() {
    void action.run((signal) => authPost("/auth/register/resend", { email }, signal));
  }

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const defaultTimezone = options?.timezones.includes(browserTimezone) ? browserTimezone : options?.timezones.includes("Asia/Aden") ? "Asia/Aden" : "UTC";
  const defaultCurrency = options?.currencies.find((currency) => currency.code === "YER")?.code ?? options?.currencies[0]?.code;
  const defaultChart = options?.chartTemplates[0]?.code;

  return (
    <main className="auth-layout registration-layout auth-resilient" dir={dir}>
      <div className="auth-language"><LanguageSwitcher /></div>
      <section className="auth-story registration-story">
        <div className="auth-brand"><div className="brand-mark">{brand.mark}</div><span>{brand.name}</span></div>
        <div>
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
              <h2>{t("registration.title")}</h2>
              <p>{t("registration.description")}</p>
              <a className="auth-text-link" href="/plans">{t("publicPlans.viewPage")}</a>
              {preferredSubscriptionPlan() && <div className="public-plan-selection">{t("publicPlans.selectionNote")}</div>}
              {validationError && <div className="form-error" role="alert">{validationError}</div>}
              <AuthFeedback {...optionsAction} />
              <AuthFeedback {...action} hint={uncertainAuthResult(action.error) ? "authResilience.mailUncertain" : undefined} />
              {!options && <div className="auth-recovery">
                {optionsAction.busy ? <Spinner label={t("registration.loadingOptions")} /> : <Button type="button" onClick={loadOptions}>{t("authResilience.retryRead")}</Button>}
                <Button type="button" variant="ghost" onClick={onBackToLogin}>{t("registration.backToLogin")}</Button>
              </div>}
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
          {state === "pending" && <RegistrationResult title={t("registration.pendingTitle")} description={t("registration.pendingDescription")}><AuthFeedback {...action} hint={uncertainAuthResult(action.error) ? "authResilience.mailUncertain" : undefined} /><Button onClick={() => void resend()} disabled={busy} variant="secondary">{busy ? t("registration.resending") : t("registration.resend")}</Button><Button onClick={onBackToLogin} variant="ghost">{t("registration.backToLogin")}</Button></RegistrationResult>}
          {state === "verifying" && <RegistrationResult title={t("registration.verifyingTitle")} description={t("registration.verifyingDescription")}><AuthFeedback {...action} /><Button onClick={onBackToLogin} variant="ghost">{t("registration.backToLogin")}</Button></RegistrationResult>}
          {state === "completed" && <RegistrationResult title={t("registration.completedTitle")} description={t("registration.completedDescription")}><Button onClick={onBackToLogin}>{t("registration.signIn")}</Button></RegistrationResult>}
          {state === "verification-error" && <RegistrationResult title={t("authResilience.verificationUnconfirmed")} description={t(uncertainAuthResult(action.error) || inProgress ? "authResilience.verifyUncertain" : "registration.verificationErrorDescription")}><AuthFeedback {...action} />{inProgress && <p role="status">{t("authResilience.verifyInProgress")}</p>}<Button onClick={verify} disabled={busy} variant="secondary">{t("authResilience.verifyAgain")}</Button><Button onClick={onBackToLogin}>{t("registration.backToLogin")}</Button></RegistrationResult>}
        </div>
      </section>
    </main>
  );
}

function RegistrationResult({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="registration-result"><h2>{title}</h2><p>{description}</p><div className="registration-result-actions">{children}</div></div>;
}
