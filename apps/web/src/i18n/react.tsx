import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { storageKey } from "../branding";
import { readLocalStorageItem, writeLocalStorageItem } from "../safe-local-storage";
import { createTranslator, type Locale, loadLocale, localeDetails, resolveLocale, setActiveLocale, supportedLocales } from "./core";

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

function storedLocale() {
  return resolveLocale(readLocalStorageItem(storageKey("locale")));
}

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, updateLocale] = useState<Locale>(() => initialLocale ?? storedLocale());
  const localeRequest = useRef(0);
  const details = localeDetails[locale];
  setActiveLocale(locale);

  const selectLocale = useCallback((next: Locale) => {
    const request = ++localeRequest.current;
    void loadLocale(next).then(() => {
      if (request !== localeRequest.current) return;
      writeLocalStorageItem(storageKey("locale"), next);
      updateLocale(next);
    }).catch((error: unknown) => {
      console.error("locale_dictionary_load_failed", error instanceof Error ? error.name : "UNKNOWN_ERROR");
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = details.dir;
  }, [details.dir, locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    dir: details.dir,
    intlLocale: details.intl,
    setLocale: selectLocale,
    t: createTranslator(locale),
    formatNumber: (number) => number.toLocaleString(details.intl),
    formatDateTime: (date) => new Date(date).toLocaleString(details.intl),
  }), [details.dir, details.intl, locale, selectLocale]);

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
