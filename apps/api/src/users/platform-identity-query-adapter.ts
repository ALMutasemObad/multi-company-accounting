import type { PrismaClient } from "@prisma/client";
import type { PlatformOperatorIdentityQueryPort } from "../platform-operations/platform-operations-ports.js";

export class PlatformIdentityQueryAdapter implements PlatformOperatorIdentityQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async existingUserIds(userIds: readonly bigint[]) {
    if (!userIds.length) return [];
    return (await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true },
    })).map((user) => user.id);
  }

  async usersByNormalizedEmails(emails: readonly string[]) {
    if (!emails.length) return [];
    return this.prisma.user.findMany({
      where: { emailNormalized: { in: [...emails] } },
      select: { id: true, emailNormalized: true },
    });
  }

  async isActiveUser(userId: bigint) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });
    return user?.isActive === true;
  }
}
