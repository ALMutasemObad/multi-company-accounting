import { Prisma, type PrismaClient } from "@prisma/client";
import type { OrganizationSalesMetricsQueryPort } from "../organizations/organization-owner-ports.js";

const ZERO = new Prisma.Decimal(0);

export class OrganizationOwnerSalesAdapter implements OrganizationSalesMetricsQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async postedSales(companyIds: readonly bigint[], from: Date, toExclusive: Date) {
    if (companyIds.length === 0) return [];
    const documentDate = { gte: from, lt: toExclusive };
    const [invoices, creditNotes] = await Promise.all([
      this.prisma.salesInvoice.groupBy({
        by: ["companyId"],
        where: { companyId: { in: [...companyIds] }, accountingDocument: { status: "POSTED", documentType: "SALES_INVOICE", documentDate } },
        _sum: { baseTotal: true },
      }),
      this.prisma.salesInvoice.groupBy({
        by: ["companyId"],
        where: { companyId: { in: [...companyIds] }, accountingDocument: { status: "POSTED", documentType: "SALES_CREDIT_NOTE", documentDate } },
        _sum: { baseTotal: true },
      }),
    ]);
    const totals = new Map(invoices.map((row) => [row.companyId.toString(), row._sum.baseTotal ?? ZERO]));
    for (const row of creditNotes) {
      const key = row.companyId.toString();
      totals.set(key, (totals.get(key) ?? ZERO).minus(row._sum.baseTotal ?? ZERO));
    }
    return companyIds.map((companyId) => ({
      companyId,
      amountBase: (totals.get(companyId.toString()) ?? ZERO).toFixed(4),
    }));
  }
}
