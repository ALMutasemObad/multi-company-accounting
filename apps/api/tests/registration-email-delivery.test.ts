import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { hashToken } from '../src/auth/session-tokens.js';
import { OutboxWorker } from '../src/outbox/outbox-worker.js';
import { REGISTRATION_REQUEST_AGGREGATE, REGISTRATION_VERIFICATION_REQUESTED, type OutboxEnvelope } from '../src/outbox/outbox.js';
import { createRegistrationRouter } from '../src/registration/registration-router.js';
import type { RegistrationMailer } from '../src/registration/registration-mailer.js';
import type { RegistrationService } from '../src/registration/registration-service.js';
import { deriveRegistrationVerificationToken, RegistrationVerificationHandler } from '../src/registration/registration-verification-handler.js';
import type { AuthService } from '../src/auth/auth-service.js';

const event = (generation = 1): OutboxEnvelope => ({
  id: 1n,
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: REGISTRATION_VERIFICATION_REQUESTED,
  schemaVersion: 1,
  aggregateType: REGISTRATION_REQUEST_AGGREGATE,
  aggregateId: 'registration-public-id',
  companyId: null,
  payload: { deliveryGeneration: generation },
  occurredAt: new Date('2026-09-06T10:00:00.000Z'),
  attemptCount: 1,
  maxAttempts: 2,
});

function handlerFixture(deliveryGeneration = 1) {
  const requestRow: {
    id: bigint; emailNormalized: string; locale: string; status: string;
    deliveryStatus: string; deliveryGeneration: number; verificationTokenHash: Uint8Array<ArrayBufferLike>;
  } = {
    id: 7n,
    emailNormalized: 'new@example.com',
    locale: 'en',
    status: 'PENDING_EMAIL',
    deliveryStatus: 'PENDING',
    deliveryGeneration,
    verificationTokenHash: new Uint8Array(32),
  };
  const registrationEvent = { create: vi.fn().mockResolvedValue({}) };
  const registrationRequest = {
    findUnique: vi.fn().mockImplementation(async () => ({ ...requestRow })),
    updateMany: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (data.verificationTokenHash instanceof Uint8Array) requestRow.verificationTokenHash = data.verificationTokenHash;
      if (typeof data.deliveryStatus === 'string') requestRow.deliveryStatus = data.deliveryStatus;
      return { count: 1 };
    }),
  };
  const prisma = {
    registrationRequest,
    registrationEvent,
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ registrationRequest, registrationEvent }),
  } as unknown as PrismaClient;
  return { prisma, requestRow, registrationRequest, registrationEvent };
}

