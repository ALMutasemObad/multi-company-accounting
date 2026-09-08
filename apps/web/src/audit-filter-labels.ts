import {
  hasTranslation,
  translate as t,
  type TranslationKey,
} from "./i18n";

export type AuditFilterScope = "action" | "entity";
type Translate = (key: TranslationKey) => string;

const preservedAcronyms = new Set(["API", "CSV", "FX", "ID", "PDF", "POS"]);

export function readableAuditCode(code: string) {
  const words = code.trim().split(/[^A-Za-z0-9]+/u).filter(Boolean);
  return words.map((word, index) => {
    const upper = word.toUpperCase();
    if (preservedAcronyms.has(upper)) return upper;
    const lower = word.toLowerCase();
    return index === 0 ? `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}` : lower;
  }).join(" ");
}

export function auditFilterLabel(scope: AuditFilterScope, code: string, translate: Translate = t) {
  const normalized = code.trim();
  const key = `audit.${scope}.${normalized}`;
  if (normalized && hasTranslation(key)) return translate(key);
  const unknownKey = scope === "action" ? "audit.unknownAction" : "audit.unknownEntity";
  const readable = readableAuditCode(normalized);
  return readable ? `${translate(unknownKey)} — ${readable}` : translate(unknownKey);
}
