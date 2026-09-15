import type { OutputDirection } from "./model.js";

export function containsArabic(value: string) {
  return /[\u0600-\u06ff]/u.test(value);
}

/**
 * Bidi direction is a presentation concern. Values remain byte-for-byte
 * unchanged so account numbers, amounts, percentages, and document IDs keep
 * their semantic meaning in every output profile.
 */
export function prepareBidiText(value: string, _direction: OutputDirection = "RTL") {
  return value;
}
