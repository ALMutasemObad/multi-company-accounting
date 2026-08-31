import { snapshotHashMatches } from './print-archive.js';
import type { RetailReceiptPreview, RetailReceiptStoredArchive } from './retail-receipt-types.js';

export const RETAIL_RECEIPT_PERMISSION = 'sales_invoices.print' as const;
// Matches the current POS checkout line bound. Never silently truncate a receipt.
export const RETAIL_RECEIPT_MAX_LINES = 50;
export type RetailReceiptErrorReason = 'NOT_FOUND' | 'ARCHIVE_NOT_AVAILABLE'
  | 'ARCHIVE_INTEGRITY_FAILED' | 'RECEIPT_PREVIEW_UNSUPPORTED' | 'RECEIPT_PREVIEW_LIMIT_EXCEEDED';
export class RetailReceiptError extends Error {
  constructor(public readonly reason: RetailReceiptErrorReason) { super(reason); }
}

const decimalText = (value: string): string => {
  if (typeof value !== 'string' || value.length > 80 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    throw new RetailReceiptError('RECEIPT_PREVIEW_UNSUPPORTED');
  }
  return value; // No conversion, rounding, grouping, arithmetic or trailing-zero removal.
};
const text = (value: string): string => {
  if (typeof value !== 'string' || value.length > 2048) throw new RetailReceiptError('RECEIPT_PREVIEW_UNSUPPORTED');
  return value;
};

export function projectRetailReceipt(
  archive: RetailReceiptStoredArchive,
  scope: { companyId: bigint; accountingDocumentId: bigint; salesInvoiceId: bigint },
): RetailReceiptPreview {
  const snapshot = archive.snapshot;
  if (archive.companyId !== scope.companyId.toString() || snapshot.company.id !== scope.companyId.toString()
    || archive.accountingDocumentId !== scope.accountingDocumentId.toString()
    || snapshot.document.id !== scope.accountingDocumentId.toString()) throw new RetailReceiptError('NOT_FOUND');
  if (!snapshotHashMatches(snapshot, archive.snapshotHash)) throw new RetailReceiptError('ARCHIVE_INTEGRITY_FAILED');
  if (snapshot.formatVersion !== 1 || snapshot.document.type !== 'SALES_INVOICE'
    || snapshot.document.statusAtArchive !== 'POSTED' || !snapshot.invoice || snapshot.settlement !== null) {
    throw new RetailReceiptError('RECEIPT_PREVIEW_UNSUPPORTED');
  }
  const invoice = snapshot.invoice;
  if (!Array.isArray(invoice.lines) || invoice.lines.length === 0 || invoice.lines.length > RETAIL_RECEIPT_MAX_LINES) {
    throw new RetailReceiptError('RECEIPT_PREVIEW_LIMIT_EXCEEDED');
  }
  const { subtotal, discountTotal, taxTotal, total } = invoice;
  return {
    source: { salesInvoiceId: scope.salesInvoiceId.toString(), archiveId: archive.id,
      archiveHash: archive.snapshotHash, archivedAt: snapshot.archivedAt },
    company: { id: snapshot.company.id, name: text(snapshot.company.name) },
    document: { id: snapshot.document.id, type: 'SALES_INVOICE', number: text(snapshot.document.number),
      date: text(snapshot.document.date), statusAtArchive: 'POSTED' },
    invoice: {
      currencyCode: text(invoice.currencyCode), subtotal: decimalText(subtotal), discountTotal: decimalText(discountTotal),
      taxTotal: decimalText(taxTotal), total: decimalText(total),
      lines: invoice.lines.map(line => ({
        number: line.number, itemCode: line.itemCode == null ? null : text(line.itemCode),
        itemName: line.itemName == null ? null : text(line.itemName),
        unitOfMeasureCode: line.unitOfMeasureCode == null ? null : text(line.unitOfMeasureCode),
        description: text(line.description), quantity: decimalText(line.quantity), unitPrice: decimalText(line.unitPrice),
        discount: decimalText(line.discount), taxRate: decimalText(line.taxRate), tax: decimalText(line.tax), total: decimalText(line.total),
      })),
    },
    barcodeStatus: 'NOT_CAPTURED_IN_V1', pdfFormat: 'A4',
  };
}
