import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { snapshotHash } from '../src/printing/print-archive.js';
import type { PrintSnapshot } from '../src/printing/print-types.js';
import { projectRetailReceipt, retailReceiptPermission } from '../src/printing/retail-receipt-policy.js';
import { RetailReceiptService } from '../src/printing/retail-receipt-service.js';
import type { RetailReceiptStoredArchive } from '../src/printing/retail-receipt-types.js';
import { retailReceiptArchiveFixture } from './retail-receipt-fixture.js';

const scope = { companyId: 1n, accountingDocumentId: 118n, salesInvoiceId: 42n };
// A test may deliberately corrupt a shape while keeping its original JSON hash
// valid, so projection validation is tested independently from hash mismatches.
const rehash = (archive: RetailReceiptStoredArchive) => { archive.snapshotHash = snapshotHash(archive.snapshot as PrintSnapshot); };
const reverseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
};

describe('archived retail receipt projection', () => {
  it('preserves schema-sized Decimal strings and immutable source without recalculation or aliasing', () => {
    const archive = retailReceiptArchiveFixture(), before = structuredClone(archive);
    const view = projectRetailReceipt(archive, scope);
    expect(retailReceiptPermission).toBe('sales_invoices.print');
    expect(view.invoice.total).toBe('123456789012346.9134');
    for (const field of ['subtotal', 'discountTotal', 'taxTotal', 'total'] as const) expect(view.invoice[field]).toBe(archive.snapshot.invoice![field]);
    for (const field of ['quantity', 'unitPrice', 'discount', 'taxRate', 'tax', 'total'] as const) expect(view.invoice.lines[0]![field]).toBe(archive.snapshot.invoice!.lines[0]![field]);
    expect(view.source).toEqual({ salesInvoiceId: '42', archiveId: archive.id, archiveHash: archive.snapshotHash, archivedAt: archive.snapshot.archivedAt });
    expect(view.barcodeStatus).toBe('NOT_CAPTURED_IN_V1');
    expect(view.pdfFormat).toBe('A4');
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE|entries|accountCode|partyAddress|baseTotal|exchangeRate|settlement/u);
    expect(archive).toEqual(before);
    view.invoice.lines[0]!.itemName = 'Changed preview';
    view.company.name = 'Changed company view';
    expect(archive).toEqual(before);
  });

  it.each(['canonical', 'legacy'] as const)('returns the stored %s hash without replacing it', (mode) => {
    const archive: RetailReceiptStoredArchive = retailReceiptArchiveFixture();
    if (mode === 'legacy') archive.snapshotHash = createHash('sha256').update(JSON.stringify(archive.snapshot)).digest('hex');
    else archive.snapshot = reverseKeys(archive.snapshot);
    const before = structuredClone(archive);
    expect(projectRetailReceipt(archive, scope).source.archiveHash).toBe(archive.snapshotHash);
    expect(archive).toEqual(before);
  });

  it('verifies the entire original JSON including private fields omitted from the preview', () => {
    const archive = retailReceiptArchiveFixture();
    archive.snapshot.invoice!.notes = 'PRIVATE TAMPERED NOTE';
    const before = structuredClone(archive);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('ARCHIVE_INTEGRITY_FAILED');
    expect(archive).toEqual(before);
  });

  it('does not repair an unmatched legacy hash after object keys change', () => {
    const archive: RetailReceiptStoredArchive = retailReceiptArchiveFixture();
    archive.snapshotHash = createHash('sha256').update(JSON.stringify(archive.snapshot)).digest('hex');
    archive.snapshot = reverseKeys(archive.snapshot);
    const before = structuredClone(archive);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('ARCHIVE_INTEGRITY_FAILED');
    expect(archive).toEqual(before);
  });

  it.each(['companyId', 'accountingDocumentId', 'snapshotCompanyId', 'snapshotDocumentId'] as const)('rejects foreign %s without exposing the archive', (field) => {
    const archive = retailReceiptArchiveFixture();
    if (field === 'snapshotCompanyId') archive.snapshot.company.id = '2';
    else if (field === 'snapshotDocumentId') archive.snapshot.document.id = '119';
    else archive[field] = '2';
    expect(() => projectRetailReceipt(archive, scope)).toThrow('NOT_FOUND');
  });

  it('rejects a foreign envelope before inspecting even malformed snapshot JSON', () => {
    const archive: RetailReceiptStoredArchive = { ...retailReceiptArchiveFixture(), companyId: '2', snapshot: null };
    expect(() => projectRetailReceipt(archive, scope)).toThrow('NOT_FOUND');
  });

  it.each(['RECEIPT', 'PAYMENT', 'SALES_CREDIT_NOTE', 'PURCHASE_INVOICE', 'MANUAL_JOURNAL'] as const)('does not turn %s into a sale confirmation', (kind) => {
    const archive = retailReceiptArchiveFixture();
    archive.snapshot.document.type = kind;
    rehash(archive);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
  });

  it('rejects an unsupported snapshot version, status or settlement profile', () => {
    const changes = [{ formatVersion: 2 }, { settlement: {} }];
    for (const change of changes) {
      const archive = retailReceiptArchiveFixture();
      Object.assign(archive.snapshot, change);
      rehash(archive);
      expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
    const archive = retailReceiptArchiveFixture();
    Object.assign(archive.snapshot.document, { statusAtArchive: 'DRAFT' });
    rehash(archive);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
  });

  it.each(['1e7', 'NaN', '1,234.00', '', ' 1.0000', '١٢.٥', '01.0', '1.0000\n', '1.0000\r\n', '1.0000\u2028'])('rejects malformed Decimal %j rather than repairing it', (value) => {
    const archive = retailReceiptArchiveFixture();
    archive.snapshot.invoice!.total = value;
    rehash(archive);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
  });

  it('checks every exposed Decimal field, including quantity, and preserves negative zero and trailing zeros', () => {
    for (const field of ['subtotal', 'discountTotal', 'taxTotal', 'total'] as const) {
      const archive = retailReceiptArchiveFixture();
      Object.assign(archive.snapshot.invoice!, { [field]: 12.34 });
      rehash(archive);
      expect(() => projectRetailReceipt(archive, scope), field).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
    for (const field of ['quantity', 'unitPrice', 'discount', 'taxRate', 'tax', 'total'] as const) {
      const archive = retailReceiptArchiveFixture();
      archive.snapshot.invoice!.lines[0]![field] = '1.00\n';
      rehash(archive);
      expect(() => projectRetailReceipt(archive, scope), field).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
    const archive = retailReceiptArchiveFixture();
    archive.snapshot.invoice!.total = '-0.0000';
    archive.snapshot.invoice!.lines[0]!.quantity = '0.000000';
    archive.snapshot.invoice!.lines[0]!.discount = '-12.3400';
    rehash(archive);
    const view = projectRetailReceipt(archive, scope);
    expect(view.invoice.total).toBe('-0.0000');
    expect(view.invoice.lines[0]).toMatchObject({ quantity: '0.000000', discount: '-12.3400' });
  });

  it('retains legacy missing item fields as null without live Inventory enrichment', () => {
    const archive = retailReceiptArchiveFixture();
    delete archive.snapshot.invoice!.lines[0]!.itemName;
    delete archive.snapshot.invoice!.lines[0]!.itemCode;
    delete archive.snapshot.invoice!.lines[0]!.unitOfMeasureCode;
    rehash(archive);
    expect(projectRetailReceipt(archive, scope).invoice.lines[0]).toMatchObject({
      itemName: null, itemCode: null, unitOfMeasureCode: null, description: 'عبوة عائلية 1 L',
    });
  });

  it('accepts 50 ordered lines but refuses 51 or empty without truncation', () => {
    for (const count of [0, 50, 51]) {
      const archive = retailReceiptArchiveFixture(), line = archive.snapshot.invoice!.lines[0]!;
      archive.snapshot.invoice!.lines = Array.from({ length: count }, (_, index) => ({ ...line, number: index + 1 }));
      rehash(archive);
      if (count === 50) expect(projectRetailReceipt(archive, scope).invoice.lines.map((value) => value.number)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
      else expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_LIMIT_EXCEEDED');
    }
  });

  it('rejects malformed root, nested records and arrays even when their JSON hash is valid', () => {
    for (const value of [null, false, 1, 'snapshot', [], {}, { company: null, document: {} }]) {
      const archive: RetailReceiptStoredArchive = { ...retailReceiptArchiveFixture(), snapshot: value };
      rehash(archive);
      expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
    for (const value of [null, [], 'invoice']) {
      const archive = retailReceiptArchiveFixture();
      Object.assign(archive.snapshot, { invoice: value });
      rehash(archive);
      expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
    for (const value of [null, {}, 'lines', [null], ['line']]) {
      const archive = retailReceiptArchiveFixture();
      Object.assign(archive.snapshot.invoice!, { lines: value });
      rehash(archive);
      expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
  });

  it('rejects malformed whitelisted text instead of leaking an object or silently coercing it', () => {
    const archive = retailReceiptArchiveFixture();
    Object.assign(archive.snapshot.invoice!.lines[0]!, { itemCode: { private: 'PRIVATE SECRET' } });
    rehash(archive);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    archive.snapshot.invoice!.lines[0]!.itemCode = null;
    archive.snapshot.company.name = 'ع'.repeat(2049);
    rehash(archive);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    archive.snapshot.company.name = 'ع'.repeat(2048);
    archive.snapshot.invoice!.total = '1'.repeat(81);
    rehash(archive);
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
  });

  it('accepts positive schema line-number boundaries and rejects malformed metadata', () => {
    for (const value of [0, -1, 1.5, 65_536, '1', null, { private: 'SECRET' }]) {
      const archive = retailReceiptArchiveFixture();
      Object.assign(archive.snapshot.invoice!.lines[0]!, { number: value });
      rehash(archive);
      expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
    const archive = retailReceiptArchiveFixture();
    archive.snapshot.invoice!.lines[0]!.number = 65_535;
    rehash(archive);
    expect(projectRetailReceipt(archive, scope).invoice.lines[0]!.number).toBe(65_535);
  });

  it('validates archive identifiers and timestamps without normalizing them', () => {
    for (const id of ['', '0', '-1', '01', '1\n', '18446744073709551616']) {
      const archive = retailReceiptArchiveFixture();
      archive.id = id;
      expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
    const maximum = retailReceiptArchiveFixture();
    maximum.id = '18446744073709551615';
    expect(projectRetailReceipt(maximum, scope).source.archiveId).toBe(maximum.id);
    for (const archivedAt of ['', '2026-02-30T10:30:00.000Z', '2026-08-11T25:30:00.000Z', '2026-08-11T10:30:00.000Z\n']) {
      const archive = retailReceiptArchiveFixture();
      archive.snapshot.archivedAt = archivedAt;
      rehash(archive);
      expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
  });

  it('rejects malformed or mismatched stored hashes without overwriting them', () => {
    for (const hash of ['0'.repeat(64), 'F'.repeat(64), '0'.repeat(64) + '\n', 'short']) {
      const archive = retailReceiptArchiveFixture();
      archive.snapshotHash = hash;
      expect(() => projectRetailReceipt(archive, scope)).toThrow('ARCHIVE_INTEGRITY_FAILED');
      expect(archive.snapshotHash).toBe(hash);
    }
  });

  it('bounds JSON depth, values and total characters before hashing the original object', () => {
    let nested: unknown = null;
    for (let index = 0; index < 34; index++) nested = { child: nested };
    for (const extra of [nested, Array.from({ length: 50_001 }, () => null), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      const archive = retailReceiptArchiveFixture();
      Object.assign(archive.snapshot, { extra });
      expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
  });

  it('rejects non-JSON values, cycles, sparse arrays and accessors without invoking getters', () => {
    const cyclic: { child?: unknown } = {};
    cyclic.child = cyclic;
    const sparse: unknown[] = new Array<unknown>(1);
    Object.assign(sparse, { extra: null });
    for (const extra of [undefined, Number.NaN, 1n, new Date(), cyclic, sparse]) {
      const archive = retailReceiptArchiveFixture();
      Object.assign(archive.snapshot, { extra });
      expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    }
    const archive = retailReceiptArchiveFixture(), getter = vi.fn(() => 'SECRET');
    Object.defineProperty(archive.snapshot, 'extra', { enumerable: true, get: getter });
    expect(() => projectRetailReceipt(archive, scope)).toThrow('RECEIPT_PREVIEW_UNSUPPORTED');
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('archived retail receipt service', () => {
  it('reads once from the locator and existing archive port using the initial actor company', async () => {
    const actor = { companyId: 1n, userId: 9n };
    const resolve = vi.fn(async () => { actor.companyId = 2n; return 118n; });
    const findExisting = vi.fn(async () => retailReceiptArchiveFixture());
    const service = new RetailReceiptService({ resolve }, { findExisting });
    expect((await service.preview(actor, 42n)).source.salesInvoiceId).toBe('42');
    expect(resolve).toHaveBeenCalledExactlyOnceWith(1n, 'SALES_INVOICE', 42n);
    expect(findExisting).toHaveBeenCalledExactlyOnceWith(1n, 118n);
  });

  it('does not read archives for missing sources or build one when the archive is absent', async () => {
    const findExisting = vi.fn(async () => null);
    const missing = new RetailReceiptService({ resolve: async () => null }, { findExisting });
    await expect(missing.preview({ companyId: 1n, userId: 9n }, 42n)).rejects.toThrow('NOT_FOUND');
    expect(findExisting).not.toHaveBeenCalled();
    const service = new RetailReceiptService({ resolve: async () => 118n }, { findExisting });
    await expect(service.preview({ companyId: 1n, userId: 9n }, 42n)).rejects.toThrow('ARCHIVE_NOT_AVAILABLE');
    expect(findExisting).toHaveBeenCalledExactlyOnceWith(1n, 118n);
  });

  it('does not retry or recover from source/read errors through another service', async () => {
    const findExisting = vi.fn(async () => { throw new Error('READ_FAILURE'); });
    const service = new RetailReceiptService({ resolve: async () => 118n }, { findExisting });
    await expect(service.preview({ companyId: 1n, userId: 9n }, 42n)).rejects.toThrow('READ_FAILURE');
    expect(findExisting).toHaveBeenCalledTimes(1);
    const resolve = vi.fn(async () => { throw new Error('LOCATOR_FAILURE'); });
    await expect(new RetailReceiptService({ resolve }, { findExisting }).preview({ companyId: 1n, userId: 9n }, 42n)).rejects.toThrow('LOCATOR_FAILURE');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(findExisting).toHaveBeenCalledTimes(1);
  });
});
