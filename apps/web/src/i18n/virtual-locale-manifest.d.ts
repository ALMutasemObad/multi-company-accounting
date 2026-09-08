declare module "virtual:locale-manifest" {
  import type { LocaleMetadata } from "./locale-definition";

  export type LocaleManifestEntry = LocaleMetadata & { modulePath: string };
  export const localeManifest: readonly LocaleManifestEntry[];
}
