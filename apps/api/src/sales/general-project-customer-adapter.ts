import type { Prisma, PrismaClient } from "@prisma/client";
import type { GeneralProjectCustomerPort } from "../general-projects/general-project-reference-ports.js";

const select = { id: true, code: true, nameAr: true, nameEn: true, isActive: true } as const;

export class GeneralProjectCustomerAdapter implements GeneralProjectCustomerPort {
  constructor(private readonly prisma: PrismaClient) {}

  findInCompany(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    return tx.customer.findFirst({ where: { companyId, id }, select });
  }

  listActiveInCompany(companyId: bigint, search?: string) {
    return this.prisma.customer.findMany({
      where: { companyId, isActive: true, ...(search ? { OR: [
        { code: { contains: search } }, { nameAr: { contains: search } }, { nameEn: { contains: search } },
      ] } : {}) },
      select,
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: 100,
    });
  }

  listByIds(companyId: bigint, ids: readonly bigint[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.customer.findMany({ where: { companyId, id: { in: [...ids] } }, select,
      orderBy: [{ code: "asc" }, { id: "asc" }] });
  }
}
