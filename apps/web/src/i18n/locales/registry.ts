import { ar } from "./ar";
import { en } from "./en";
import { hi } from "./hi";
import { ur } from "./ur";

export const localeRegistry = {
  ar: { nativeName: "العربية", dir: "rtl", intl: "ar-SA", messages: ar },
  en: { nativeName: "English", dir: "ltr", intl: "en-US", messages: en },
  ur: { nativeName: "اردو", dir: "rtl", intl: "ur-PK", messages: ur },
  hi: { nativeName: "हिंदी", dir: "ltr", intl: "hi-IN", messages: hi },
} as const;

export type Locale = keyof typeof localeRegistry;
