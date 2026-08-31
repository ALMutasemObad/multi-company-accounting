import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { snapshotHash } from '../src/printing/print-archive.js';
import { projectRetailReceipt, RETAIL_RECEIPT_PERMISSION } from '../src/printing/retail-receipt-policy.js';
import { RetailReceiptService } from '../src/printing/retail-receipt-service.js';
import { retailReceiptArchiveFixture } from './retail-receipt-fixture.js';

const scope = { companyId: 1n, accountingDocumentId: 118n, salesInvoiceId: 42n };
describe('N3 archived retail receipt projection', () => {
  it('preserves every Decimal string and immutable source without recalculation or source aliasing', () => {
    const archive = retailReceiptArchiveFixture(); const before = structuredClone(archive);
    const view = projectRetailReceipt(archive, scope);
    expect(RETAIL_RECEIPT_PERMISSION).toBe('sales_invoices.print');
    expect(view.invoice.total).toBe('9007199254740994.3579');
    for (const field of ['subtotal', 'discountTotal', 'taxTotal', 'total'] as const) expect(view.invoice[field]).toBe(archive.snapshot.invoice![field]);
    for (const field of ['quantity', 'unitPrice', 'discount', 'taxRate', 'tax', 'total'] as const) expect(view.invoice.lines[0]![field]).toBe(archive.snapshot.invoice!.lines[0]![field]);
    expect(view.invoice.lines[0]!.itemCode).toBe('ITM-000000000001');
    expect(view.source).toEqual({ salesInvoiceId: '42', archiveId: archive.id, archiveHash: archive.snapshotHash, archivedAt: archive.snapshot.archivedAt });
    expect(archive).toEqual(before);
    view.invoice.lines[0]!.itemName = 'Changed preview';
    expect(archive).toEqual(before);
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE|entries|accountCode|partyAddress|baseTotal|exchangeRate|settlement/u);
    expect(view.barcodeStatus).toBe('NOT_CAPTURED_IN_V1'); expect(view.pdfFormat).toBe('A4');
  });
  it('uses the existing legacy and canonical archive hash verification', () => {
    const archive = retailReceiptArchiveFixture();
    archive.snapshotHash = createHash('sha256').update(JSON.stringify(archive.snapshot)).digest('hex');
    expect(projectRetailReceipt(archive, scope).source.archiveHash).toBe(archive.snapshotHash);
    archive.snapshot.invoice!.total = '0.0000';
    expect(() => projectRetailReceipt(archive, scope)).toThrow('ARCHIVE_INTEGRITY_FAILED');
  });
  it.each(['companyId', 'accountingDocumentId', 'snapshotCompanyId', 'snapshotDocumentId'] as const)('rejects foreign or wrong %s before exposing the archive', field => {
    const archive = retailReceiptArchiveFixture();
    if (field === 'snapshotCompanyId') archive.snapshot.company.id = '2';
    else if (field === 'snapshotDocumentId') archive.snapshot.document.id = '119';
    else archive[field] = '2';
    expect(() => projectRetailReceipt(archive, scope)).toThrow('NOT_FOUND');
  });
  it.each(['RECEIPT', 'PAYMENT', 'SALES_CREDIT_NOTE', 'PURCHASE_INVOICE', 'MANUAL_JOURNAL'] as const)('does not turn %s into a sale or payment confirmation', kind => {
    const archive = retailReceiptArchiveFixture(); archive.snapshot.document.type = kind;
    archive.snapshotHash = snapshotHash(archive.snapshot);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
  });
  it.each(['1e7', 'NaN', '1,234.00', '', ' 1.0000', '١٢.٥', '01.0'])('rejects malformed Decimal %s instead of repairing it', value => {
    const archive = retailReceiptArchiveFixture(); archive.snapshot.invoice!.total = value;
    archive.snapshotHash = snapshotHash(archive.snapshot);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
  });
  it('rejects numeric money and supports exact zero and negative archived values', () => {
    const archive = retailReceiptArchiveFixture();
    Object.assign(archive.snapshot.invoice!, { total: 123.45 }); archive.snapshotHash = snapshotHash(archive.snapshot);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    archive.snapshot.invoice!.total = '-0.0000'; archive.snapshotHash = snapshotHash(archive.snapshot);
    expect(projectRetailReceipt(archive, scope).invoice.total).toBe('-0.0000');
  });
  it('retains legacy missing item fields without live Inventory enrichment', () => {
    const archive = retailReceiptArchiveFixture();
    delete archive.snapshot.invoice!.lines[0]!.itemName; delete archive.snapshot.invoice!.lines[0]!.itemCode;
    archive.snapshotHash = snapshotHash(archive.snapshot);
    expect(projectRetailReceipt(archive, scope).invoice.lines[0]).toMatchObject({ itemName: null, itemCode: null, description: 'عبوة عائلية 1 L' });
  });
  it('accepts 50 lines but refuses 51 or empty rather than truncating the output', () => {
    for (const count of [0, 50, 51]) {
      const archive = retailReceiptArchiveFixture(); const line = archive.snapshot.invoice!.lines[0]!;
      archive.snapshot.invoice!.lines = Array.from({ length: count }, (_, index) => ({ ...line, number: index + 1 }));
      archive.snapshotHash = snapshotHash(archive.snapshot);
      if (count === 50) expect(projectRetailReceipt(archive, scope).invoice.lines).toHaveLength(50);
      else expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_LIMIT_EXCEEDED');
    }
  });
  it('reads once from the owner locator and existing archive port, scoped to the actor company', async () => {
    const resolve = vi.fn(async () => 118n); const findExisting = vi.fn(async () => retailReceiptArchiveFixture());
    const service = new RetailReceiptService({ resolve }, { findExisting });
    expect((await service.preview({ companyId: 1n, userId: 9n }, 42n)).source.salesInvoiceId).toBe('42');
    expect(resolve).toHaveBeenCalledExactlyOnceWith(1n, 'SALES_INVOICE', 42n);
    expect(findExisting).toHaveBeenCalledExactlyOnceWith(1n, 118n);
  });
  it('never builds an archive or retries on missing source/read failure', async () => {
    const findExisting = vi.fn(async () => null);
    const missing = new RetailReceiptService({ resolve: async () => null }, { findExisting });
    await expect(missing.preview({ companyId: 1n, userId: 9n }, 42n)).rejects.toThrow('NOT_FOUND');
    expect(findExisting).not.toHaveBeenCalled();
    const service = new RetailReceiptService({ resolve: async () => 118n }, { findExisting });
    await expect(service.preview({ companyId: 1n, userId: 9n }, 42n)).rejects.toThrow('ARCHIVE_NOT_AVAILABLE');
    findExisting.mockRejectedValueOnce(new Error('READ_FAILURE'));
    await expect(service.preview({ companyId: 1n, userId: 9n }, 42n)).rejects.toThrow('READ_FAILURE');
    expect(findExisting).toHaveBeenCalledTimes(2);
  });
});
