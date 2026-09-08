declare module "virtual:locale-manifest" {
  export type LocaleManifestEntry = {
    code: string;
    nativeName: string;
    dir: "rtl" | "ltr";
    intl: string;
    modulePath: string;
  };
  export const localeManifest: readonly LocaleManifestEntry[];
}
