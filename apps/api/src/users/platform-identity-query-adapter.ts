import type { PrismaClient } from "@prisma/client";
import type { PlatformIdentityQueryPort } from "../platform-operations/platform-operations-ports.js";

export class PlatformIdentityQueryAdapter implements PlatformIdentityQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async activeEmailForUser(userId: bigint) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: { emailNormalized: true },
    });
    return user?.emailNormalized ?? null;
  }
}
