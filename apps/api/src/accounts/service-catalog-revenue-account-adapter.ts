import type { Prisma, PrismaClient } from "@prisma/client";
import type { ServiceCatalogReferenceQuery, ServiceCatalogRevenueAccountQueryPort } from "../service-catalog/service-catalog-reference-ports.js";

export class ServiceCatalogRevenueAccountAdapter implements ServiceCatalogRevenueAccountQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async listOptions(companyId: bigint, query: ServiceCatalogReferenceQuery) {
    const where: Prisma.AccountWhereInput = {
      companyId, isActive: true, allowsPosting: true,
      accountType: { is: { class: "REVENUE" } }, children: { none: {} },
      ...(query.search ? { OR: [{ code: { contains: query.search } }, { nameAr: { contains: query.search } },
        { nameEn: { contains: query.search } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.account.findMany({ where, orderBy: [{ code: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, code: true, nameAr: true, nameEn: true } }),
      this.prisma.account.count({ where }),
    ]);
    return { data: rows.map(row => ({ ...row, id: row.id.toString() })),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  }

  async readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Set<string>> {
    if (ids.length > 100) throw new RangeError("UNBOUNDED_ACCOUNT_QUERY");
    if (!ids.length) return new Set<string>();
    const rows = await tx.account.findMany({ where: { companyId, id: { in: ids } },
      select: { id: true, isActive: true, allowsPosting: true,
        accountType: { select: { class: true } }, _count: { select: { children: true } } } });
    return new Set(rows.filter(row => row.isActive && row.allowsPosting
      && row.accountType.class === "REVENUE" && row._count.children === 0).map(row => String(row.id)));
  }
}
