/// <reference types="vite/client" />

type BrandKey = "branding.name" | "branding.shortName" | "branding.mark";

const configured = (value: string | undefined) => value?.trim() || undefined;

const overrides = {
  name: configured(import.meta.env.VITE_APP_NAME),
  shortName: configured(import.meta.env.VITE_APP_SHORT_NAME),
  mark: configured(import.meta.env.VITE_APP_MARK),
};

export function localizedBrand(t: (key: BrandKey) => string) {
  return {
    name: overrides.name ?? t("branding.name"),
    shortName: overrides.shortName ?? t("branding.shortName"),
    mark: (overrides.mark ?? t("branding.mark")).slice(0, 2),
  };
}

export const storageKey = (name: string) => `mcap.${name}`;
