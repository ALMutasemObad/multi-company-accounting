import { hash, verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PasswordResetHandler } from '../src/auth/password-reset-handler.js';
import { PasswordResetService } from '../src/auth/password-reset-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createDatabase } from '../src/database.js';
import { PASSWORD_RESET_REQUESTED, PrismaOutboxAppender, type OutboxEnvelope } from '../src/outbox/outbox.js';
import type { PasswordResetMailer, PasswordResetMessage } from '../src/registration/registration-mailer.js';
import { testAuthOptions } from './helpers/test-auth-options.js';

const enabled = process.env.RUN_DB_TESTS === 'true';
const databaseUrl = process.env.DATABASE_URL ?? '';
const prisma = enabled ? createDatabase(databaseUrl) : null;
const email = 'password-reset.integration@mcap.local';
const oldPassword = 'Initial-password-2026!';
const newPassword = 'Replacement-password-2026!';

class MemoryPasswordResetMailer implements PasswordResetMailer {
  messages: PasswordResetMessage[] = [];
  async sendPasswordReset(message: PasswordResetMessage) { this.messages.push(message); }
}

describe.runIf(enabled)('password reset with MariaDB', () => {
  let userId = 0n;
  let companyId = 0n;

  beforeAll(async () => {
    const admin = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId: admin.id, isActive: true } })).companyId;
    await prisma!.outboxEvent.deleteMany({ where: { eventType: PASSWORD_RESET_REQUESTED } });
    const existing = await prisma!.user.findUnique({ where: { emailNormalized: email } });
    if (existing) {
      await prisma!.securityEvent.deleteMany({ where: { userId: existing.id } });
      await prisma!.session.deleteMany({ where: { userId: existing.id } });
      await prisma!.passwordResetRequest.deleteMany({ where: { userId: existing.id } });
      await prisma!.userCompanyRole.deleteMany({ where: { userId: existing.id } });
      await prisma!.userCompany.deleteMany({ where: { userId: existing.id } });
      await prisma!.user.delete({ where: { id: existing.id } });
    }
    const user = await prisma!.user.create({
      data: { emailNormalized: email, passwordHash: await hash(oldPassword), displayName: 'مستخدم استعادة الاختبار' },
    });
    userId = user.id;
    await prisma!.userCompany.create({ data: { userId, companyId } });
  });

  afterAll(async () => {
    await prisma!.outboxEvent.deleteMany({ where: { eventType: PASSWORD_RESET_REQUESTED } });
    if (userId) {
      await prisma!.securityEvent.deleteMany({ where: { userId } });
      await prisma!.session.deleteMany({ where: { userId } });
      await prisma!.passwordResetRequest.deleteMany({ where: { userId } });
      await prisma!.userCompanyRole.deleteMany({ where: { userId } });
      await prisma!.userCompany.deleteMany({ where: { userId } });
      await prisma!.user.deleteMany({ where: { id: userId } });
    }
    await prisma!.$disconnect();
  });

  it('does not enumerate identities and completes a one-time reset with session revocation', async () => {
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, testAuthOptions(prisma!));
    const outbox = new PrismaOutboxAppender(8);
    const passwordReset = new PasswordResetService(prisma!, { hash }, outbox, { tokenTtlMinutes: 60 });
    const app = createApp({
      NODE_ENV: 'test', PORT: 3000, DATABASE_URL: databaseUrl, WEB_ORIGIN: 'http://localhost:5173',
      SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12,
      PASSWORD_RESET_ENABLED: true, PASSWORD_RESET_RATE_LIMIT_MAX: 10,
    }, { auth, passwordReset });

    const resetAgent = request.agent(app);
    const resetCsrf = await resetAgent.get('/api/v1/auth/csrf').expect(200);
    const accepted = await resetAgent.post('/api/v1/auth/password/forgot')
      .set('X-CSRF-Token', resetCsrf.body.csrfToken)
      .send({ email, locale: 'ar' })
      .expect(202);
    const unknown = await resetAgent.post('/api/v1/auth/password/forgot')
      .set('X-CSRF-Token', resetCsrf.body.csrfToken)
      .send({ email: 'missing-password-reset@example.com', locale: 'ar' })
      .expect(202);
    expect(accepted.body).toEqual(unknown.body);
    const replacement = await resetAgent.post('/api/v1/auth/password/forgot')
      .set('X-CSRF-Token', resetCsrf.body.csrfToken)
      .send({ email, locale: 'en' })
      .expect(202);
    expect(replacement.body).toEqual(accepted.body);
    expect(await prisma!.passwordResetRequest.count({ where: { userId, status: 'PENDING' } })).toBe(1);
    expect(await prisma!.passwordResetRequest.count({ where: { userId, status: 'REVOKED' } })).toBe(1);

    const resetRequest = await prisma!.passwordResetRequest.findFirstOrThrow({ where: { userId, status: 'PENDING' } });
    const outboxEvent = await prisma!.outboxEvent.findFirstOrThrow({ where: { eventType: PASSWORD_RESET_REQUESTED, aggregateId: resetRequest.publicId } });
    expect(outboxEvent.payload).toEqual({});
    const mailer = new MemoryPasswordResetMailer();
    const handler = new PasswordResetHandler(prisma!, mailer, {
      tokenTtlMinutes: 60,
      publicAppUrl: 'http://localhost:5173',
      tokenSecret: 'password-reset-integration-secret-at-least-32-chars',
    });
    await handler.handle({
      id: outboxEvent.id,
      eventId: outboxEvent.eventId,
      eventType: outboxEvent.eventType,
      schemaVersion: outboxEvent.schemaVersion,
      aggregateType: outboxEvent.aggregateType,
      aggregateId: outboxEvent.aggregateId,
      companyId: outboxEvent.companyId,
      payload: outboxEvent.payload,
      occurredAt: outboxEvent.occurredAt,
      attemptCount: outboxEvent.attemptCount,
      maxAttempts: outboxEvent.maxAttempts,
    } satisfies OutboxEnvelope, new AbortController().signal);
    expect(mailer.messages).toHaveLength(1);
    const token = new URL(mailer.messages[0]!.resetUrl).hash.split('token=', 2)[1];
    expect(token).toBeTruthy();

    const loginAgent = request.agent(app);
    const loginCsrf = await loginAgent.get('/api/v1/auth/csrf').expect(200);
    await loginAgent.post('/api/v1/auth/login').set('X-CSRF-Token', loginCsrf.body.csrfToken).send({ email, password: oldPassword }).expect(200);
    expect(await prisma!.session.count({ where: { userId, revokedAt: null } })).toBe(1);

    const concurrentReset = () => resetAgent.post('/api/v1/auth/password/reset')
      .set('X-CSRF-Token', resetCsrf.body.csrfToken)
      .send({ token, password: newPassword });
    const resetResponses = await Promise.all([concurrentReset(), concurrentReset()]);
    expect(resetResponses.map(({ status }) => status).sort()).toEqual([204, 400]);
    expect(await prisma!.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect((await prisma!.passwordResetRequest.findUniqueOrThrow({ where: { id: resetRequest.id } })).status).toBe('USED');
    expect(await prisma!.securityEvent.count({ where: { userId, eventType: 'PASSWORD_RESET_COMPLETED' } })).toBeGreaterThan(0);

    await resetAgent.post('/api/v1/auth/password/reset')
      .set('X-CSRF-Token', resetCsrf.body.csrfToken)
      .send({ token, password: 'Another-password-2026!' })
      .expect(400);
    const oldLogin = request.agent(app);
    const oldCsrf = await oldLogin.get('/api/v1/auth/csrf').expect(200);
    await oldLogin.post('/api/v1/auth/login').set('X-CSRF-Token', oldCsrf.body.csrfToken).send({ email, password: oldPassword }).expect(401);
    const newLogin = request.agent(app);
    const newCsrf = await newLogin.get('/api/v1/auth/csrf').expect(200);
    await newLogin.post('/api/v1/auth/login').set('X-CSRF-Token', newCsrf.body.csrfToken).send({ email, password: newPassword }).expect(200);
  });
});
