import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { appendAudit } from '../audit/prisma-audit-append-adapter.js';
import type { ActorContext } from '../platform/actor-context.js';
import type { PrintSnapshotQueryPort } from './print-ports.js';
import { PrismaPrintSnapshotQueryAdapter } from './prisma-print-snapshot-query-adapter.js';
import type { PrintSnapshot } from './print-types.js';

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)!;
  }
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? 'null' : canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  throw new TypeError('Print snapshot contains an unsupported JSON value');
};

export const snapshotJson = (snapshot: PrintSnapshot) => canonicalJson(snapshot);
export const snapshotHash = (snapshot: PrintSnapshot) => createHash('sha256').update(snapshotJson(snapshot)).digest('hex');
export const snapshotHashMatches = (snapshot: PrintSnapshot, expectedHash: string) => {
  if (snapshotHash(snapshot) === expectedHash) return true;
  const legacyHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return legacyHash === expectedHash;
};

const defaultSnapshotQuery = new PrismaPrintSnapshotQueryAdapter();

export async function archiveDocument(
  tx: Prisma.TransactionClient,
  context: ActorContext,
  documentId: bigint,
  snapshots: PrintSnapshotQueryPort = defaultSnapshotQuery,
) {
  const existing = await tx.documentPrintArchive.findFirst({
    where: { accountingDocumentId: documentId, companyId: context.companyId },
  });
  if (existing) return existing;
  const snapshot = await snapshots.load(tx, context.companyId, documentId);
  if (!snapshot) throw new Error('DOCUMENT_NOT_PRINTABLE');
  const archive = await tx.documentPrintArchive.create({
    data: {
      companyId: context.companyId,
      accountingDocumentId: documentId,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      snapshotHash: snapshotHash(snapshot),
      createdBy: context.userId,
    },
  });
  await appendAudit(tx, {
    data: {
      companyId: context.companyId,
      actorUserId: context.userId,
      action: 'DOCUMENT_PRINT_ARCHIVED',
      entityType: 'ACCOUNTING_DOCUMENT',
      entityId: documentId.toString(),
      details: { archiveId: archive.id.toString(), snapshotHash: archive.snapshotHash, formatVersion: 1 },
    },
  });
  return archive;
}
