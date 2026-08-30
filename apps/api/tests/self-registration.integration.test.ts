import { hash, verify } from 'argon2';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { defaultChartDefinitions } from '../src/accounts/default-chart-template.js';
import { createDatabase } from '../src/database.js';
import { PrismaOutboxAppender, REGISTRATION_VERIFICATION_REQUESTED } from '../src/outbox/outbox.js';
import { OutboxWorker } from '../src/outbox/outbox-worker.js';
import { createCompanyProvisioningService } from '../src/composition/create-company-provisioning-service.js';
import { createRegistrationOwnerPorts } from '../src/composition/create-registration-owner-ports.js';
import { permissionDefinitions } from '../src/platform/reference-data.js';
import type { RegistrationMailer, RegistrationVerificationMessage } from '../src/registration/registration-mailer.js';
import { RegistrationService } from '../src/registration/registration-service.js';
import { RegistrationVerificationHandler } from '../src/registration/registration-verification-handler.js';

const enabled = process.env.RUN_DB_TESTS === 'true' && Boolean(process.env.DATABASE_URL);

class CapturingMailer implements RegistrationMailer {
  messages: RegistrationVerificationMessage[] = [];
  attempts: RegistrationVerificationMessage[] = [];
  fail = false;
  async sendVerification(message: RegistrationVerificationMessage, signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason;
    this.attempts.push(message);
    if (this.fail) throw new Error('SIMULATED_EMAIL_OUTAGE');
    this.messages.push(message);
  }
}

