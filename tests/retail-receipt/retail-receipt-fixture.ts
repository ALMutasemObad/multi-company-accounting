import type { RetailReceiptPreview } from '../../apps/web/src/retail-receipt-model';

/** Synthetic browser fixture only. Not a server archive, fiscal invoice or payment. */
export const receiptFixture: RetailReceiptPreview = {
  source: { salesInvoiceId: '42', archiveId: '9007199254740993001', archiveHash: 'abcd'.repeat(16), archivedAt: '2026-08-31T10:30:00.000Z' },
  company: { id: '1', name: 'بقالة جوار - Jawar 2026' },
  document: { id: '118', type: 'SALES_INVOICE', number: 'INV-2026-000000000000000118', date: '2026-08-31', statusAtArchive: 'POSTED' },
  invoice: { currencyCode: 'SAR', subtotal: '9007199254740993.1234', discountTotal: '0.0000', taxTotal: '1.2345', total: '9007199254740994.3579',
    lines: [{ number: 1, itemCode: 'ITM-000000000001', itemName: 'حليب كامل الدسم Fresh Milk 123', unitOfMeasureCode: 'EA', description: 'عبوة عائلية 1 L',
      quantity: '1234567890123.123456', unitPrice: '123456789012345.6789', discount: '0.0000', taxRate: '15.0000', tax: '1.2345', total: '12.3456' }],
  },
  barcodeStatus: 'NOT_CAPTURED_IN_V1', pdfFormat: 'A4',
};
