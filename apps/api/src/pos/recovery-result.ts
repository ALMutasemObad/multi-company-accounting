import type { PosRecoveryResult } from "./recovery-types.js";
import { completePosCheckout201ResponseSchema } from "../generated/openapi-request-guards.js";

/** This projects the original committed command acknowledgement, not current document status.
 * Explicit projection excludes accidental credentials/correlation or future extra fields.
 */
export function readPosRecoveryResult(input: unknown): PosRecoveryResult | null {
  const parsed = completePosCheckout201ResponseSchema.safeParse(input);
  if (!parsed.success) return null;
  const value = parsed.data;
  const { invoice, receipt } = value;
  // Storage evidence must fit the database identity domain as well as the wire contract.
  const identities = [value.id, invoice.id, receipt.id, ...invoice.generatedJournalEntryIds, ...receipt.generatedJournalEntryIds];
  if (identities.some(identity => BigInt(identity) > 18446744073709551615n)
    || new Date(value.completedAt).toISOString() !== value.completedAt
    || !invoice.documentNumber.trim() || !receipt.documentNumber.trim() || !invoice.customerName.trim()) return null;
  return {
    id: value.id, completedAt: value.completedAt,
    invoice: { id: invoice.id, documentNumber: invoice.documentNumber, status: "POSTED",
      customerName: invoice.customerName, total: invoice.total, baseTotal: invoice.baseTotal,
      generatedJournalEntryIds: [...invoice.generatedJournalEntryIds] },
    receipt: { id: receipt.id, documentNumber: receipt.documentNumber, status: "POSTED",
      generatedJournalEntryIds: [...receipt.generatedJournalEntryIds] },
  };
}
