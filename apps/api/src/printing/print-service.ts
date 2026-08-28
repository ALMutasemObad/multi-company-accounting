import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit/prisma-audit-append-adapter.js";
import type { ActorContext } from "../platform/actor-context.js";
import { archiveDocument, snapshotHashMatches } from "./print-archive.js";
import { renderDocumentPdf } from "./pdf-renderer.js";
import type { PrintSnapshot } from "./print-types.js";
import type { PrintableDocumentKind, PrintDocumentLocatorPort } from "./print-ports.js";
import { PrismaPrintDocumentLocatorAdapter } from "./prisma-print-document-locator-adapter.js";

export class PrintError extends Error { constructor(public readonly reason: "NOT_FOUND" | "DOCUMENT_NOT_PRINTABLE" | "ARCHIVE_INTEGRITY_FAILED") { super(reason); } }
export class PrintService {
  private readonly locator: PrintDocumentLocatorPort;

  constructor(private readonly prisma: PrismaClient, locator?: PrintDocumentLocatorPort) {
    this.locator = locator ?? new PrismaPrintDocumentLocatorAdapter(prisma);
  }

  async print(context: ActorContext, kind: PrintableDocumentKind, entityId: bigint) {
    const documentId = await this.resolveDocument(context, kind, entityId);
    let archive;
    try {
      archive = await this.prisma.$transaction(async (tx) => {
        const stored = await archiveDocument(tx, context, documentId);
        const snapshot = stored.snapshot as unknown as PrintSnapshot;
        if (!snapshotHashMatches(snapshot, stored.snapshotHash)) throw new PrintError("ARCHIVE_INTEGRITY_FAILED");
        return stored;
      });
    } catch (error) { if (error instanceof Error && error.message === "DOCUMENT_NOT_PRINTABLE") throw new PrintError("DOCUMENT_NOT_PRINTABLE"); throw error; }
    const snapshot = archive.snapshot as unknown as PrintSnapshot;
    const buffer = await renderDocumentPdf(snapshot);
    const updated = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.documentPrintArchive.updateMany({ where: { id: archive.id, firstPrintedAt: null }, data: { firstPrintedAt: now } });
      const stored = await tx.documentPrintArchive.update({ where: { id: archive.id }, data: { printCount: { increment: 1 }, lastPrintedAt: now } });
      await appendAudit(tx, { data: { companyId: context.companyId, actorUserId: context.userId, action: "DOCUMENT_PDF_PRINTED", entityType: "ACCOUNTING_DOCUMENT", entityId: documentId.toString(), details: { archiveId: archive.id.toString(), printNumber: stored.printCount } } });
      return stored;
    });
    return { buffer, filename: `${kind.toLowerCase()}-${snapshot.document.number}.pdf`, archive: { id: updated.id.toString(), hash: updated.snapshotHash, printCount: updated.printCount, archivedAt: updated.createdAt.toISOString(), lastPrintedAt: updated.lastPrintedAt?.toISOString() ?? null } };
  }
  private async resolveDocument(context: ActorContext, kind: PrintableDocumentKind, entityId: bigint) {
    const documentId = await this.locator.resolve(context.companyId, kind, entityId);
    if (documentId === null) throw new PrintError("NOT_FOUND");
    return documentId;
  }
}
