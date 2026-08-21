import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { storageKey } from "../branding";
import { createTranslator, type Locale, localeDetails, resolveLocale, setActiveLocale, supportedLocales } from "./core";

type I18nContextValue = {
  locale: Locale;
  dir: "rtl" | "ltr";
  intlLocale: string;
  setLocale: (locale: Locale) => void;
  t: ReturnType<typeof createTranslator>;
  formatNumber: (value: number) => string;
  formatDateTime: (value: string | Date) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale() {
  if (typeof window === "undefined") return "ar";
  return resolveLocale(window.localStorage.getItem(storageKey("locale")));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  const details = localeDetails[locale];
  setActiveLocale(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = details.dir;
  }, [details.dir, locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    dir: details.dir,
    intlLocale: details.intl,
    setLocale: (next) => {
      window.localStorage.setItem(storageKey("locale"), next);
      updateLocale(next);
    },
    t: createTranslator(locale),
    formatNumber: (number) => number.toLocaleString(details.intl),
    formatDateTime: (date) => new Date(date).toLocaleString(details.intl),
  }), [details.dir, details.intl, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`language-switcher${compact ? " compact" : ""}`}>
      <span className="sr-only">{t("language.label")}</span>
      <select aria-label={t("language.label")} value={locale} onChange={(event) => setLocale(resolveLocale(event.target.value))}>
        {supportedLocales.map((supportedLocale) => (
          <option key={supportedLocale} value={supportedLocale}>{localeDetails[supportedLocale].nativeName}</option>
        ))}
      </select>
    </label>
  );
}
