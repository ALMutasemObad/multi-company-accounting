import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  EmployeeAccountCandidate,
  EmployeeAccountPort,
  EmployeeAccountReference,
} from "../workforce-access/workforce-access-ports.js";

const reference = (row: {
  publicId: string;
  employeeNumber: string;
  nameAr: string;
  nameEn: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
}): EmployeeAccountReference => ({
  id: row.publicId,
  employeeNumber: row.employeeNumber,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
  status: row.status,
});

export class HrEmployeeAccountAdapter implements EmployeeAccountPort {
  constructor(private readonly prisma: PrismaClient) {}

  async listAvailable(companyId: bigint, input: { search?: string; limit: number }) {
    const rows = await this.prisma.employee.findMany({
      where: {
        companyId,
        userId: null,
        status: { not: "TERMINATED" },
        ...(input.search ? {
          OR: [
            { employeeNumber: { contains: input.search } },
            { nameAr: { contains: input.search } },
            { nameEn: { contains: input.search } },
          ],
        } : {}),
      },
      select: {
        publicId: true,
        employeeNumber: true,
        nameAr: true,
        nameEn: true,
        status: true,
      },
      orderBy: [{ nameAr: "asc" }, { id: "asc" }],
      take: input.limit,
    });
    return rows.map(reference);
  }

  async lockCandidate(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    employeePublicId: string,
  ): Promise<EmployeeAccountCandidate | null> {
    await tx.$queryRaw`SELECT id FROM employees WHERE public_id = ${employeePublicId} AND company_id = ${companyId} FOR UPDATE`;
    const row = await tx.employee.findFirst({
      where: { publicId: employeePublicId, companyId },
      select: {
        id: true,
        publicId: true,
        employeeNumber: true,
        nameAr: true,
        nameEn: true,
        status: true,
        userId: true,
      },
    });
    return row ? { ...reference(row), internalId: row.id, linkedUserId: row.userId } : null;
  }

  async linkAccount(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; employeeId: bigint; employeePublicId: string; userId: bigint; actorUserId: bigint },
  ) {
    const changed = await tx.employee.updateMany({
      where: {
        id: input.employeeId,
        companyId: input.companyId,
        userId: null,
        status: { not: "TERMINATED" },
      },
      data: {
        userId: input.userId,
        updatedById: input.actorUserId,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "EMPLOYEE_USER_LINKED",
        entityType: "EMPLOYEE",
        entityId: input.employeePublicId,
        details: { userId: input.userId.toString() },
      },
    });
    return true;
  }

  async findByUserIds(companyId: bigint, userIds: bigint[]) {
    if (!userIds.length) return [];
    const rows = await this.prisma.employee.findMany({
      where: { companyId, userId: { in: userIds } },
      select: {
        userId: true,
        publicId: true,
        employeeNumber: true,
        nameAr: true,
        nameEn: true,
        status: true,
      },
    });
    return rows.flatMap((row) => row.userId === null ? [] : [{ ...reference(row), userId: row.userId }]);
  }
}
