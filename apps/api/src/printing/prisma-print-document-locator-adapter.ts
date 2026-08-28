import type { PrismaClient } from '@prisma/client';
import type { PrintableDocumentKind, PrintDocumentLocatorPort } from './print-ports.js';

export class PrismaPrintDocumentLocatorAdapter implements PrintDocumentLocatorPort {
  constructor(private readonly prisma: PrismaClient) {}

  async resolve(companyId: bigint, kind: PrintableDocumentKind, entityId: bigint) {
    if (kind === 'MANUAL_JOURNAL') {
      const row = await this.prisma.accountingDocument.findFirst({
        where: { id: entityId, companyId, documentType: kind },
        select: { id: true },
      });
      return row?.id ?? null;
    }
    const row = kind === 'RECEIPT'
      ? await this.prisma.receipt.findFirst({ where: { id: entityId, companyId }, select: { accountingDocumentId: true } })
      : kind === 'PAYMENT'
        ? await this.prisma.payment.findFirst({ where: { id: entityId, companyId }, select: { accountingDocumentId: true } })
        : kind === 'PURCHASE_INVOICE'
          ? await this.prisma.purchaseInvoice.findFirst({ where: { id: entityId, companyId }, select: { accountingDocumentId: true } })
          : await this.prisma.salesInvoice.findFirst({ where: { id: entityId, companyId }, select: { accountingDocumentId: true } });
    return row?.accountingDocumentId ?? null;
  }
}
