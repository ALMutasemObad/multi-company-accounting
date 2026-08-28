import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ProfessionalEmployeePort,
  ProfessionalEmployeeReference,
} from "../projects/project-reference-ports.js";

const select = {
  publicId: true,
  employeeNumber: true,
  nameAr: true,
  nameEn: true,
  status: true,
} as const;

const reference = (row: {
  publicId: string;
  employeeNumber: string;
  nameAr: string;
  nameEn: string | null;
  status: ProfessionalEmployeeReference["status"];
}): ProfessionalEmployeeReference => ({
  id: row.publicId,
  employeeNumber: row.employeeNumber,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
  status: row.status,
});

export class ProfessionalEmployeeAdapter implements ProfessionalEmployeePort {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ) {
    const row = await tx.employee.findFirst({ where: { companyId, userId }, select });
    return row ? reference(row) : null;
  }

  async listByUsersInCompany(companyId: bigint, userIds: bigint[]) {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.employee.findMany({
      where: { companyId, userId: { in: userIds } },
      select: { ...select, userId: true },
      orderBy: [{ employeeNumber: "asc" }, { id: "asc" }],
    });
    return rows.flatMap((row) => row.userId === null ? [] : [{ ...reference(row), userId: row.userId }]);
  }
}
