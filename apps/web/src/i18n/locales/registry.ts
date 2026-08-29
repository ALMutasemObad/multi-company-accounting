export const localeRegistry = {
  ar: { nativeName: "العربية", dir: "rtl", intl: "ar-SA-u-nu-latn" },
  en: { nativeName: "English", dir: "ltr", intl: "en-US-u-nu-latn" },
  ur: { nativeName: "اردو", dir: "rtl", intl: "ur-PK-u-nu-latn" },
  hi: { nativeName: "हिंदी", dir: "ltr", intl: "hi-IN-u-nu-latn" },
} as const;

export type Locale = keyof typeof localeRegistry;
