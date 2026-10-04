import { Prisma, type PrismaClient } from "@prisma/client";
import { TaxService } from "./tax-service.js";
import type { ServiceCatalogOutputTaxQueryPort, ServiceCatalogReferenceQuery } from "../service-catalog/service-catalog-reference-ports.js";

const account = { select: { id: true, code: true, nameAr: true, isActive: true,
  allowsPosting: true, accountType: { select: { class: true } },
  _count: { select: { children: true } } } } as const;

export class ServiceCatalogOutputTaxAdapter implements ServiceCatalogOutputTaxQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async listOptions(companyId: bigint, query: ServiceCatalogReferenceQuery) {
    // Mirror TaxService OUTPUT readiness in SQL so pagination never counts unusable rates.
    const where: Prisma.TaxRateWhereInput = {
      companyId, isActive: true,
      AND: [
        { OR: [{ rate: new Prisma.Decimal(0) }, { outputTaxAccount: { is: {
          isActive: true, allowsPosting: true, accountType: { is: { class: "LIABILITY" } }, children: { none: {} },
        } } }] },
        ...(query.search ? [{ OR: [{ code: { contains: query.search } }, { nameAr: { contains: query.search } }] }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.taxRate.findMany({ where, orderBy: [{ nameAr: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, code: true, nameAr: true, rate: true } }),
      this.prisma.taxRate.count({ where }),
    ]);
    return { data: rows.map(row => ({ id: row.id.toString(), code: row.code, nameAr: row.nameAr, rate: row.rate.toFixed(4) })),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  }

  async readyIds(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]): Promise<Set<string>> {
    if (ids.length > 100) throw new RangeError("UNBOUNDED_TAX_QUERY");
    if (!ids.length) return new Set<string>();
    const rows = await tx.taxRate.findMany({ where: { companyId, id: { in: ids } },
      include: { outputTaxAccount: account, inputTaxAccount: account } });
    return new Set(rows.filter(rate => TaxService.json(rate, "OUTPUT").isReady).map(rate => String(rate.id)));
  }
}
