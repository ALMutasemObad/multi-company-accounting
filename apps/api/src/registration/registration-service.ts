import { hash } from 'argon2';
import { Prisma, type PrismaClient } from '@prisma/client';
import { DEFAULT_CHART_TEMPLATE_CODE } from '../accounts/default-chart-template.js';
import { createOpaqueToken, hashToken } from '../auth/session-tokens.js';
import {
  REGISTRATION_REQUEST_AGGREGATE,
  REGISTRATION_VERIFICATION_REQUESTED,
  type OutboxAppender,
} from '../outbox/outbox.js';
import { CompanyProvisioningError, type CompanyProvisioningService } from '../platform/company-provisioning-service.js';
import {
  TransactionDeadlineExceededError,
  TransactionExecutor,
  TransactionRetryExhaustedError,
} from '../platform/transaction-executor.js';
import { RegistrationEventRecorder, type RegistrationMetadata } from './registration-event-recorder.js';
import { assertRequestActive, ClientDisconnectedError, sleepWithinRequest } from '../operations/request-context.js';
import { supportedLocales, type SupportedLocale } from './supported-locales.js';

export type { RegistrationMetadata } from './registration-event-recorder.js';

export type StartRegistrationInput = {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
  companyName: string;
  timezone: string;
  baseCurrencyCode: string;
  locale: SupportedLocale;
  chartTemplateCode: string;
};

type RegistrationOptions = {
  retentionDays?: number;
  now?: () => Date;
  passwordHasher?: (password: string) => Promise<string>;
  auditPepper?: string;
};

export class RegistrationError extends Error {
  constructor(public readonly reason: 'INVALID_OR_EXPIRED_TOKEN' | 'INVALID_OPTION' | 'REGISTRATION_CONFLICT' | 'PROVISIONING_FAILED') { super(reason); }
}

