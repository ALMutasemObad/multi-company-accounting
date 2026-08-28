import type { Prisma } from '@prisma/client';
import type { PrintSnapshot } from './print-types.js';

export type PrintableDocumentKind = 'RECEIPT' | 'PAYMENT' | 'MANUAL_JOURNAL' | 'PURCHASE_INVOICE' | 'SALES_INVOICE';

export interface PrintDocumentLocatorPort {
  resolve(companyId: bigint, kind: PrintableDocumentKind, entityId: bigint): Promise<bigint | null>;
}

export interface PrintSnapshotQueryPort {
  load(tx: Prisma.TransactionClient, companyId: bigint, documentId: bigint): Promise<PrintSnapshot | null>;
}
