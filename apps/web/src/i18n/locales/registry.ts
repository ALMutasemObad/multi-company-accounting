import { ar } from "./ar";
import { en } from "./en";

export const localeRegistry = {
  ar: { nativeName: "العربية", dir: "rtl", intl: "ar-SA", messages: ar },
  en: { nativeName: "English", dir: "ltr", intl: "en-US", messages: en },
} as const;

export type Locale = keyof typeof localeRegistry;
