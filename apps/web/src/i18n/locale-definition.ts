export type LocaleDirection = "ltr" | "rtl";

export type LocaleMetadata = {
  code: string;
  nativeName: string;
  dir: LocaleDirection;
  intl: string;
};

export type LocaleDefinition<Dictionary extends Record<string, string> = Record<string, string>> = {
  metadata: LocaleMetadata;
  dictionary: Dictionary;
};

export function resolveLocalizedCopyLocale<Copies extends Readonly<Record<string, unknown>>>(
  copies: Copies,
  locale: string,
  fallback: keyof Copies & string,
): keyof Copies & string {
  const candidates = [locale];
  try {
    const [canonical] = Intl.getCanonicalLocales(locale);
    if (canonical) candidates.push(canonical, new Intl.Locale(canonical).language);
  } catch {
    // Invalid external values always use the explicit fallback below.
  }
  return (candidates.find((candidate) => Object.hasOwn(copies, candidate)) as keyof Copies & string | undefined) ?? fallback;
}

export function localizedCopyFor<Copies extends Readonly<Record<string, unknown>>>(
  copies: Copies,
  locale: string,
  fallback: keyof Copies & string,
): Copies[keyof Copies] {
  return copies[resolveLocalizedCopyLocale(copies, locale, fallback)];
}

export function localizedCopyMap<Copies extends Readonly<Record<string, unknown>>>(
  copies: Copies,
  fallback: keyof Copies & string,
): Readonly<Record<string, Copies[keyof Copies]>> {
  return new Proxy(copies as Readonly<Record<string, Copies[keyof Copies]>>, {
    get(target, property, receiver) {
      if (typeof property !== "string" || Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      return localizedCopyFor(copies, property, fallback);
    },
  });
}

export type LegacyCopyLocale = "ar" | "en" | "hi" | "ur";
const legacyCopyLocales: Readonly<Record<LegacyCopyLocale, true>> = { ar: true, en: true, hi: true, ur: true };

export function resolveLegacyCopyLocale(locale: string): LegacyCopyLocale {
  return resolveLocalizedCopyLocale(legacyCopyLocales, locale, "ar");
}
