import type { PrintSnapshot } from '../src/printing/print-types.js';
import type { RetailReceiptStoredArchive } from '../src/printing/retail-receipt-types.js';
import { snapshotHash } from '../src/printing/print-archive.js';
import { printSnapshotFixture } from './fixtures/print-snapshot.js';

/** Narrower fixture type permits deliberate edits without weakening the raw port. */
export type RetailReceiptArchiveFixture = RetailReceiptStoredArchive & { snapshot: PrintSnapshot };

export function retailReceiptArchiveFixture(): RetailReceiptArchiveFixture {
  const snapshot = structuredClone(printSnapshotFixture);
  snapshot.company.name = 'Neighborhood Grocery 2026';
  snapshot.document.type = 'SALES_INVOICE';
  snapshot.document.number = 'INV-2026-000000000000000118';
  snapshot.settlement = null;
  snapshot.invoice = {
    partyKind: 'CUSTOMER', partyName: 'PRIVATE CUSTOMER', partyAddress: 'PRIVATE ADDRESS', partyTaxMasked: '***9999',
    sourceInvoiceNumber: null, dueDate: '2026-08-11', currencyCode: 'SAR', exchangeRate: '1.00000000',
    subtotal: '123456789012345.6789', discountTotal: '0.0000', taxTotal: '1.2345',
    // All values fit Decimal(19,4). Intentionally do not derive totals from lines:
    // Printing preserves archived facts and must not reconcile them while reading.
    total: '123456789012346.9134', baseTotal: '123456789012346.9134', notes: 'PRIVATE NOTE',
    lines: [{ number: 1, itemCode: 'ITM-000000000001', itemName: 'حليب كامل الدسم Fresh Milk 123', unitOfMeasureCode: 'EA',
      description: 'عبوة عائلية 1 L', accountCode: 'PRIVATE ACCOUNT', accountName: 'PRIVATE ACCOUNT NAME',
      quantity: '1234567890123.123456', unitPrice: '123456789012345.6789', discount: '0.0000', taxRate: '15.0000',
      tax: '1.2345', total: '12.3456' }],
  };
  return { id: '9007199254740993001', companyId: '1', accountingDocumentId: '118', snapshotHash: snapshotHash(snapshot), snapshot };
}
