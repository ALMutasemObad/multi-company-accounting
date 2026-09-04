import { Prisma } from "@prisma/client";
import type {
  EmployeeExpenseEmployeePort,
  EmployeeExpenseEmployeeReference,
} from "../employee-expenses/employee-expense-reference-ports.js";

const select = {
  id: true,
  publicId: true,
  employeeNumber: true,
  nameAr: true,
  nameEn: true,
  status: true,
} as const;

export class EmployeeExpenseEmployeeAdapter implements EmployeeExpenseEmployeePort {
  async lockByUserInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<EmployeeExpenseEmployeeReference | null> {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT id FROM employees
      WHERE company_id = ${companyId} AND user_id = ${userId}
      FOR UPDATE`);
    if (rows.length !== 1) return null;
    return tx.employee.findFirst({ where: { id: rows[0]!.id, companyId }, select });
  }

  async lockByIdInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    employeeId: bigint,
  ): Promise<EmployeeExpenseEmployeeReference | null> {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT id FROM employees
      WHERE company_id = ${companyId} AND id = ${employeeId}
      FOR UPDATE`);
    if (rows.length !== 1) return null;
    return tx.employee.findFirst({ where: { id: employeeId, companyId }, select });
  }
}
