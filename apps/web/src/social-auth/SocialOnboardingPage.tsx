import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  cancelSocialOnboarding,
  completeSocialOnboarding,
  socialOnboardingOptions,
  type SocialOnboardingOptions,
} from '../api';
import { AuthFeedback } from '../AuthFeedback';
import { localizedBrand } from '../branding';
import {
  LanguageSwitcher,
  localeDetails,
  localizedReferenceName,
  resolveLocale,
  supportedLocales,
  useI18n,
} from '../i18n';
import { Button, Spinner } from '../ui';
import { useAuthAction } from '../use-auth-action';
import './social-auth.css';

export function SocialOnboardingPage({ onCompleted, onBackToLogin }: {
  onCompleted: () => void;
  onBackToLogin: () => void;
}) {
  const { dir, locale, setLocale, t } = useI18n();
  const brand = localizedBrand(t);
  const [options, setOptions] = useState<SocialOnboardingOptions | null>(null);
  const [completed, setCompleted] = useState(false);
  const optionsAction = useAuthAction();
  const action = useAuthAction();
  const runOptions = optionsAction.run;

  const loadOptions = useCallback(() => {
    void runOptions((signal) => socialOnboardingOptions({ signal }), { onSuccess: setOptions });
  }, [runOptions]);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options || action.busy) return;
    const form = new FormData(event.currentTarget);
    void action.run((signal) => completeSocialOnboarding({
      displayName: String(form.get('displayName')),
      organizationName: String(form.get('organizationName')),
      companyName: String(form.get('companyName')),
      timezone: String(form.get('timezone')),
      baseCurrencyCode: String(form.get('baseCurrencyCode')),
      locale,
      chartTemplateCode: String(form.get('chartTemplateCode')),
      consent: true,
    }, { signal, timeoutMs: 65_000 }), {
      timeoutMs: 66_000,
      onSuccess: () => {
        setCompleted(true);
        onCompleted();
      },
    });
  }

  function cancel() {
    void action.run((signal) => cancelSocialOnboarding({ signal }), {
      onSuccess: onBackToLogin,
    });
  }

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const defaultTimezone = options?.timezones.includes(browserTimezone)
    ? browserTimezone
    : options?.timezones.includes('Asia/Riyadh') ? 'Asia/Riyadh' : 'UTC';
  const defaultCurrency = options?.currencies.find((currency) => currency.code === 'SAR')?.code
    ?? options?.currencies[0]?.code;
  const defaultChart = options?.chartTemplates[0]?.code;
  const optionExpired = optionsAction.error instanceof ApiError && optionsAction.error.status === 410;
  const actionCode = action.error instanceof ApiError ? action.error.code : undefined;

  return (
    <main className="auth-layout registration-layout auth-resilient social-onboarding" dir={dir}>
      <div className="auth-language"><LanguageSwitcher /></div>
      <section className="auth-story registration-story">
        <div className="auth-brand"><div className="brand-mark">{brand.mark}</div><span>{brand.name}</span></div>
        <div><h1>{t('socialOnboarding.title')}</h1><p>{t('socialOnboarding.description')}</p></div>
        <small>{t('registration.securityNote')}</small>
      </section>
      <section className="auth-panel registration-panel">
        <div className="registration-card">
          <div className="mobile-auth-brand"><div className="brand-mark">{brand.mark}</div><strong>{brand.shortName}</strong></div>
          <h2>{t('socialOnboarding.title')}</h2>
          <p>{t('socialOnboarding.description')}</p>
          {completed && <p role="status" className="social-onboarding-status">{t('socialOnboarding.success')}</p>}
          {optionExpired && <p role="alert" className="form-error">{t('socialOnboarding.expired')}</p>}
          {actionCode === 'ACCOUNT_PROOF_REQUIRED' && <p role="alert" className="form-error">{t('socialOnboarding.accountProof')}</p>}
          {actionCode === 'ONBOARDING_INVALID' && <p role="alert" className="form-error">{t('socialOnboarding.expired')}</p>}
          {actionCode === 'PROVISIONING_FAILED' && <p role="alert" className="form-error">{t('socialOnboarding.failed')}</p>}
          <AuthFeedback {...optionsAction} />
          <AuthFeedback {...action} />
          {!options && !optionExpired && (
            <div className="auth-recovery">
              {optionsAction.busy
                ? <Spinner label={t('registration.loadingOptions')} />
                : <Button type="button" onClick={loadOptions}>{t('authResilience.retryRead')}</Button>}
              <Button type="button" variant="ghost" onClick={onBackToLogin}>{t('registration.backToLogin')}</Button>
            </div>
          )}
          {optionExpired && <Button type="button" onClick={onBackToLogin}>{t('registration.backToLogin')}</Button>}
          {options && !completed && (
            <form className="registration-form" onSubmit={submit}>
              <label><span>{t('registration.displayName')}</span><input name="displayName" autoComplete="name" maxLength={160} required disabled={action.busy} /></label>
              <label><span>{t('registration.organizationName')}</span><input name="organizationName" maxLength={200} required disabled={action.busy} /></label>
              <label><span>{t('registration.companyName')}</span><input name="companyName" maxLength={200} required disabled={action.busy} /></label>
              <label><span>{t('registration.timezone')}</span><select name="timezone" defaultValue={defaultTimezone} disabled={action.busy}>{options.timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></label>
              <label><span>{t('registration.baseCurrency')}</span><select name="baseCurrencyCode" defaultValue={defaultCurrency} disabled={action.busy}>{options.currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} — {localizedReferenceName(currency)}</option>)}</select></label>
              <label><span>{t('registration.interfaceLanguage')}</span><select value={locale} onChange={(event) => setLocale(resolveLocale(event.target.value))} disabled={action.busy}>{supportedLocales.map((item) => <option key={item} value={item}>{localeDetails[item].nativeName}</option>)}</select></label>
              <label><span>{t('registration.chartTemplate')}</span><select name="chartTemplateCode" defaultValue={defaultChart} disabled={action.busy}>{options.chartTemplates.map((template) => <option key={template.code} value={template.code}>{localizedReferenceName(template)}</option>)}</select></label>
              <label className="social-onboarding-consent"><input name="consent" type="checkbox" required disabled={action.busy} /><span>{t('socialOnboarding.consent')}</span></label>
              <div className="registration-actions social-onboarding-actions">
                <Button type="submit" disabled={action.busy}>{action.busy ? t('socialOnboarding.submitting') : t('socialOnboarding.submit')}</Button>
                <Button type="button" variant="ghost" disabled={action.busy} onClick={cancel}>{t('socialOnboarding.cancel')}</Button>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
