// Type-only internal seam until the coordinator approves a generated HTTP contract.
import type { RetailReceiptPreview } from '../../api/src/printing/retail-receipt-types';
export type { RetailReceiptPreview };
export type RetailReceiptPaperWidth = 58 | 80;
export const retailReceiptPaperWidths = [58, 80] as const;

export type RetailReceiptAccess = {
  userId: string;
  companyId: string | null;
  permissionSet: ReadonlySet<string>;
  moduleSet: ReadonlySet<string>;
};
const positiveId = (value: string | null) => typeof value === 'string' && /^[1-9]\d*$/u.test(value);

/** UI gate only; the eventual API MUST authorize sales_invoices.print again. */
export function canPreviewRetailReceipt(access: RetailReceiptAccess, salesInvoiceId: string | null) {
  return positiveId(access.userId) && positiveId(access.companyId) && positiveId(salesInvoiceId)
    && access.permissionSet.has('sales_invoices.print') && access.permissionSet.has('pos.view')
    && access.moduleSet.has('SALES') && access.moduleSet.has('POS');
}

export function retailReceiptScopeKey(access: RetailReceiptAccess, salesInvoiceId: string | null) {
  return JSON.stringify([access.userId, access.companyId, salesInvoiceId,
    [...access.permissionSet].sort(), [...access.moduleSet].sort()]);
}

export type RetailReceiptReader = (salesInvoiceId: string, signal: AbortSignal) => Promise<RetailReceiptPreview>;

export async function readRetailReceiptPreview(
  access: RetailReceiptAccess, salesInvoiceId: string, signal: AbortSignal, reader: RetailReceiptReader,
) {
  if (signal.aborted || !canPreviewRetailReceipt(access, salesInvoiceId)) return null;
  const result = await reader(salesInvoiceId, signal);
  if (signal.aborted) return null;
  if (result.company.id !== access.companyId || result.source.salesInvoiceId !== salesInvoiceId
    || result.document.type !== 'SALES_INVOICE' || result.document.statusAtArchive !== 'POSTED'
    || result.pdfFormat !== 'A4' || result.barcodeStatus !== 'NOT_CAPTURED_IN_V1') throw new Error('RETAIL_RECEIPT_SOURCE_MISMATCH');
  return result;
}

/** Uses the Sales entity id, NEVER the AccountingDocument id or archive id. */
export function retailReceiptA4Path(salesInvoiceId: string) {
  if (!positiveId(salesInvoiceId)) throw new Error('RETAIL_RECEIPT_INVALID_INVOICE');
  return `/sales-invoices/${salesInvoiceId}/pdf`;
}