describe('registration delivery state and privacy contract', () => {
  it('records PENDING then SENT only after the mail adapter accepts the current generation', async () => {
    const fixture = handlerFixture();
    const mailer: RegistrationMailer = { sendVerification: vi.fn().mockResolvedValue(undefined) };
    const handler = new RegistrationVerificationHandler(fixture.prisma, mailer, {
      tokenTtlHours: 24,
      publicAppUrl: 'https://finance.example.com',
      tokenSecret: 'unit-test-registration-token-secret',
      auditPepper: 'unit-test-registration-audit-pepper',
      now: () => new Date('2026-09-06T10:00:00.000Z'),
    });

    await handler.handle(event(), new AbortController().signal);

    expect(fixture.registrationRequest.updateMany.mock.calls.map(([call]) => call.data.deliveryStatus)).toEqual(['PENDING', 'SENT']);
    expect(fixture.requestRow.deliveryStatus).toBe('SENT');
    expect(fixture.registrationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'REGISTRATION_EMAIL_SENT' }) }));
  });

  it('ignores superseded generations and duplicate replay after SENT', async () => {
    const fixture = handlerFixture(2);
    const mailer: RegistrationMailer = { sendVerification: vi.fn().mockResolvedValue(undefined) };
    const tokenSecret = 'unit-test-registration-token-secret';
    const handler = new RegistrationVerificationHandler(fixture.prisma, mailer, {
      tokenTtlHours: 24, publicAppUrl: 'https://finance.example.com', tokenSecret,
      auditPepper: 'unit-test-registration-audit-pepper',
    });

    await handler.handle(event(1), new AbortController().signal);
    expect(mailer.sendVerification).not.toHaveBeenCalled();

    fixture.requestRow.deliveryStatus = 'SENT';
    fixture.requestRow.verificationTokenHash = hashToken(deriveRegistrationVerificationToken(event(2).eventId, tokenSecret));
    await handler.handle(event(2), new AbortController().signal);
    expect(mailer.sendVerification).not.toHaveBeenCalled();
    expect(fixture.registrationRequest.updateMany).not.toHaveBeenCalled();
  });

  it('records FAILED internally and rethrows without exposing a provider detail through HTTP', async () => {
    const fixture = handlerFixture();
    const handler = new RegistrationVerificationHandler(fixture.prisma, {
      sendVerification: vi.fn().mockRejectedValue(new Error('provider said mailbox new@example.com rejected')),
    }, {
      tokenTtlHours: 24, publicAppUrl: 'https://finance.example.com',
      tokenSecret: 'unit-test-registration-token-secret', auditPepper: 'unit-test-registration-audit-pepper',
    });
    await expect(handler.handle(event(), new AbortController().signal)).rejects.toThrow('provider said mailbox');
    expect(fixture.requestRow.deliveryStatus).toBe('FAILED');
    expect(fixture.registrationEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'REGISTRATION_EMAIL_FAILED', details: { reason: 'EMAIL_DELIVERY_FAILED' } }),
    }));

    const registration = {
      start: vi.fn().mockResolvedValue({ status: 'PENDING_VERIFICATION' }),
      resend: vi.fn().mockResolvedValue({ status: 'PENDING_VERIFICATION', deliveryStatus: 'FAILED', lastErrorCode: 'PROVIDER_PRIVATE_DETAIL' }),
    } as unknown as RegistrationService;
    const auth = { validatePreAuth: vi.fn().mockResolvedValue(undefined) } as unknown as AuthService;
    const app = express().use(express.json()).use('/auth/register', createRegistrationRouter(auth, registration));
    const response = await request(app).post('/auth/register/resend').set('X-CSRF-Token', 'test').send({ email: 'new@example.com' });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'PENDING_VERIFICATION' });
    expect(JSON.stringify(response.body)).not.toMatch(/FAILED|provider|lastError/iu);
  });

  it('retries with bounded backoff and dead-letters on the configured final attempt', async () => {
    let now = new Date('2026-09-06T10:00:00.000Z');
    const row = { ...event(), attemptCount: 0, status: 'PENDING', availableAt: now, lockedAt: null, lockToken: null, lastErrorCode: null };
    const outboxEvent = {
      findFirst: vi.fn().mockImplementation(async () => row.status === 'PENDING' && row.availableAt <= now ? { ...row } : null),
      updateMany: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const { attemptCount, ...plainData } = data;
        if (attemptCount) row.attemptCount += 1;
        Object.assign(row, plainData);
        return { count: 1 };
      }),
    };
    const worker = new OutboxWorker({ outboxEvent } as unknown as PrismaClient, new Map([
      [REGISTRATION_VERIFICATION_REQUESTED, vi.fn().mockRejectedValue(new Error('EMAIL_DELIVERY_FAILED'))],
    ]), {
      pollIntervalMs: 60_000, leaseMs: 30_000, batchSize: 1, baseBackoffMs: 1_000,
      handlerTimeoutMs: 8_000, retentionDays: 30, now: () => now, random: () => 0.5,
    });

    await expect(worker.runOnce()).resolves.toBe(1);
    expect(row).toMatchObject({ status: 'PENDING', attemptCount: 1, lastErrorCode: 'EMAIL_DELIVERY_FAILED' });
    expect(row.availableAt.getTime() - now.getTime()).toBe(500);
    now = new Date(row.availableAt);
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(row).toMatchObject({ status: 'FAILED', attemptCount: 2, lastErrorCode: 'EMAIL_DELIVERY_FAILED' });
  });
});
