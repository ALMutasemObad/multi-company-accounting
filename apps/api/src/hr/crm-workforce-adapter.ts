import type { Prisma, PrismaClient } from "@prisma/client";
import type { CrmWorkforceQueryPort, CrmWorkforceReference } from "../crm/crm-reference-ports.js";

const select = {
  id: true,
  publicId: true,
  employeeNumber: true,
  nameAr: true,
  nameEn: true,
} as const;

const reference = (row: { id: bigint; publicId: string; employeeNumber: string; nameAr: string; nameEn: string | null }): CrmWorkforceReference => ({
  employeeId: row.id,
  publicId: row.publicId,
  employeeNumber: row.employeeNumber,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
});

const activeWhere = {
  status: "ACTIVE" as const,
  userId: { not: null },
  identityAssignment: { is: { isActive: true, user: { isActive: true } } },
};

export class CrmWorkforceAdapter implements CrmWorkforceQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findAssignable(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    const row = await tx.employee.findFirst({ where: { companyId, publicId, ...activeWhere }, select });
    return row ? reference(row) : null;
  }

  async listAssignable(companyId: bigint, input: { search?: string | undefined; limit: number }) {
    const rows = await this.prisma.employee.findMany({
      where: {
        companyId,
        ...activeWhere,
        ...(input.search ? { OR: [
          { employeeNumber: { contains: input.search } },
          { nameAr: { contains: input.search } },
          { nameEn: { contains: input.search } },
        ] } : {}),
      },
      select,
      orderBy: [{ employeeNumber: "asc" }, { id: "asc" }],
      take: input.limit,
    });
    return rows.map(reference);
  }

  async listByInternalIds(companyId: bigint, ids: bigint[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.employee.findMany({
      where: { companyId, id: { in: ids } },
      select,
      orderBy: [{ employeeNumber: "asc" }, { id: "asc" }],
    });
    return rows.map(reference);
  }
}
