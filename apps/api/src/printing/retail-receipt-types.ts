import type { PrintSnapshot } from './print-types.js';

/** Internal Printing projection, NOT a public HTTP contract or a new archive. */
export type RetailReceiptPreview = {
  source: { salesInvoiceId: string; archiveId: string; archiveHash: string; archivedAt: string };
  company: { id: string; name: string };
  document: { id: string; type: 'SALES_INVOICE'; number: string; date: string; statusAtArchive: 'POSTED' };
  invoice: {
    currencyCode: string;
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    total: string;
    lines: Array<{
      number: number;
      itemCode: string | null;
      itemName: string | null;
      unitOfMeasureCode: string | null;
      description: string;
      quantity: string;
      unitPrice: string;
      discount: string;
      taxRate: string;
      tax: string;
      total: string;
    }>;
  };
  barcodeStatus: 'NOT_CAPTURED_IN_V1';
  pdfFormat: 'A4';
};

export type RetailReceiptStoredArchive = {
  id: string;
  companyId: string;
  accountingDocumentId: string;
  snapshotHash: string;
  snapshot: PrintSnapshot;
};

/** Printing-owned, existing rows only. Never create/backfill/refresh a snapshot here. */
export interface RetailReceiptArchiveReadPort {
  findExisting(companyId: bigint, accountingDocumentId: bigint): Promise<RetailReceiptStoredArchive | null>;
}
