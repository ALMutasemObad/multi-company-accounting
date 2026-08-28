import type { Prisma, PrismaClient, SecuritySeverity } from '@prisma/client';
import type { AuthStore, ClientMetadata } from './auth-store.js';
import type { SecurityEventAppendPort } from '../platform/security-event-append-port.js';
import { PrismaSecurityEventAppendAdapter } from '../security/prisma-security-event-append-adapter.js';

export class PrismaAuthStore implements AuthStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly security: SecurityEventAppendPort = new PrismaSecurityEventAppendAdapter(),
  ) {}

  private async createUserEvents(tx: Prisma.TransactionClient, input: { userId: bigint; sessionId?: bigint | undefined; eventType: string; severity: SecuritySeverity; metadata?: ClientMetadata | undefined; details?: Prisma.InputJsonValue | undefined }) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { emailNormalized: true, assignments: { where: { isActive: true, company: { isActive: true } }, select: { companyId: true } } } });
    if (!user.assignments.length) return;
    await this.security.appendMany(tx, user.assignments.map(({ companyId }) => ({ companyId, userId: input.userId, sessionId: input.sessionId ?? null, eventType: input.eventType, severity: input.severity, emailSnapshot: user.emailNormalized, ipAddress: input.metadata?.ipAddress ?? null, userAgent: input.metadata?.userAgent ?? null, ...(input.details !== undefined ? { details: input.details } : {}) })));
  }

  private async recordAccessEvent(userId: bigint, eventType: string, severity: SecuritySeverity, now: Date, metadata?: ClientMetadata | undefined) {
    await this.prisma.$transaction((tx) => this.createUserEvents(tx, { userId, eventType, severity, metadata, details: { occurredAt: now.toISOString() } }));
  }

  async createPreAuth(input: { tokenHash: Uint8Array<ArrayBuffer>; csrfHash: Uint8Array<ArrayBuffer>; expiresAt: Date }) {
    await this.prisma.session.create({ data: { ...input, state: 'PRE_AUTH' } });
  }

  async findSession(tokenHash: Uint8Array<ArrayBuffer>) {
    return this.prisma.session.findUnique({ where: { tokenHash } });
  }

  async findUser(emailNormalized: string) {
    return this.prisma.user.findUnique({ where: { emailNormalized } });
  }

  async recordFailedLogin(userId: bigint, now: Date, metadata?: ClientMetadata | undefined) {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { failedLoginAttempts: true } });
      const attempts = Math.min(user.failedLoginAttempts + 1, 255);
      const lockedUntil = attempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null;
      await tx.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil,
        },
      });
      await this.createUserEvents(tx, { userId, eventType: lockedUntil ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', severity: lockedUntil ? 'CRITICAL' : 'WARNING', metadata, details: { attempts, lockedUntil: lockedUntil?.toISOString() ?? null } });
    });
  }

  recordLockedLogin(userId: bigint, now: Date, metadata?: ClientMetadata | undefined) { return this.recordAccessEvent(userId, 'LOCKED_ACCOUNT_LOGIN_ATTEMPT', 'HIGH', now, metadata); }
  recordDisabledLogin(userId: bigint, now: Date, metadata?: ClientMetadata | undefined) { return this.recordAccessEvent(userId, 'DISABLED_ACCOUNT_LOGIN_ATTEMPT', 'HIGH', now, metadata); }

  async rotateToAuthenticated(input: {
    oldSessionId: bigint;
    userId: bigint;
    tokenHash: Uint8Array<ArrayBuffer>;
    csrfHash: Uint8Array<ArrayBuffer>;
    authenticatedAt: Date;
    expiresAt: Date;
    metadata?: ClientMetadata | undefined;
  }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.delete({ where: { id: input.oldSessionId } });
      const session = await tx.session.create({
        data: {
          state: 'AUTHENTICATED',
          userId: input.userId,
          tokenHash: input.tokenHash,
          csrfHash: input.csrfHash,
          authenticatedAt: input.authenticatedAt,
          expiresAt: input.expiresAt,
        },
      });
      await tx.user.update({ where: { id: input.userId }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: input.authenticatedAt } });
      await this.createUserEvents(tx, { userId: input.userId, sessionId: session.id, eventType: 'LOGIN_SUCCEEDED', severity: 'INFO', metadata: input.metadata });
    });
  }

  async listCompanies(userId: bigint) {
    const assignments = await this.prisma.userCompany.findMany({
      where: { userId, isActive: true, company: { isActive: true } },
      select: { company: { select: { id: true, name: true, timezone: true } } },
      orderBy: { company: { name: 'asc' } },
    });
    return assignments.map(({ company }) => company);
  }

  async selectCompany(input: { sessionId: bigint; userId: bigint; companyId: bigint; metadata?: ClientMetadata | undefined }) {
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.userCompany.findUnique({
        where: { userId_companyId: { userId: input.userId, companyId: input.companyId } },
        include: { company: { select: { isActive: true } } },
      });
      if (!assignment?.isActive || !assignment.company.isActive) return false;
      const updated = await tx.session.updateMany({
        where: { id: input.sessionId, userId: input.userId, state: 'AUTHENTICATED', revokedAt: null },
        data: { selectedCompanyId: input.companyId },
      });
      if (updated.count === 1) await this.security.append(tx, { companyId: input.companyId, userId: input.userId, sessionId: input.sessionId, eventType: 'COMPANY_CONTEXT_SELECTED', severity: 'INFO', emailSnapshot: assignment.userId ? (await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { emailNormalized: true } })).emailNormalized : null, ipAddress: input.metadata?.ipAddress ?? null, userAgent: input.metadata?.userAgent ?? null });
      return updated.count === 1;
    });
  }

  async revokeCurrentSession(sessionId: bigint, metadata?: ClientMetadata | undefined) {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findFirst({ where: { id: sessionId, revokedAt: null }, select: { userId: true, selectedCompanyId: true, user: { select: { emailNormalized: true } } } });
      if (!session) return;
      await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      if (session.userId && session.selectedCompanyId) await this.security.append(tx, { companyId: session.selectedCompanyId, userId: session.userId, sessionId, eventType: 'LOGOUT', severity: 'INFO', emailSnapshot: session.user?.emailNormalized ?? null, ipAddress: metadata?.ipAddress ?? null, userAgent: metadata?.userAgent ?? null });
    });
  }

  async hasPermission(input: { userId: bigint; companyId: bigint; code: string }) {
    const assignment = await this.prisma.userCompanyRole.findFirst({
      where: {
        userId: input.userId,
        companyId: input.companyId,
        assignment: { isActive: true },
        role: { isActive: true, permissions: { some: { permission: { code: input.code } } } },
      },
      select: { roleId: true },
    });
    return Boolean(assignment);
  }

  async listUserSessions(input: { userId: bigint; skip: number; take: number }) {
    const where = { userId: input.userId, state: 'AUTHENTICATED' as const, revokedAt: null, expiresAt: { gt: new Date() } };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.session.findMany({ where, select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true }, orderBy: { createdAt: 'desc' }, skip: input.skip, take: input.take }),
      this.prisma.session.count({ where }),
    ]);
    return { data, total };
  }

  async revokeUserSession(input: { userId: bigint; sessionId: bigint; actorSessionId: bigint; metadata?: ClientMetadata | undefined }) {
    await this.prisma.$transaction(async (tx) => {
      const actorSession = await tx.session.findUnique({ where: { id: input.actorSessionId }, select: { selectedCompanyId: true } });
      const target = await tx.session.findFirst({ where: { id: input.sessionId, userId: input.userId, revokedAt: null }, select: { id: true, user: { select: { emailNormalized: true } } } });
      if (!target) return;
      await tx.session.update({ where: { id: target.id }, data: { revokedAt: new Date() } });
      if (actorSession?.selectedCompanyId) await this.security.append(tx, { companyId: actorSession.selectedCompanyId, userId: input.userId, sessionId: target.id, eventType: 'SESSION_REVOKED', severity: target.id === input.actorSessionId ? 'INFO' : 'HIGH', emailSnapshot: target.user?.emailNormalized ?? null, ipAddress: input.metadata?.ipAddress ?? null, userAgent: input.metadata?.userAgent ?? null, details: { self: target.id === input.actorSessionId } });
    });
  }
}
