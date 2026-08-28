import type { PrismaClient } from '@prisma/client';
import type { AuditIdentityQueryPort } from '../audit/audit-identity-port.js';

export class AuditIdentityAdapter implements AuditIdentityQueryPort {
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