export class RegistrationService {
  private readonly now: () => Date;
  private readonly passwordHasher: (password: string) => Promise<string>;
  private readonly retentionDays: number;
  private readonly events: RegistrationEventRecorder;
  private readonly transactions: TransactionExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly provisioning: CompanyProvisioningService,
    private readonly outbox: OutboxAppender,
    optionsConfig: RegistrationOptions,
  ) {
    this.now = optionsConfig.now ?? (() => new Date());
    this.passwordHasher = optionsConfig.passwordHasher ?? hash;
    this.retentionDays = optionsConfig.retentionDays ?? 30;
    this.events = new RegistrationEventRecorder(optionsConfig.auditPepper ?? 'development-only-registration-audit-pepper');
    this.transactions = new TransactionExecutor(prisma);
  }

  async options() {
    const currencies = await this.prisma.currency.findMany({
      where: { scope: 'GLOBAL', scopeKey: 'GLOBAL', isActive: true },
      orderBy: { code: 'asc' },
      select: { code: true, nameAr: true, decimals: true },
    });
    const timezones = [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])];
    return {
      currencies,
      locales: supportedLocales,
      timezones,
      chartTemplates: [{ code: DEFAULT_CHART_TEMPLATE_CODE, nameAr: 'دليل عام للمنشآت الصغيرة', nameEn: 'Small business general chart' }],
      passwordPolicy: { minLength: 12, maxLength: 1024 },
    };
  }

  async cleanupExpired() {
    const cutoff = new Date(this.now().getTime() - this.retentionDays * 86_400_000);
    return this.prisma.registrationRequest.deleteMany({
      where: { status: { in: ['PENDING_EMAIL', 'EMAIL_VERIFIED', 'REJECTED'] }, updatedAt: { lt: cutoff } },
    });
  }

  async start(input: StartRegistrationInput, metadata: RegistrationMetadata = {}) {
    await this.cleanupExpired();
    try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(); } catch { throw new RegistrationError('INVALID_OPTION'); }
    const emailNormalized = input.email.trim().toLocaleLowerCase('en-US');
    const baseCurrencyCode = input.baseCurrencyCode.trim().toUpperCase();
    const passwordHash = await this.passwordHasher(input.password);
    const verificationTokenHash = hashToken(createOpaqueToken());
    const expiresAt = this.now();

    await this.transactions.execute({
      operation: 'START_REGISTRATION',
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWaitMs: 5_000,
      timeoutMs: 30_000,
      deadlineMs: 40_000,
    }, async (tx) => {
      const currency = await tx.currency.findUnique({ where: { scopeKey_code: { scopeKey: 'GLOBAL', code: baseCurrencyCode } }, select: { isActive: true } });
      if (!currency?.isActive) throw new RegistrationError('INVALID_OPTION');
      if (input.chartTemplateCode !== DEFAULT_CHART_TEMPLATE_CODE) throw new RegistrationError('INVALID_OPTION');
      const existingUser = await tx.user.findUnique({ where: { emailNormalized }, select: { id: true } });
      if (existingUser) {
        await this.recordEvent(tx, {
          emailNormalized,
          eventType: 'REGISTRATION_EXISTING_IDENTITY_ATTEMPT',
          severity: 'WARNING',
          metadata,
        });
        return null;
      }
      const registration = await tx.registrationRequest.upsert({
        where: { emailNormalized },
        update: {
          passwordHash,
          displayName: input.displayName,
          organizationName: input.organizationName,
          companyName: input.companyName,
          timezone: input.timezone,
          baseCurrencyCode,
          locale: input.locale,
          chartTemplateCode: input.chartTemplateCode,
          verificationTokenHash,
          verificationExpiresAt: expiresAt,
          status: 'PENDING_EMAIL',
          deliveryStatus: 'PENDING',
          deliveryGeneration: { increment: 1 },
          verifiedAt: null,
          provisioningStartedAt: null,
          completedAt: null,
          provisionedOrganizationId: null,
          provisionedCompanyId: null,
          provisionedUserId: null,
          lastErrorCode: null,
          ...(metadata.ipAddress ? { initialIpAddress: metadata.ipAddress } : {}),
          ...(metadata.userAgent ? { initialUserAgent: metadata.userAgent } : {}),
        },
        create: {
          emailNormalized,
          passwordHash,
          displayName: input.displayName,
          organizationName: input.organizationName,
          companyName: input.companyName,
          timezone: input.timezone,
          baseCurrencyCode,
          locale: input.locale,
          chartTemplateCode: input.chartTemplateCode,
          verificationTokenHash,
          verificationExpiresAt: expiresAt,
          deliveryAttempts: 0,
          ...(metadata.ipAddress ? { initialIpAddress: metadata.ipAddress } : {}),
          ...(metadata.userAgent ? { initialUserAgent: metadata.userAgent } : {}),
        },
        select: { id: true, publicId: true, deliveryGeneration: true },
      });
      await this.recordEvent(tx, { registrationRequestId: registration.id, emailNormalized, eventType: 'REGISTRATION_STARTED', metadata });
      await this.outbox.append(tx, {
        eventType: REGISTRATION_VERIFICATION_REQUESTED,
        schemaVersion: 1,
        aggregateType: REGISTRATION_REQUEST_AGGREGATE,
        aggregateId: registration.publicId,
        payload: { deliveryGeneration: registration.deliveryGeneration },
        occurredAt: this.now(),
      });
      return true;
    });

    return { status: 'PENDING_VERIFICATION' as const };
  }

  async resend(email: string, metadata: RegistrationMetadata = {}) {
    const emailNormalized = email.trim().toLocaleLowerCase('en-US');
    const verificationTokenHash = hashToken(createOpaqueToken());
    const expiresAt = this.now();
    await this.transactions.execute({
      operation: 'RESEND_REGISTRATION_VERIFICATION',
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWaitMs: 5_000,
      timeoutMs: 10_000,
      deadlineMs: 20_000,
    }, async (tx) => {
      const existing = await tx.registrationRequest.findUnique({ where: { emailNormalized } });
      if (!existing || !['PENDING_EMAIL', 'EMAIL_VERIFIED'].includes(existing.status)) {
        await this.recordEvent(tx, { emailNormalized, eventType: 'REGISTRATION_RESEND_IGNORED', severity: 'WARNING', metadata });
        return null;
      }
      const updated = await tx.registrationRequest.update({
        where: { id: existing.id },
        data: {
          verificationTokenHash,
          verificationExpiresAt: expiresAt,
          status: 'PENDING_EMAIL',
          deliveryStatus: 'PENDING',
          deliveryGeneration: { increment: 1 },
          lastErrorCode: null,
        },
        select: { id: true, publicId: true, deliveryGeneration: true },
      });
      await this.recordEvent(tx, { registrationRequestId: updated.id, emailNormalized, eventType: 'REGISTRATION_VERIFICATION_RESENT', metadata });
      await this.outbox.append(tx, {
        eventType: REGISTRATION_VERIFICATION_REQUESTED,
        schemaVersion: 1,
        aggregateType: REGISTRATION_REQUEST_AGGREGATE,
        aggregateId: updated.publicId,
        payload: { deliveryGeneration: updated.deliveryGeneration },
        occurredAt: this.now(),
      });
      return true;
    });
    return { status: 'PENDING_VERIFICATION' as const };
  }

  async verify(token: string, metadata: RegistrationMetadata = {}) {
    const verificationTokenHash = hashToken(token);
    const claim = await this.transactions.execute({
      operation: 'CLAIM_REGISTRATION_VERIFICATION',
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWaitMs: 10_000,
      timeoutMs: 10_000,
      deadlineMs: 25_000,
    }, async (tx) => {
      const request = await tx.registrationRequest.findUnique({ where: { verificationTokenHash } });
      if (!request) {
        await this.recordEvent(tx, { emailNormalized: `token:${token}`, eventType: 'REGISTRATION_TOKEN_REJECTED', severity: 'WARNING', metadata });
        return { kind: 'invalid' as const };
      }
      if (request.status === 'COMPLETED') {
        await this.recordEvent(tx, { registrationRequestId: request.id, emailNormalized: request.emailNormalized, eventType: 'REGISTRATION_TOKEN_REPLAYED', metadata });
        if (!request.provisionedCompanyId || !request.provisionedUserId) return { kind: 'invalid' as const };
        return { kind: 'completed' as const, companyId: request.provisionedCompanyId.toString(), userId: request.provisionedUserId.toString() };
      }
      const staleProvisioning = request.status === 'PROVISIONING'
        && request.provisioningStartedAt
        && request.provisioningStartedAt.getTime() <= this.now().getTime() - 5 * 60_000;
      if (request.status === 'PROVISIONING' && !staleProvisioning) return { kind: 'in_progress' as const, requestId: request.id };
      if (request.verificationExpiresAt <= this.now() || !request.passwordHash || (!['PENDING_EMAIL', 'EMAIL_VERIFIED'].includes(request.status) && !staleProvisioning)) {
        await this.recordEvent(tx, { registrationRequestId: request.id, emailNormalized: request.emailNormalized, eventType: 'REGISTRATION_TOKEN_REJECTED', severity: 'WARNING', metadata });
        return { kind: 'invalid' as const };
      }
      const startedAt = this.now();
      const claimed = await tx.registrationRequest.updateMany({
        where: {
          id: request.id,
          ...(staleProvisioning ? { status: 'PROVISIONING' as const, provisioningStartedAt: request.provisioningStartedAt } : { status: { in: ['PENDING_EMAIL' as const, 'EMAIL_VERIFIED' as const] } }),
        },
        data: { status: 'PROVISIONING', verifiedAt: request.verifiedAt ?? startedAt, provisioningStartedAt: startedAt, lastErrorCode: null },
      });
      if (!claimed.count) return { kind: 'in_progress' as const, requestId: request.id };
      await this.recordEvent(tx, { registrationRequestId: request.id, emailNormalized: request.emailNormalized, eventType: staleProvisioning ? 'REGISTRATION_PROVISIONING_RESUMED' : 'REGISTRATION_EMAIL_VERIFIED', metadata });
      return { kind: 'claimed' as const, requestId: request.id };
    });

    if (claim.kind === 'invalid') throw new RegistrationError('INVALID_OR_EXPIRED_TOKEN');
    if (claim.kind === 'completed') return { status: 'COMPLETED' as const, companyId: claim.companyId, userId: claim.userId };
    if (claim.kind === 'in_progress') return this.waitForCompletion(claim.requestId);

    try {
      const outcome = await this.transactions.execute({
        operation: 'PROVISION_REGISTRATION',
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWaitMs: 10_000,
        timeoutMs: 45_000,
        deadlineMs: 60_000,
      }, async (tx) => {
        const request = await tx.registrationRequest.findUniqueOrThrow({ where: { id: claim.requestId } });
        if (request.status !== 'PROVISIONING' || !request.passwordHash) throw new RegistrationError('REGISTRATION_CONFLICT');
        const result = await this.provisioning.provisionPreparedInTransaction(tx, {
          organizationCode: `SELF_${request.publicId.replaceAll('-', '').toUpperCase()}`,
          organizationName: request.organizationName,
          companyCode: 'MAIN',
          companyName: request.companyName,
          timezone: request.timezone,
          baseCurrencyCode: request.baseCurrencyCode,
          adminEmail: request.emailNormalized,
          adminDisplayName: request.displayName,
        }, request.passwordHash, { requireNewAdminIdentity: true });
        const completedAt = this.now();
        await tx.registrationRequest.update({
          where: { id: request.id },
          data: {
            status: 'COMPLETED',
            passwordHash: null,
            completedAt,
            provisionedOrganizationId: BigInt(result.organization.id),
            provisionedCompanyId: BigInt(result.company.id),
            provisionedUserId: BigInt(result.administrator.id),
          },
        });
        await this.recordEvent(tx, { registrationRequestId: request.id, emailNormalized: request.emailNormalized, eventType: 'REGISTRATION_COMPLETED', metadata, details: { companyId: result.company.id } });
        await tx.securityEvent.create({
          data: {
            companyId: BigInt(result.company.id),
            userId: BigInt(result.administrator.id),
            eventType: 'SELF_REGISTRATION_COMPLETED',
            severity: 'INFO',
            emailSnapshot: request.emailNormalized,
            ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress } : {}),
            ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
            details: { registrationPublicId: request.publicId },
          },
        });
        return { companyId: result.company.id, userId: result.administrator.id };
      });

      return { status: 'COMPLETED' as const, companyId: outcome.companyId, userId: outcome.userId };
    } catch (error) {
      if (error instanceof ClientDisconnectedError) throw error;
      if (error instanceof RegistrationError) {
        assertRequestActive('RECORD_REGISTRATION_FAILURE');
        await this.recordProvisioningFailure(verificationTokenHash, 'REGISTRATION_CONFLICT', metadata);
        throw error;
      }
      if (error instanceof TransactionRetryExhaustedError || error instanceof TransactionDeadlineExceededError) {
        assertRequestActive('RECORD_REGISTRATION_FAILURE');
        await this.recordProvisioningFailure(verificationTokenHash, 'PROVISIONING_FAILED', metadata);
        throw error;
      }
      const conflict = error instanceof CompanyProvisioningError && ['ADMIN_USER_EXISTS', 'ADMIN_USER_DISABLED'].includes(error.reason)
        || error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      assertRequestActive('RECORD_REGISTRATION_FAILURE');
      await this.recordProvisioningFailure(verificationTokenHash, conflict ? 'REGISTRATION_CONFLICT' : 'PROVISIONING_FAILED', metadata);
      throw new RegistrationError(conflict ? 'REGISTRATION_CONFLICT' : 'PROVISIONING_FAILED');
    }
  }

  private async recordProvisioningFailure(tokenHash: Uint8Array<ArrayBuffer>, code: 'REGISTRATION_CONFLICT' | 'PROVISIONING_FAILED', metadata: RegistrationMetadata) {
    assertRequestActive('RECORD_REGISTRATION_FAILURE');
    await this.transactions.execute({ operation: 'RECORD_REGISTRATION_FAILURE' }, async (tx) => {
      const request = await tx.registrationRequest.findUnique({ where: { verificationTokenHash: tokenHash } });
      if (!request || request.status !== 'PROVISIONING') return;
      await tx.registrationRequest.update({ where: { id: request.id }, data: { status: code === 'REGISTRATION_CONFLICT' ? 'REJECTED' : 'EMAIL_VERIFIED', lastErrorCode: code } });
      await this.recordEvent(tx, { registrationRequestId: request.id, emailNormalized: request.emailNormalized, eventType: code, severity: code === 'REGISTRATION_CONFLICT' ? 'HIGH' : 'WARNING', metadata });
    });
  }

  private async waitForCompletion(requestId: bigint) {
    // Provisioning creates the complete default chart and can legitimately take
    // more than two seconds on a loaded database. Keep concurrent token replays
    // attached to the same result for a bounded ten-second window.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await sleepWithinRequest(200);
      assertRequestActive('WAIT_FOR_REGISTRATION_COMPLETION');
      const request = await this.prisma.registrationRequest.findUnique({ where: { id: requestId }, select: { status: true, provisionedCompanyId: true, provisionedUserId: true } });
      if (request?.status === 'COMPLETED' && request.provisionedCompanyId && request.provisionedUserId) {
        return { status: 'COMPLETED' as const, companyId: request.provisionedCompanyId.toString(), userId: request.provisionedUserId.toString() };
      }
      if (!request || request.status !== 'PROVISIONING') break;
    }
    return { status: 'IN_PROGRESS' as const };
  }

  private recordEvent(tx: Prisma.TransactionClient, input: Parameters<RegistrationEventRecorder['record']>[1]) {
    return this.events.record(tx, input);
  }
}
