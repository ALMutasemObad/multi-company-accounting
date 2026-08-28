import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  IdentityAccountPort,
  IdentityAccountRecord,
} from "../workforce-access/workforce-access-ports.js";

const select = {
  id: true,
  emailNormalized: true,
  displayName: true,
  nameEn: true,
  isActive: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export class IdentityAccountAdapter implements IdentityAccountPort {
  constructor(private readonly prisma: PrismaClient) {}

  async emailExists(emailNormalized: string) {
    return Boolean(await this.prisma.user.findUnique({
      where: { emailNormalized },
      select: { id: true },
    }));
  }

  async createForEmployee(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      actorUserId: bigint;
      employeePublicId: string;
      emailNormalized: string;
      displayName: string;
      nameEn: string | null;
      passwordHash: string;
    },
  ): Promise<IdentityAccountRecord> {
    const user = await tx.user.create({
      data: {
        emailNormalized: input.emailNormalized,
        displayName: input.displayName,
        nameEn: input.nameEn,
        passwordHash: input.passwordHash,
      },
      select,
    });
    await tx.userCompany.create({ data: { userId: user.id, companyId: input.companyId } });
    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "USER_CREATED_FROM_EMPLOYEE",
        entityType: "USER",
        entityId: user.id.toString(),
        details: { email: input.emailNormalized, employeeId: input.employeePublicId },
      },
    });
    return user;
  }

  async lockActiveInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<IdentityAccountRecord | null> {
    await tx.$queryRaw`SELECT user_id FROM user_companies WHERE user_id = ${userId} AND company_id = ${companyId} FOR UPDATE`;
    const assignment = await tx.userCompany.findFirst({
      where: { companyId, userId, isActive: true, user: { isActive: true } },
      select: { user: { select } },
    });
    return assignment?.user ?? null;
  }

  async alignEmployeeProfile(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      actorUserId: bigint;
      userId: bigint;
      employeePublicId: string;
      displayName: string;
      nameEn: string | null;
    },
  ) {
    const user = await tx.user.update({
      where: { id: input.userId },
      data: { displayName: input.displayName, nameEn: input.nameEn },
      select,
    });
    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "USER_LINKED_TO_EMPLOYEE",
        entityType: "USER",
        entityId: input.userId.toString(),
        details: { employeeId: input.employeePublicId },
      },
    });
    return user;
  }
}
