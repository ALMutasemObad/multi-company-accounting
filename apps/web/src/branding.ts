/// <reference types="vite/client" />

const configured = (value: string | undefined, fallback: string) => value?.trim() || fallback;

export const productName = configured(
  import.meta.env.VITE_APP_NAME,
  "النظام المحاسبي متعدد الشركات",
);

export const productShortName = configured(
  import.meta.env.VITE_APP_SHORT_NAME,
  "منصة المحاسبة",
);

export const productMark = configured(import.meta.env.VITE_APP_MARK, "م").slice(0, 2);

export const storageKey = (name: string) => `mcap.${name}`;