describe.runIf(enabled)('self-registration with MariaDB', () => {
  let prisma: PrismaClient;
  let service: RegistrationService;
  let worker: OutboxWorker;
  let mailer: CapturingMailer;
  const emails = [
    'it.registration@mcap.local',
    'it.registration.existing@mcap.local',
    'it.registration.delivery@mcap.local',
    'it.registration.resend@mcap.local',
    'it.registration.claim@mcap.local',
    'it.registration.rollback@mcap.local',
  ];
  const auditPepper = 'integration-registration-audit-pepper-123456';
  const tokenSecret = 'integration-registration-token-secret-123456';
  const emailHash = (email: string) => new Uint8Array(createHmac('sha256', auditPepper).update(email, 'utf8').digest());

  const registrationInput = (email: string, password = 'Registration integration 2026') => ({
    email,
    password,
    displayName: 'مدير التسجيل',
    organizationName: 'مجموعة التسجيل',
    companyName: 'شركة التسجيل',
    timezone: 'Asia/Aden',
    baseCurrencyCode: 'YER',
    locale: 'ar' as const,
    chartTemplateCode: 'SMALL_BUSINESS_GENERAL',
  });

  async function cleanup() {
    const requests = await prisma.registrationRequest.findMany({ where: { emailNormalized: { in: emails } }, select: { publicId: true } });
    if (requests.length) await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'RegistrationRequest', aggregateId: { in: requests.map(({ publicId }) => publicId) } } });
    const users = await prisma.user.findMany({ where: { emailNormalized: { in: emails } }, select: { id: true } });
    const userIds = users.map(({ id }) => id);
    const assignments = userIds.length ? await prisma.userCompany.findMany({ where: { userId: { in: userIds } }, select: { companyId: true } }) : [];
    const companyIds = assignments.map(({ companyId }) => companyId);
    const companies = companyIds.length ? await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { organizationId: true } }) : [];
    const organizationIds = companies.map(({ organizationId }) => organizationId);

    await prisma.registrationRequest.deleteMany({ where: { emailNormalized: { in: emails } } });
    for (const email of emails) await prisma.registrationEvent.deleteMany({ where: { emailHash: emailHash(email) } });
    if (companyIds.length) {
      const roles = await prisma.role.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } });
      const subscriptions = await prisma.platformSubscription.findMany({
        where: { companyId: { in: companyIds } },
        select: { planVersion: { select: { id: true, planId: true } } },
      });
      const planVersionIds = subscriptions.map(({ planVersion }) => planVersion.id);
      const planIds = subscriptions.map(({ planVersion }) => planVersion.planId);
      await prisma.platformSubscriptionEntitlement.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.platformSubscription.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.platformPlanEntitlement.deleteMany({ where: { planVersionId: { in: planVersionIds } } });
      await prisma.platformPlanVersion.deleteMany({ where: { id: { in: planVersionIds } } });
      await prisma.platformPlan.deleteMany({ where: { id: { in: planIds } } });
      await prisma.securityEvent.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.auditLog.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.userCompanyRole.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles.map(({ id }) => id) } } });
      await prisma.role.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.userCompany.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.companyCurrency.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.account.updateMany({ where: { companyId: { in: companyIds } }, data: { parentAccountId: null } });
      await prisma.account.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    for (const organizationId of organizationIds) {
      if (await prisma.company.count({ where: { organizationId } }) === 0) await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  function createWorker(handler: RegistrationVerificationHandler) {
    return new OutboxWorker(prisma, new Map([[REGISTRATION_VERIFICATION_REQUESTED, handler.handle]]), {
      pollIntervalMs: 50,
      leaseMs: 5_000,
      batchSize: 10,
      baseBackoffMs: 10,
      handlerTimeoutMs: 2_000,
      retentionDays: 30,
      random: () => 0.5,
    });
  }

  beforeAll(async () => {
    prisma = createDatabase(process.env.DATABASE_URL!);
    await cleanup();
    await prisma.currency.upsert({
      where: { scopeKey_code: { scopeKey: 'GLOBAL', code: 'YER' } },
      update: { nameAr: 'ريال يمني', decimals: 2, isActive: true, scope: 'GLOBAL', ownerCompanyId: null },
      create: { code: 'YER', nameAr: 'ريال يمني', decimals: 2, scope: 'GLOBAL', scopeKey: 'GLOBAL' },
    });
    mailer = new CapturingMailer();
    const outbox = new PrismaOutboxAppender(3);
    service = new RegistrationService(
      prisma,
      createCompanyProvisioningService(prisma),
      outbox,
      createRegistrationOwnerPorts(prisma),
      { auditPepper },
    );
    const handler = new RegistrationVerificationHandler(prisma, mailer, {
      tokenTtlHours: 24,
      publicAppUrl: 'http://localhost:5173',
      tokenSecret,
      auditPepper,
    });
    worker = createWorker(handler);
  });
  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  it('commits the outbox before mail, then provisions atomically once under concurrent verification', async () => {
    const email = emails[0]!;
    const password = 'Registration integration 2026';
    const beforeMessages = mailer.messages.length;
    await expect(service.start(registrationInput(email, password), { ipAddress: '127.0.0.1', userAgent: 'integration-test' })).resolves.toEqual({ status: 'PENDING_VERIFICATION' });

    expect(mailer.messages).toHaveLength(beforeMessages);
    expect(await prisma.user.count({ where: { emailNormalized: email } })).toBe(0);
    const pending = await prisma.registrationRequest.findUniqueOrThrow({ where: { emailNormalized: email } });
    expect(pending.status).toBe('PENDING_EMAIL');
    expect(pending.passwordHash).toMatch(/^\$argon2/u);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: pending.publicId, status: 'PENDING' } })).toBe(1);

    await expect(worker.runOnce()).resolves.toBe(1);
    const message = mailer.messages.find((candidate) => candidate.to === email)!;
    expect(message).toBeDefined();
    const deliveredOutbox = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: pending.publicId } });
    const beforeReplay = mailer.messages.filter((candidate) => candidate.to === email).length;
    await prisma.outboxEvent.update({
      where: { id: deliveredOutbox.id },
      data: { status: 'PROCESSING', processedAt: null, lockToken: 'expired-after-delivery', lockedAt: new Date(Date.now() - 10_000) },
    });
    await worker.runOnce();
    expect(mailer.messages.filter((candidate) => candidate.to === email)).toHaveLength(beforeReplay);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: deliveredOutbox.id } })).toMatchObject({ status: 'PROCESSED', attemptCount: 2 });
    const token = new URLSearchParams(new URL(message.verificationUrl).hash.split('?', 2)[1]).get('token')!;
    const [first, concurrent] = await Promise.all([service.verify(token), service.verify(token)]);
    expect(first.status).toBe('COMPLETED');
    expect(concurrent.status).toBe('COMPLETED');
    if (first.status !== 'COMPLETED' || concurrent.status !== 'COMPLETED') throw new Error('registration did not complete');
    expect(concurrent.companyId).toBe(first.companyId);

    const completed = await prisma.registrationRequest.findUniqueOrThrow({ where: { emailNormalized: email } });
    expect(completed).toMatchObject({ status: 'COMPLETED', passwordHash: null, deliveryStatus: 'SENT' });
    const user = await prisma.user.findUniqueOrThrow({ where: { emailNormalized: email } });
    expect(await verify(user.passwordHash, password)).toBe(true);
    const companyId = BigInt(first.companyId);
    const role = await prisma.role.findUniqueOrThrow({ where: { companyId_code: { companyId, code: 'ADMINISTRATOR' } }, include: { _count: { select: { permissions: true } } } });
    expect(role._count.permissions).toBe(permissionDefinitions.length);
    expect(await prisma.account.count({ where: { companyId, sourceTemplateCode: 'SMALL_BUSINESS_GENERAL' } })).toBe(defaultChartDefinitions.length);
    expect(await prisma.securityEvent.count({ where: { companyId, eventType: 'SELF_REGISTRATION_COMPLETED' } })).toBe(1);
    await expect(service.verify(token)).resolves.toEqual(first);
    expect(await prisma.company.count({ where: { id: companyId } })).toBe(1);
  }, 60_000);

  it('does not enumerate an existing identity or enqueue an email', async () => {
    const email = emails[1]!;
    await prisma.user.create({ data: { emailNormalized: email, displayName: 'Existing', passwordHash: await hash('Existing identity password') } });
    const beforeMessages = mailer.messages.length;
    const beforeOutbox = await prisma.outboxEvent.count();
    await expect(service.start(registrationInput(email, 'Attacker supplied password'))).resolves.toEqual({ status: 'PENDING_VERIFICATION' });
    expect(mailer.messages).toHaveLength(beforeMessages);
    expect(await prisma.outboxEvent.count()).toBe(beforeOutbox);
    expect(await prisma.registrationRequest.count({ where: { emailNormalized: email } })).toBe(0);
    expect(await prisma.registrationEvent.count({ where: { emailHash: emailHash(email), eventType: 'REGISTRATION_EXISTING_IDENTITY_ATTEMPT' } })).toBe(1);
  });

  it('rolls back the registration request and audit event when the outbox append fails', async () => {
    const email = emails[5]!;
    const failingService = new RegistrationService(prisma, createCompanyProvisioningService(prisma), {
      append: async () => { throw new Error('SIMULATED_OUTBOX_WRITE_FAILURE'); },
    }, createRegistrationOwnerPorts(prisma), { auditPepper });
    await expect(failingService.start(registrationInput(email, 'Atomic rollback password'))).rejects.toThrow('SIMULATED_OUTBOX_WRITE_FAILURE');
    expect(await prisma.registrationRequest.findUnique({ where: { emailNormalized: email } })).toBeNull();
    expect(await prisma.registrationEvent.count({ where: { emailHash: emailHash(email) } })).toBe(0);
  });

  it('retries a provider outage with backoff and the same valid derived token', async () => {
    const email = emails[2]!;
    mailer.fail = true;
    await service.start(registrationInput(email, 'Delivery recovery password'));
    await expect(worker.runOnce()).resolves.toBe(1);
    const request = await prisma.registrationRequest.findUniqueOrThrow({ where: { emailNormalized: email } });
    const retry = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: request.publicId } });
    expect(retry).toMatchObject({ status: 'PENDING', attemptCount: 1, lastErrorCode: 'SIMULATED_EMAIL_OUTAGE' });
    expect(request.deliveryStatus).toBe('FAILED');
    const firstUrl = mailer.attempts.find((message) => message.to === email)!.verificationUrl;

    mailer.fail = false;
    await prisma.outboxEvent.update({ where: { id: retry.id }, data: { availableAt: new Date(0) } });
    await expect(worker.runOnce()).resolves.toBe(1);
    const recovered = await prisma.registrationRequest.findUniqueOrThrow({ where: { emailNormalized: email } });
    const delivered = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: retry.id } });
    expect(recovered.deliveryStatus).toBe('SENT');
    expect(delivered).toMatchObject({ status: 'PROCESSED', attemptCount: 2, lastErrorCode: null });
    const urls = mailer.attempts.filter((message) => message.to === email).map((message) => message.verificationUrl);
    expect(urls).toEqual([firstUrl, firstUrl]);
  });

  it('rotates the token and supersedes the prior generation on explicit resend', async () => {
    const email = emails[3]!;
    await service.start(registrationInput(email, 'Resend rotation password'));
    await worker.runOnce();
    const before = await prisma.registrationRequest.findUniqueOrThrow({ where: { emailNormalized: email } });
    const firstUrl = mailer.messages.find((message) => message.to === email)!.verificationUrl;

    await service.resend(email);
    await worker.runOnce();
    const after = await prisma.registrationRequest.findUniqueOrThrow({ where: { emailNormalized: email } });
    const urls = mailer.messages.filter((message) => message.to === email).map((message) => message.verificationUrl);
    expect(after.deliveryGeneration).toBe(before.deliveryGeneration + 1);
    expect(Buffer.from(after.verificationTokenHash).equals(Buffer.from(before.verificationTokenHash))).toBe(false);
    expect(urls).toHaveLength(2);
    expect(urls[1]).not.toBe(firstUrl);
  });

  it('allows only one of two workers to claim the same event', async () => {
    const email = emails[4]!;
    await service.start(registrationInput(email, 'Concurrent claim password'));
    const request = await prisma.registrationRequest.findUniqueOrThrow({ where: { emailNormalized: email } });
    await prisma.outboxEvent.updateMany({
      where: { aggregateId: request.publicId },
      data: { status: 'PROCESSING', lockToken: 'expired-lease-token', lockedAt: new Date(Date.now() - 10_000) },
    });
    const secondHandler = new RegistrationVerificationHandler(prisma, mailer, {
      tokenTtlHours: 24,
      publicAppUrl: 'http://localhost:5173',
      tokenSecret,
      auditPepper,
    });
    const secondWorker = createWorker(secondHandler);
    const before = mailer.messages.filter((message) => message.to === email).length;
    const claims = await Promise.all([worker.runOnce(), secondWorker.runOnce()]);
    expect(claims.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(mailer.messages.filter((message) => message.to === email)).toHaveLength(before + 1);
  });

  it('dead-letters unsupported events and prunes only old processed rows', async () => {
    const unsupported = await prisma.outboxEvent.create({
      data: {
        eventType: 'UnsupportedEventOccurred',
        schemaVersion: 1,
        aggregateType: 'TestAggregate',
        aggregateId: 'dead-letter-test',
        payload: {},
        maxAttempts: 8,
      },
    });
    await worker.runOnce();
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: unsupported.id } })).toMatchObject({
      status: 'FAILED',
      attemptCount: 1,
      lastErrorCode: 'OUTBOX_HANDLER_NOT_FOUND',
    });

    const old = new Date(Date.now() - 31 * 86_400_000);
    const processed = await prisma.outboxEvent.create({
      data: {
        eventType: 'TestEventProcessed',
        schemaVersion: 1,
        aggregateType: 'TestAggregate',
        aggregateId: 'cleanup-processed-test',
        payload: {},
        status: 'PROCESSED',
        processedAt: old,
        maxAttempts: 1,
      },
    });
    const failed = await prisma.outboxEvent.create({
      data: {
        eventType: 'TestEventFailed',
        schemaVersion: 1,
        aggregateType: 'TestAggregate',
        aggregateId: 'cleanup-failed-test',
        payload: {},
        status: 'FAILED',
        lastErrorCode: 'TEST_FAILURE',
        lastErrorAt: old,
        maxAttempts: 1,
      },
    });
    await expect(worker.cleanupProcessed()).resolves.toBeGreaterThanOrEqual(1);
    expect(await prisma.outboxEvent.findUnique({ where: { id: processed.id } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: failed.id } })).not.toBeNull();
    await prisma.outboxEvent.deleteMany({ where: { id: { in: [unsupported.id, failed.id] } } });
  });
});
