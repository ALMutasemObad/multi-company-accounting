export { activeIntlLocale, createTranslator, dictionaryFor, hasTranslation, loadLocale, localeDetails, localizedReferenceName, resolveLocale, supportedLocales, translate } from "./core";
export type { Locale, TranslationKey, TranslationValues } from "./core";
export { localizedCopyFor, localizedCopyMap, resolveLegacyCopyLocale, resolveLocalizedCopyLocale } from "./locale-definition";
export type { LegacyCopyLocale } from "./locale-definition";
export { I18nProvider, LanguageSwitcher, useI18n } from "./react";
