/** Internal Printing projection, not a new archive or the complete PrintSnapshot. */
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
  // A database JSON value is not proof that the snapshot has a supported shape.
  snapshot: unknown;
};

/** Printing-owned, existing rows only. Never create/backfill/refresh a snapshot here. */
export interface RetailReceiptArchiveReadPort {
  findExisting(companyId: bigint, accountingDocumentId: bigint): Promise<RetailReceiptStoredArchive | null>;
}
