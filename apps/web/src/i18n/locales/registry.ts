import { localeManifest } from "virtual:locale-manifest";
import type { LocaleMetadata } from "../locale-definition";

export type Locale = string;

export const localeRegistry: Readonly<Record<Locale, LocaleMetadata>> = Object.freeze(Object.fromEntries(
  localeManifest.map(({ modulePath: _modulePath, ...metadata }) => [metadata.code, Object.freeze(metadata)]),
));
