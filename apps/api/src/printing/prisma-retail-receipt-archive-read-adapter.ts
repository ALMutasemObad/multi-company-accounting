import type { PrismaClient } from '@prisma/client';
import type { RetailReceiptArchiveReadPort, RetailReceiptStoredArchive } from './retail-receipt-types.js';

type ArchiveReadClient = { documentPrintArchive: Pick<PrismaClient['documentPrintArchive'], 'findFirst'> };

/** Printing reads its own archive only; no live snapshot query or write fallback. */
export class PrismaRetailReceiptArchiveReadAdapter implements RetailReceiptArchiveReadPort {
  constructor(private readonly prisma: ArchiveReadClient) {}

  async findExisting(companyId: bigint, accountingDocumentId: bigint): Promise<RetailReceiptStoredArchive | null> {
    const archive = await this.prisma.documentPrintArchive.findFirst({
      where: { companyId, accountingDocumentId },
      select: { id: true, companyId: true, accountingDocumentId: true, snapshotHash: true, snapshot: true },
    });
    if (archive === null) return null;
    return {
      id: archive.id.toString(), companyId: archive.companyId.toString(),
      accountingDocumentId: archive.accountingDocumentId.toString(), snapshotHash: archive.snapshotHash,
      snapshot: archive.snapshot,
    };
  }
}
