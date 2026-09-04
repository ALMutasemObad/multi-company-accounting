import type { PrismaClient } from "@prisma/client";
import type { OrganizationAccountingMetricsQueryPort } from "../organizations/organization-owner-ports.js";

export class OrganizationOwnerAccountingAdapter implements OrganizationAccountingMetricsQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async postedActivity(companyIds: readonly bigint[], from: Date, toExclusive: Date) {
    if (companyIds.length === 0) return [];
    const rows = await this.prisma.accountingDocument.groupBy({
      by: ["companyId"],
      where: {
        companyId: { in: [...companyIds] },
        status: "POSTED",
        documentDate: { gte: from, lt: toExclusive },
      },
      _count: { _all: true },
    });
    return rows.map((row) => ({ companyId: row.companyId, postedDocuments: row._count._all }));
  }
}
