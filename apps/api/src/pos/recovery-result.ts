import type { PosRecoveryResult } from "./recovery-types.js";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,19}$/.test(value)
  && BigInt(value) <= 18446744073709551615n;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 500;
const amount = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,14})\.\d{4}$/.test(value);
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(id);

/** This projects the original committed command acknowledgement, not current document status.
 * Explicit projection excludes accidental credentials/correlation or future extra fields.
 */
export function readPosRecoveryResult(value: unknown): PosRecoveryResult | null {
  if (!record(value) || !id(value.id) || typeof value.completedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.completedAt)
    || !Number.isFinite(Date.parse(value.completedAt)) || new Date(value.completedAt).toISOString() !== value.completedAt) return null;
  const invoice = value.invoice; const receipt = value.receipt;
  if (!record(invoice) || !record(receipt) || !id(invoice.id) || !id(receipt.id)
    || !text(invoice.documentNumber) || !text(receipt.documentNumber)
    || invoice.status !== "POSTED" || receipt.status !== "POSTED" || !text(invoice.customerName)
    || !amount(invoice.total) || !amount(invoice.baseTotal)
    || !ids(invoice.generatedJournalEntryIds) || !ids(receipt.generatedJournalEntryIds)) return null;
  return {
    id: value.id, completedAt: value.completedAt,
    invoice: { id: invoice.id, documentNumber: invoice.documentNumber, status: "POSTED",
      customerName: invoice.customerName, total: invoice.total, baseTotal: invoice.baseTotal,
      generatedJournalEntryIds: [...invoice.generatedJournalEntryIds] },
    receipt: { id: receipt.id, documentNumber: receipt.documentNumber, status: "POSTED",
      generatedJournalEntryIds: [...receipt.generatedJournalEntryIds] },
  };
}
