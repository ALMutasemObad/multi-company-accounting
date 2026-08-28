import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ProfessionalPeoplePort,
  ProfessionalPersonReference,
} from "../projects/project-reference-ports.js";

const toPerson = (value: { user: ProfessionalPersonReference }) => value.user;

export class ProfessionalPeopleAdapter implements ProfessionalPeoplePort {
  constructor(private readonly prisma: PrismaClient) {}

  async lockAssignment(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ) {
    const rows = await tx.$queryRaw<Array<{ user_id: bigint }>>`
      SELECT user_id FROM user_companies
      WHERE company_id=${companyId} AND user_id=${userId}
      FOR UPDATE`;
    return rows.length === 1;
  }

  async findActiveInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ) {
    const assignment = await tx.userCompany.findFirst({
      where: { companyId, userId, isActive: true, user: { isActive: true } },
      select: { user: { select: { id: true, displayName: true, nameEn: true } } },
    });
    return assignment ? toPerson(assignment) : null;
  }

  async listActiveInCompany(
    companyId: bigint,
    input: { ids?: bigint[] | undefined; search?: string | undefined; limit: number },
  ): Promise<ProfessionalPersonReference[]> {
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
    return rows.map(toPerson);
  }
}
