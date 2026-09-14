import type { OutputDirection } from "./model.js";

const arabicDigits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"] as const;

export function containsArabic(value: string) {
  return /[\u0600-\u06ff]/u.test(value);
}

/**
 * Keeps RTL text deterministic for the PDF font/profile, including embedded
 * latin digits and punctuation. LTR values are returned unchanged.
 */
export function prepareBidiText(value: string, direction: OutputDirection = "RTL") {
  if (direction === "LTR" || !containsArabic(value)) return value;
  return value
    .replace(/[0-9]+/gu, (digits) => [...digits].reverse().map((digit) => arabicDigits[digit.charCodeAt(0) - 48]!).join(""))
    .replaceAll("%", "بالمائة")
    .replace(/[—:-]/gu, "،");
}
