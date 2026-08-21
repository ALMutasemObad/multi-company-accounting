import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { RegistrationMailer } from '../src/registration/registration-mailer.js';
import {
  deriveRegistrationVerificationToken,
  RegistrationVerificationHandler,
} from '../src/registration/registration-verification-handler.js';

describe('registration verification outbox contract', () => {
  it('derives a retry-stable opaque token that changes with event or secret', () => {
    const first = deriveRegistrationVerificationToken('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(deriveRegistrationVerificationToken('11111111-1111-4111-8111-111111111111', 'a'.repeat(32))).toBe(first);
    expect(deriveRegistrationVerificationToken('22222222-2222-4222-8222-222222222222', 'a'.repeat(32))).not.toBe(first);
    expect(deriveRegistrationVerificationToken('11111111-1111-4111-8111-111111111111', 'b'.repeat(32))).not.toBe(first);
  });

  it('rejects an unsupported payload permanently before database or network access', async () => {
    const prisma = { registrationRequest: { findUnique: vi.fn() } } as unknown as PrismaClient;
    const mailer: RegistrationMailer = { sendVerification: vi.fn() };
    const handler = new RegistrationVerificationHandler(prisma, mailer, {
      tokenTtlHours: 24,
      publicAppUrl: 'https://finance.example.com',
      tokenSecret: 'unit-test-registration-token-secret',
      auditPepper: 'unit-test-registration-audit-pepper',
    });
    await expect(handler.handle({
      id: 1n,
      eventId: '11111111-1111-4111-8111-111111111111',
      eventType: 'RegistrationVerificationRequested',
      schemaVersion: 1,
      aggregateType: 'RegistrationRequest',
      aggregateId: 'request-id',
      companyId: null,
      payload: { deliveryGeneration: 'not-a-number' },
      occurredAt: new Date(),
      attemptCount: 1,
      maxAttempts: 8,
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'REGISTRATION_VERIFICATION_PAYLOAD_INVALID' });
    expect(prisma.registrationRequest.findUnique).not.toHaveBeenCalled();
    expect(mailer.sendVerification).not.toHaveBeenCalled();
  });
});
