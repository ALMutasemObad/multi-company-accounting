import type { PrismaClient } from "@prisma/client";
import type { ActorContext } from "../../platform/actor-context.js";
import type { PosSaleQueryPort } from "../pos-types.js";

export class PrismaPosSaleQueryAdapter implements PosSaleQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    context: ActorContext,
    input: { page: number; pageSize: number },
  ) {
    const where = { companyId: context.companyId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.posSale.findMany({
        where,
        include: {
          completedBy: { select: { id: true, displayName: true } },
          salesInvoice: { include: { accountingDocument: true } },
          receipt: { include: { accountingDocument: true } },
        },
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.posSale.count({ where }),
    ]);
    return {
      total,
      data: rows.map((row) => ({
        id: row.id,
        completedAt: row.completedAt,
        completedBy: row.completedBy,
        invoice: {
          id: row.salesInvoice.id,
          documentNumber: row.salesInvoice.accountingDocument.documentNumber,
          documentDate: row.salesInvoice.accountingDocument.documentDate,
          status: row.salesInvoice.accountingDocument.status,
          customerName: row.salesInvoice.customerNameSnapshot,
          total: row.salesInvoice.total,
          baseTotal: row.salesInvoice.baseTotal,
        },
        receipt: {
          id: row.receipt.id,
          documentNumber: row.receipt.accountingDocument.documentNumber,
          status: row.receipt.accountingDocument.status,
        },
      })),
    };
  }
}
