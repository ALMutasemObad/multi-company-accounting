import { localeManifest } from "virtual:locale-manifest";
import type { LocaleDefinition } from "./locale-definition";
import { localeRegistry, type Locale } from "./locales/registry";
import type { localeDictionary as arabicDictionary } from "./locales/ar.locale";

export type { Locale } from "./locales/registry";
export type TranslationKey = keyof typeof arabicDictionary;
export type TranslationValues = Record<string, string | number>;
type Dictionary = Record<TranslationKey, string>;

export const supportedLocales = localeManifest.map(({ code }) => code);
export const localeDetails = Object.fromEntries(supportedLocales.map((locale) => [locale, {
  nativeName: localeRegistry[locale].nativeName,
  dir: localeRegistry[locale].dir,
  intl: localeRegistry[locale].intl,
}])) as Readonly<Record<Locale, { nativeName: string; dir: "rtl" | "ltr"; intl: string }>>;

type LocaleModule = { default: LocaleDefinition<Dictionary> };
const discoveredLocaleModules = import.meta.glob<LocaleModule>("./locales/*.locale.ts");
const dictionaryLoaders = Object.fromEntries(localeManifest.map(({ code, modulePath }) => {
  const loadModule = discoveredLocaleModules[modulePath];
  if (!loadModule) throw new Error(`Locale manifest points to a missing module: ${modulePath}`);
  return [code, async () => {
    const definition = (await loadModule()).default;
    if (definition.metadata.code !== code) throw new Error(`Locale module metadata changed after build: ${code}`);
    return definition.dictionary;
  }];
})) as Record<Locale, () => Promise<Dictionary>>;
const dictionaries: Partial<Record<Locale, Dictionary>> = {};
const dictionaryLoads = new Map<Locale, Promise<void>>();

export async function loadLocale(locale: Locale) {
  if (dictionaries[locale]) return;
  const loader = dictionaryLoaders[locale];
  if (!loader) throw new Error(`Locale is not available: ${locale}`);
  const existing = dictionaryLoads.get(locale);
  if (existing) return existing;
  const pending = loader().then((dictionary) => {
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
  if (!value) return "ar";
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    return canonical && Object.hasOwn(localeRegistry, canonical) ? canonical : "ar";
  } catch {
    return "ar";
  }
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
