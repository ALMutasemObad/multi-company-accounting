export const localeRegistry = {
  ar: { nativeName: "العربية", dir: "rtl", intl: "ar-SA" },
  en: { nativeName: "English", dir: "ltr", intl: "en-US" },
  ur: { nativeName: "اردو", dir: "rtl", intl: "ur-PK" },
  hi: { nativeName: "हिंदी", dir: "ltr", intl: "hi-IN" },
} as const;

export type Locale = keyof typeof localeRegistry;
