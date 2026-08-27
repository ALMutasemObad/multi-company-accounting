import type { Prisma, PrismaClient } from "@prisma/client";
import type { HrIdentityPort, HrIdentityReference } from "../hr/hr-identity-port.js";

const toReference = (row: { user: HrIdentityReference }) => row.user;

export class HrIdentityAdapter implements HrIdentityPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ) {
    const row = await tx.userCompany.findFirst({
      where: { companyId, userId },
      select: { user: { select: { id: true, displayName: true, nameEn: true } } },
    });
    return row ? toReference(row) : null;
  }

  async findActiveInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ) {
    const row = await tx.userCompany.findFirst({
      where: { companyId, userId, isActive: true, user: { isActive: true } },
      select: { user: { select: { id: true, displayName: true, nameEn: true } } },
    });
    return row ? toReference(row) : null;
  }

  async listInCompany(
    companyId: bigint,
    input: { ids?: bigint[] | undefined; search?: string | undefined; limit: number },
  ) {
    const rows = await this.prisma.userCompany.findMany({
      where: {
        companyId,
        ...(input.ids ? {} : { isActive: true }),
        user: {
          ...(input.ids ? { id: { in: input.ids } } : { isActive: true }),
          ...(input.search ? {
            OR: [
              { displayName: { contains: input.search } },
              { nameEn: { contains: input.search } },
            ],
          } : {}),
        },
      },
      select: { user: { select: { id: true, displayName: true, nameEn: true } } },
      orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
      take: input.limit,
    });
    return rows.map(toReference);
  }
}
