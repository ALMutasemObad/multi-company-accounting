import type { Prisma, PrismaClient } from "@prisma/client";
import type { GeneralProjectEmployeePort } from "../general-projects/general-project-reference-ports.js";

const select = { id: true, publicId: true, employeeNumber: true, nameAr: true, nameEn: true, status: true } as const;

export class GeneralProjectEmployeeAdapter implements GeneralProjectEmployeePort {
  constructor(private readonly prisma: PrismaClient) {}

  findInCompany(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    return tx.employee.findFirst({ where: { companyId, publicId }, select });
  }

  async lockActiveInCompany(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM employees WHERE company_id = ${companyId} AND public_id = ${publicId} AND status = 'ACTIVE' FOR UPDATE
    `;
    if (rows.length !== 1) return null;
    return tx.employee.findFirst({ where: { companyId, id: rows[0]!.id, status: "ACTIVE" }, select });
  }

  countActiveInCompany(tx: Prisma.TransactionClient, companyId: bigint, ids: readonly bigint[]) {
    if (ids.length === 0) return Promise.resolve(0);
    return tx.employee.count({ where: { companyId, id: { in: [...ids] }, status: "ACTIVE" } });
  }

  findByUserInCompany(companyId: bigint, userId: bigint) {
    return this.prisma.employee.findFirst({ where: { companyId, userId }, select });
  }

  listActiveInCompany(companyId: bigint, search?: string) {
    return this.prisma.employee.findMany({
      where: { companyId, status: "ACTIVE", ...(search ? { OR: [
        { employeeNumber: { contains: search } }, { nameAr: { contains: search } }, { nameEn: { contains: search } },
      ] } : {}) },
      select,
      orderBy: [{ employeeNumber: "asc" }, { id: "asc" }],
      take: 100,
    });
  }

  listByInternalIds(companyId: bigint, ids: readonly bigint[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.employee.findMany({ where: { companyId, id: { in: [...ids] } }, select,
      orderBy: [{ employeeNumber: "asc" }, { id: "asc" }] });
  }
}
