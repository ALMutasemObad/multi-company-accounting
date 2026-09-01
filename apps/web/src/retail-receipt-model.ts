import type { GetRetailReceiptPreview200Response } from '../../api/src/generated/openapi-request-guards';
import { canonicalPosId, hasExpectedPosContext, type PosExpectedContext } from './pos-scope-transport';

/** Public OpenAPI response only; no dependency on the Printing snapshot or domain DTO. */
export type RetailReceiptPreview = GetRetailReceiptPreview200Response;
export type RetailReceiptPaperWidth = 58 | 80;
export const retailReceiptPaperWidths = [58, 80] as const;

export type RetailReceiptAccess = {
  userId: string;
  companyId: string | null;
  permissionSet: ReadonlySet<string>;
  moduleSet: ReadonlySet<string>;
};

/** UI gate only. The HTTP owner independently authorizes the authenticated Actor. */
export function canPreviewRetailReceipt(access: RetailReceiptAccess, salesInvoiceId: string | null) {
  return canonicalPosId(access.userId) && canonicalPosId(access.companyId) && canonicalPosId(salesInvoiceId)
    && access.permissionSet.has('sales_invoices.print') && access.permissionSet.has('pos.view')
    && access.moduleSet.has('SALES') && access.moduleSet.has('POS');
}

export function retailReceiptScopeKey(access: RetailReceiptAccess, salesInvoiceId: string | null) {
  return JSON.stringify([access.userId, access.companyId, salesInvoiceId,
    [...access.permissionSet].sort(), [...access.moduleSet].sort()]);
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Identity check complements N2's envelope check; it does not infer current payment status. */
export function hasExpectedRetailReceiptSource(result: unknown, expected: PosExpectedContext, salesInvoiceId: string) {
  if (!record(result) || !hasExpectedPosContext(result, expected)
    || !record(result.company) || !record(result.source) || !record(result.document)) return false;
  return result.company.id === expected.companyId && result.source.salesInvoiceId === salesInvoiceId
    && result.document.type === 'SALES_INVOICE' && result.document.statusAtArchive === 'POSTED'
    && result.pdfFormat === 'A4' && result.barcodeStatus === 'NOT_CAPTURED_IN_V1';
}

export type RetailReceiptReader = (salesInvoiceId: string, signal: AbortSignal) => Promise<RetailReceiptPreview>;
export type RetailReceiptA4Downloader = (salesInvoiceId: string, signal: AbortSignal) => Promise<void>;

export async function readRetailReceiptPreview(
  access: RetailReceiptAccess, salesInvoiceId: string, signal: AbortSignal, reader: RetailReceiptReader,
) {
  if (signal.aborted || !canPreviewRetailReceipt(access, salesInvoiceId)) return null;
  const result = await reader(salesInvoiceId, signal);
  if (signal.aborted) return null;
  if (!hasExpectedRetailReceiptSource(result, { userId: access.userId, companyId: access.companyId! }, salesInvoiceId)) {
    throw new Error('RETAIL_RECEIPT_SOURCE_MISMATCH');
  }
  return result;
}

/** Uses the Sales entity id, NEVER the AccountingDocument id or archive id. */
export function retailReceiptA4Path(salesInvoiceId: string) {
  if (!canonicalPosId(salesInvoiceId)) throw new Error('RETAIL_RECEIPT_INVALID_INVOICE');
  return `/sales-invoices/${salesInvoiceId}/pdf`;
}

export function retailReceiptPreviewPath(salesInvoiceId: string) {
  if (!canonicalPosId(salesInvoiceId)) throw new Error('RETAIL_RECEIPT_INVALID_INVOICE');
  return `/sales-invoices/${salesInvoiceId}/receipt-preview`;
}
