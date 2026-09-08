/** Locales with first-party email copy. UI locale availability is discovered by the web build. */
export const emailTemplateLocales = ['ar', 'en', 'ur', 'hi'] as const;

export type SupportedLocale = string;
export type EmailTemplateLocale = (typeof emailTemplateLocales)[number];

export function resolveSupportedLocale(value: string): SupportedLocale {
  return normalizeSupportedLocale(value) ?? 'ar';
}

export function normalizeSupportedLocale(value: string): SupportedLocale | null {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 35 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(trimmed)) return null;
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null;
  } catch {
    return null;
  }
}

export function resolveEmailTemplateLocale(value: string): EmailTemplateLocale {
  const canonical = normalizeSupportedLocale(value);
  if (!canonical) return 'ar';
  const exact = emailTemplateLocales.find((locale) => locale === canonical);
  if (exact) return exact;
  const baseLanguage = new Intl.Locale(canonical).language;
  return emailTemplateLocales.find((locale) => locale === baseLanguage) ?? 'ar';
}
