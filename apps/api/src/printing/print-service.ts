import type { PrismaClient } from "@prisma/client";
import type { ActorContext } from "../users/user-service.js";
import { archiveDocument, snapshotHashMatches } from "./print-archive.js";
import { renderDocumentPdf } from "./pdf-renderer.js";
import type { PrintSnapshot } from "./print-types.js";

export class PrintError extends Error { constructor(public readonly reason: "NOT_FOUND" | "DOCUMENT_NOT_PRINTABLE" | "ARCHIVE_INTEGRITY_FAILED") { super(reason); } }
export class PrintService {
  constructor(private readonly prisma: PrismaClient) {}
  async print(context: ActorContext, kind: "RECEIPT" | "PAYMENT" | "MANUAL_JOURNAL" | "PURCHASE_INVOICE" | "SALES_INVOICE", entityId: bigint) {
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
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: "DOCUMENT_PDF_PRINTED", entityType: "ACCOUNTING_DOCUMENT", entityId: documentId.toString(), details: { archiveId: archive.id.toString(), printNumber: stored.printCount } } });
      return stored;
    });
    return { buffer, filename: `${kind.toLowerCase()}-${snapshot.document.number}.pdf`, archive: { id: updated.id.toString(), hash: updated.snapshotHash, printCount: updated.printCount, archivedAt: updated.createdAt.toISOString(), lastPrintedAt: updated.lastPrintedAt?.toISOString() ?? null } };
  }
  private async resolveDocument(context: ActorContext, kind: "RECEIPT" | "PAYMENT" | "MANUAL_JOURNAL" | "PURCHASE_INVOICE" | "SALES_INVOICE", entityId: bigint) {
    if (kind === "MANUAL_JOURNAL") { const row = await this.prisma.accountingDocument.findFirst({ where: { id: entityId, companyId: context.companyId, documentType: kind }, select: { id: true } }); if (!row) throw new PrintError("NOT_FOUND"); return row.id; }
    const row = kind === "RECEIPT"
      ? await this.prisma.receipt.findFirst({ where: { id: entityId, companyId: context.companyId }, select: { accountingDocumentId: true } })
      : kind === "PAYMENT"
        ? await this.prisma.payment.findFirst({ where: { id: entityId, companyId: context.companyId }, select: { accountingDocumentId: true } })
        : kind === "PURCHASE_INVOICE"
          ? await this.prisma.purchaseInvoice.findFirst({ where: { id: entityId, companyId: context.companyId }, select: { accountingDocumentId: true } })
          : await this.prisma.salesInvoice.findFirst({ where: { id: entityId, companyId: context.companyId }, select: { accountingDocumentId: true } });
    if (!row) throw new PrintError("NOT_FOUND"); return row.accountingDocumentId;
  }
}
