import type { RetailReceiptAccess, RetailReceiptPreview } from './retail-receipt-model';

export const retailReceiptAccessFixture = (): RetailReceiptAccess => ({
  userId: '9', companyId: '1', permissionSet: new Set(['pos.view', 'sales_invoices.print']),
  moduleSet: new Set(['POS', 'SALES']),
});

/** Synthetic presentation fixture; all decimal literals fit their schema precision.
 * This is not a posting fixture and the UI must not recalculate its archived values. */
export const retailReceiptPreviewFixture = (): RetailReceiptPreview => ({
  source: { salesInvoiceId: '42', archiveId: '9007199254740993001',
    archiveHash: 'a'.repeat(64), archivedAt: '2026-08-31T09:00:00.000Z' },
  company: { id: '1', name: 'بقالة جوار - Jawar 2026' },
  document: { id: '118', type: 'SALES_INVOICE', number: 'INV-2026-000000000000000118',
    date: '2026-08-31', statusAtArchive: 'POSTED' },
  invoice: {
    currencyCode: 'SAR', subtotal: '123456789012345.6789', discountTotal: '0.0000',
    taxTotal: '1.2345', total: '123456789012346.9134',
    lines: [{ number: 1, itemCode: 'ITM-000000000001', itemName: 'حليب كامل الدسم Fresh Milk 123',
      unitOfMeasureCode: 'EA', description: 'عبوة عائلية 1 L', quantity: '1234567890123.123456',
      unitPrice: '123456789012345.6789', discount: '0.0000', taxRate: '15.0000', tax: '1.2345', total: '12.3456' }],
  },
  barcodeStatus: 'NOT_CAPTURED_IN_V1', pdfFormat: 'A4', posContext: { userId: '9', companyId: '1' },
});

export function receiptDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
