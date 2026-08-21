import { localeRegistry, type Locale } from "./locales/registry";

export type { Locale } from "./locales/registry";
export type TranslationKey = keyof typeof localeRegistry.ar.messages;
export type TranslationValues = Record<string, string | number>;

export const supportedLocales = Object.keys(localeRegistry) as Locale[];
export const localeDetails = Object.fromEntries(supportedLocales.map((locale) => [locale, {
  nativeName: localeRegistry[locale].nativeName,
  dir: localeRegistry[locale].dir,
  intl: localeRegistry[locale].intl,
}])) as Record<Locale, { nativeName: string; dir: "rtl" | "ltr"; intl: string }>;

export const dictionaries = Object.fromEntries(supportedLocales.map((locale) => [
  locale,
  localeRegistry[locale].messages,
])) as Record<Locale, Record<TranslationKey, string>>;

let activeLocale: Locale = "ar";

export function resolveLocale(value: string | null | undefined): Locale {
  return value && Object.hasOwn(localeRegistry, value) ? value as Locale : "ar";
}

export function createTranslator(locale: Locale) {
  return (key: TranslationKey, values: TranslationValues = {}) => {
    const template = dictionaries[locale][key] ?? dictionaries.ar[key];
    return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (match, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
    );
  };
}

export function setActiveLocale(locale: Locale) {
  activeLocale = locale;
}

export function translate(key: TranslationKey, values: TranslationValues = {}) {
  return createTranslator(activeLocale)(key, values);
}

export function activeIntlLocale() {
  return localeDetails[activeLocale].intl;
}

export function localizedReferenceName(value: {
  nameAr: string;
  nameEn?: string | null;
  names?: Partial<Record<string, string | null | undefined>>;
} | null | undefined) {
  if (!value) return "";
  const localized = value.names?.[activeLocale]?.trim();
  if (localized) return localized;
  return activeLocale === "en" && value.nameEn?.trim() ? value.nameEn : value.nameAr;
}
