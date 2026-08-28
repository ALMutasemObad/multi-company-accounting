import type { PrismaClient } from '@prisma/client';
import type { SecurityIdentityQueryPort } from '../security/security-identity-port.js';

export class SecurityIdentityAdapter implements SecurityIdentityQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  findActorsByIds(userIds: readonly bigint[]) {
    if (!userIds.length) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, displayName: true, emailNormalized: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });
  }

  async findMatchingActorIds(userIds: readonly bigint[], search: string) {
    if (!userIds.length) return [];
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: [...userIds] },
        OR: [
          { displayName: { contains: search } },
          { emailNormalized: { contains: search } },
        ],
      },
      select: { id: true },
    });
    return users.map(({ id }) => id);
  }
}
