import { Prisma, type PrismaClient } from '@prisma/client';
import { hashToken } from './session-tokens.js';
import {
  PASSWORD_RESET_REQUEST_AGGREGATE,
  PASSWORD_RESET_REQUESTED,
  type OutboxAppender,
} from '../outbox/outbox.js';
import type { ClientMetadata } from './auth-store.js';

export class PasswordResetError extends Error {
  constructor(public readonly reason: 'INVALID_OR_EXPIRED_TOKEN') {
    super(reason);
  }
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
}

type PasswordResetOptions = {
  tokenTtlMinutes: number;
  now?: () => Date;
};

export class PasswordResetService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly passwords: PasswordHasher,
    private readonly outbox: OutboxAppender,
    private readonly options: PasswordResetOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async requestReset(
    input: { email: string; locale: 'ar' | 'en' },
    metadata: ClientMetadata = {},
  ) {
    const emailNormalized = input.email.trim().toLocaleLowerCase('en-US');
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
      select: { id: true, isActive: true },
    });

    // The public response is deliberately identical for missing, disabled and
    // active accounts so this endpoint cannot enumerate identities.
    if (!user?.isActive) return { status: 'ACCEPTED' as const };

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM users WHERE id = ${user.id} FOR UPDATE
      `;
      const lockedUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { isActive: true },
      });
      if (!lockedUser?.isActive) return;
      await tx.passwordResetRequest.updateMany({
        where: { userId: user.id, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      const request = await tx.passwordResetRequest.create({
        data: {
          userId: user.id,
          locale: input.locale,
          requestedIpAddress: metadata.ipAddress ?? null,
          requestedUserAgent: metadata.userAgent ?? null,
        },
        select: { publicId: true },
      });
      await this.outbox.append(tx, {
        eventType: PASSWORD_RESET_REQUESTED,
        schemaVersion: 1,
        aggregateType: PASSWORD_RESET_REQUEST_AGGREGATE,
        aggregateId: request.publicId,
        payload: {},
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2_000, timeout: 8_000 });

    return { status: 'ACCEPTED' as const };
  }

  async resetPassword(
    input: { token: string; password: string },
    metadata: ClientMetadata = {},
  ) {
    const now = this.now();
    const tokenHash = hashToken(input.token);
    const request = await this.prisma.passwordResetRequest.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, status: true, expiresAt: true, user: { select: { isActive: true } } },
    });
    if (!request
      || request.status !== 'PENDING'
      || !request.user.isActive
      || !request.expiresAt
      || request.expiresAt <= now) {
      throw new PasswordResetError('INVALID_OR_EXPIRED_TOKEN');
    }

    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetRequest.updateMany({
        where: {
          id: request.id,
          userId: request.userId,
          status: 'PENDING',
          tokenHash,
          expiresAt: { gt: now },
        },
        data: { status: 'USED', usedAt: now },
      });
      if (consumed.count !== 1) throw new PasswordResetError('INVALID_OR_EXPIRED_TOKEN');

      await tx.passwordResetRequest.updateMany({
        where: { userId: request.userId, status: 'PENDING', id: { not: request.id } },
        data: { status: 'REVOKED' },
      });
      const updatedUser = await tx.user.updateMany({
        where: { id: request.userId, isActive: true },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });
      if (updatedUser.count !== 1) throw new PasswordResetError('INVALID_OR_EXPIRED_TOKEN');
      await tx.session.updateMany({
        where: { userId: request.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      const assignments = await tx.userCompany.findMany({
        where: { userId: request.userId, isActive: true, company: { isActive: true } },
        select: { companyId: true },
      });
      if (assignments.length) {
        await tx.securityEvent.createMany({
          data: assignments.map(({ companyId }) => ({
            companyId,
            userId: request.userId,
            eventType: 'PASSWORD_RESET_COMPLETED',
            severity: 'HIGH' as const,
            ipAddress: metadata.ipAddress ?? null,
            userAgent: metadata.userAgent ?? null,
          })),
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2_000, timeout: 8_000 });
  }
}
