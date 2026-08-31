import type { PrintSnapshot } from "../../src/printing/print-types.js";
import { printSnapshotFixture } from "./print-snapshot.js";

export const identityWords = ["اسم", "وصف", "قيد", "سند"] as const;
export const identityWordOrder = Array.from({ length: 125 }, (_, index) => (index + Math.floor(index / 4) + Math.floor(index / 13)) % 4);
export const identityAmounts = ["1.0001", "2.0002", "12,345.6789", "54,321.9876", "98,765.4321", "6.6666", "7.0007", "8.0008"] as const;
export const targetReference = "القيد 65535، 2026-12-30";
export const followingReference = "القيد 7، 2026-12-31";

/**
 * Synthetic printing-only data. The initial short entry calibrates the four word
 * CID signatures and both references inside this same PDF and embedded font.
 * No Arabic ToUnicode decoding or cross-PDF CID assumptions are required.
 */
export function pdfJournalIdentitySnapshot(): PrintSnapshot {
  const snapshot = structuredClone(printSnapshotFixture);
  snapshot.document = { ...snapshot.document, type: "MANUAL_JOURNAL", number: "JRN-IDENTITY-2026", description: "اختبار وصف هوية القيد المؤرشف" };
  snapshot.settlement = null;
  const line = snapshot.entries[0]!.lines[0]!;
  snapshot.entries = [
    {
      number: 41, date: "2026-12-29",
      description: "\n" + [...identityWords, `${targetReference}، `, targetReference, `${followingReference}، `, followingReference].join("\n"),
      lines: [{ ...line, accountCode: "CAL", accountName: "معايرة", debit: "1.0001", credit: "2.0002" }],
    },
    {
      number: 65535, date: "2026-12-30",
      description: "\n" + identityWordOrder.map((index) => identityWords[index]!).join("\n"),
      lines: [
        { ...line, accountCode: "FIRST", accountName: "ح\n".repeat(80), debit: "12345.6789", credit: "54321.9876" },
        { ...line, number: 2, accountCode: "LAST", accountName: "حساب أخير", debit: "98765.4321", credit: "6.6666" },
      ],
    },
    {
      number: 7, date: "2026-12-31", description: "\nسند",
      lines: [{ ...line, accountCode: "AFTER", accountName: "القيد التالي", debit: "7.0007", credit: "8.0008" }],
    },
  ];
  return snapshot;
}

export function pdfJournalBlankIdentitySnapshot(): PrintSnapshot {
  const snapshot = pdfJournalIdentitySnapshot();
  // 60 visible words and 59 blank lines: 417 characters, within VARCHAR(500).
  snapshot.entries[1]!.description = "\n" + Array.from({ length: 60 }, () => "وصف").join("\r\n\r\n");
  return snapshot;
}

export function pdfJournalShapedIdentitySnapshot(): PrintSnapshot {
  const snapshot = pdfJournalIdentitySnapshot();
  snapshot.entries[1]!.description = "\n" + Array.from({ length: 50 }, () => "قَيْدٌ").join("\n");
  return snapshot;
}

export function pdfJournalShortIdentitySnapshot(): PrintSnapshot {
  const snapshot = pdfJournalIdentitySnapshot();
  snapshot.entries[1]!.description = "\n" + identityWords.join("\n");
  snapshot.entries[1]!.lines[0]!.accountName = "حساب";
  return snapshot;
}
