import { describe, expect, it, vi } from 'vitest';
import { PrismaRetailReceiptArchiveReadAdapter } from '../src/printing/prisma-retail-receipt-archive-read-adapter.js';
import { retailReceiptArchiveFixture } from './retail-receipt-fixture.js';

const scopedRead = {
  where: { companyId: 1n, accountingDocumentId: 118n },
  select: { id: true, companyId: true, accountingDocumentId: true, snapshotHash: true, snapshot: true },
};
// Only findFirst exists in the fake client: a write, transaction or live-data
// fallback cannot succeed. The cast adapts Prisma's generic delegate in tests.
const adapterFor = (findFirst: ReturnType<typeof vi.fn>) => new PrismaRetailReceiptArchiveReadAdapter({
  documentPrintArchive: { findFirst },
} as unknown as ConstructorParameters<typeof PrismaRetailReceiptArchiveReadAdapter>[0]);

describe('Printing existing retail receipt archive read adapter', () => {
  it('makes one scoped query with only the five selected fields and returns the original JSON reference', async () => {
    const source = retailReceiptArchiveFixture(), before = structuredClone(source.snapshot);
    const row = Object.freeze({ id: BigInt(source.id), companyId: 1n, accountingDocumentId: 118n,
      snapshotHash: source.snapshotHash, snapshot: source.snapshot });
    const findFirst = vi.fn(async () => row);
    const result = await adapterFor(findFirst).findExisting(1n, 118n);
    expect(findFirst).toHaveBeenCalledExactlyOnceWith(scopedRead);
    expect(result).toEqual(source);
    expect(result!.snapshot).toBe(row.snapshot);
    expect(result!.snapshotHash).toBe(row.snapshotHash);
    expect(row.snapshot).toEqual(before);
  });

  it('returns null without creating or backfilling a missing archive', async () => {
    const findFirst = vi.fn(async () => null);
    expect(await adapterFor(findFirst).findExisting(1n, 118n)).toBeNull();
    expect(findFirst).toHaveBeenCalledExactlyOnceWith(scopedRead);
  });

  it('propagates a read failure without retry or a live snapshot fallback', async () => {
    const error = new Error('DATABASE_READ_FAILED');
    const findFirst = vi.fn(async () => { throw error; });
    await expect(adapterFor(findFirst).findExisting(1n, 118n)).rejects.toBe(error);
    expect(findFirst).toHaveBeenCalledExactlyOnceWith(scopedRead);
  });

  it('keeps malformed but valid database JSON unknown for policy validation, without repair or rehash', async () => {
    const snapshot = { unexpected: ['PRIVATE RAW JSON'] };
    const findFirst = vi.fn(async () => ({ id: 9n, companyId: 2n, accountingDocumentId: 119n,
      snapshotHash: 'f'.repeat(64), snapshot }));
    const result = await adapterFor(findFirst).findExisting(2n, 119n);
    expect(findFirst).toHaveBeenCalledExactlyOnceWith({ ...scopedRead, where: { companyId: 2n, accountingDocumentId: 119n } });
    expect(result).toEqual({ id: '9', companyId: '2', accountingDocumentId: '119', snapshotHash: 'f'.repeat(64), snapshot });
    expect(result!.snapshot).toBe(snapshot);
  });
});
