export const supportedLocales = ['ar', 'en', 'ur', 'hi'] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

export function resolveSupportedLocale(value: string): SupportedLocale {
  return supportedLocales.includes(value as SupportedLocale) ? value as SupportedLocale : 'ar';
}
