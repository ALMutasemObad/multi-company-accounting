import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  EmployeeExpenseCostCenterPort,
  EmployeeExpenseCostCenterReference,
} from "../employee-expenses/employee-expense-reference-ports.js";

const select = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  isActive: true,
} as const;

export class EmployeeExpenseCostCenterAdapter implements EmployeeExpenseCostCenterPort {
  constructor(private readonly prisma: PrismaClient) {}

  async lockInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    ids: bigint[],
  ): Promise<EmployeeExpenseCostCenterReference[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT id FROM cost_centers
      WHERE company_id = ${companyId} AND id IN (${Prisma.join(ids)})
      ORDER BY id ASC
      FOR UPDATE`);
    if (rows.length === 0) return [];
    return tx.costCenter.findMany({
      where: { companyId, id: { in: rows.map(({ id }) => id) } },
      select,
      orderBy: { id: "asc" },
    });
  }

  listActiveInCompany(companyId: bigint) {
    return this.prisma.costCenter.findMany({
      where: { companyId, isActive: true },
      select,
      orderBy: [{ code: "asc" }, { id: "asc" }],
    });
  }
}
