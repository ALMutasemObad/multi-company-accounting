import type { PrismaClient } from '@prisma/client';
import { PrismaPrintDocumentLocatorAdapter } from '../printing/prisma-print-document-locator-adapter.js';
import { PrismaRetailReceiptArchiveReadAdapter } from '../printing/prisma-retail-receipt-archive-read-adapter.js';
import { RetailReceiptService } from '../printing/retail-receipt-service.js';

export function createRetailReceiptService(prisma: PrismaClient) {
  return new RetailReceiptService(
    new PrismaPrintDocumentLocatorAdapter(prisma),
    new PrismaRetailReceiptArchiveReadAdapter(prisma),
  );
}
