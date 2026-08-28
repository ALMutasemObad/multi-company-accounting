import { localeRegistry, type Locale } from "./locales/registry";
import type { ar } from "./locales/ar";

export type { Locale } from "./locales/registry";
export type TranslationKey = keyof typeof ar;
export type TranslationValues = Record<string, string | number>;
type Dictionary = Record<TranslationKey, string>;

export const supportedLocales = Object.keys(localeRegistry) as Locale[];
export const localeDetails = Object.fromEntries(supportedLocales.map((locale) => [locale, {
  nativeName: localeRegistry[locale].nativeName,
  dir: localeRegistry[locale].dir,
  intl: localeRegistry[locale].intl,
}])) as Record<Locale, { nativeName: string; dir: "rtl" | "ltr"; intl: string }>;

const dictionaryLoaders: Record<Locale, () => Promise<Dictionary>> = {
  ar: async () => (await import("./locales/ar")).ar,
  en: async () => (await import("./locales/en")).en,
  ur: async () => (await import("./locales/ur")).ur,
  hi: async () => (await import("./locales/hi")).hi,
};
const dictionaries: Partial<Record<Locale, Dictionary>> = {};
const dictionaryLoads = new Map<Locale, Promise<void>>();

export async function loadLocale(locale: Locale) {
  if (dictionaries[locale]) return;
  const existing = dictionaryLoads.get(locale);
  if (existing) return existing;
  const pending = dictionaryLoaders[locale]().then((dictionary) => {
    dictionaries[locale] = dictionary;
  }).finally(() => {
    dictionaryLoads.delete(locale);
  });
  dictionaryLoads.set(locale, pending);
  return pending;
}

export function dictionaryFor(locale: Locale): Readonly<Dictionary> {
  const dictionary = dictionaries[locale];
  if (!dictionary) throw new Error(`Locale dictionary is not loaded: ${locale}`);
  return dictionary;
}

export function hasTranslation(key: string): key is TranslationKey {
  return Object.hasOwn(dictionaryFor("ar"), key);
}

let activeLocale: Locale = "ar";

export function resolveLocale(value: string | null | undefined): Locale {
  return value && Object.hasOwn(localeRegistry, value) ? value as Locale : "ar";
}

export function createTranslator(locale: Locale) {
  return (key: TranslationKey, values: TranslationValues = {}) => {
    const fallback = dictionaryFor("ar");
    const template = (dictionaries[locale] ?? fallback)[key] ?? fallback[key];
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
