import { Prisma } from "@prisma/client";
import type { PayrollEmployeePort } from "../payroll/payroll-reference-ports.js";
const select = { id: true, publicId: true, employeeNumber: true, nameAr: true, hireDate: true, terminationDate: true, status: true } as const;
export class PayrollEmployeeAdapter implements PayrollEmployeePort {
  list(tx: Prisma.TransactionClient, companyId: bigint, search?: string) {
    return tx.employee.findMany({ where: { companyId, status: "ACTIVE", ...(search ? { OR: [
      { nameAr: { contains: search } }, { employeeNumber: { contains: search } },
    ] } : {}) }, select, orderBy: { employeeNumber: "asc" }, take: 50 });
  }
  findById(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    return tx.employee.findFirst({ where: { companyId, id }, select });
  }
  find(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    return tx.employee.findFirst({ where: { companyId, publicId }, select });
  }
  async lock(tx: Prisma.TransactionClient, companyId: bigint, ids: readonly bigint[]) {
    if (!ids.length) return [];
    if (ids.length > 200) throw new Error("PAYROLL_EMPLOYEE_LIMIT");
    const ordered = [...new Set(ids)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM employees WHERE company_id = ${companyId} AND id IN (${Prisma.join(ordered)}) ORDER BY id FOR UPDATE`);
    return tx.employee.findMany({ where: { companyId, id: { in: ordered } }, orderBy: { id: "asc" }, select });
  }
}
