import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { derivePasswordResetToken } from '../src/auth/password-reset-handler.js';
import { PasswordResetHandler } from '../src/auth/password-reset-handler.js';
import type { PasswordResetMailer } from '../src/registration/registration-mailer.js';
import { deriveRegistrationVerificationToken } from '../src/registration/registration-verification-handler.js';

describe('password reset token derivation', () => {
  it('is stable for retries and domain-separated from registration tokens', () => {
    const secret = 'test-secret-that-is-at-least-thirty-two-characters';
    const eventId = '5eeb7f58-46fd-46d6-b0fd-8f68df39f05c';
    expect(derivePasswordResetToken(eventId, secret)).toBe(derivePasswordResetToken(eventId, secret));
    expect(derivePasswordResetToken(eventId, secret)).not.toBe(deriveRegistrationVerificationToken(eventId, secret));
  });

  it('logs the safe Resend acceptance id without the recipient or reset URL', async () => {
    const messageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const passwordResetRequest = {
      findUnique: vi.fn().mockResolvedValue({
        id: 9n,
        locale: 'ar',
        status: 'PENDING',
        tokenHash: null,
        deliveryStatus: 'PENDING',
        user: { emailNormalized: 'owner@example.com', isActive: true },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = { passwordResetRequest } as unknown as PrismaClient;
    const mailer: PasswordResetMailer = {
      sendPasswordReset: vi.fn().mockResolvedValue({ provider: 'resend', messageId }),
    };
    const handler = new PasswordResetHandler(prisma, mailer, {
      tokenTtlMinutes: 60,
      publicAppUrl: 'https://finance.example.com',
      tokenSecret: 'test-secret-that-is-at-least-thirty-two-characters',
    });
    const logged: string[] = [];
    const output = vi.spyOn(console, 'log').mockImplementation((value) => { logged.push(String(value)); });
    try {
      await handler.handle({
        id: 2n,
        eventId: '5eeb7f58-46fd-46d6-b0fd-8f68df39f05c',
        eventType: 'PasswordResetRequested',
        schemaVersion: 1,
        aggregateType: 'PasswordResetRequest',
        aggregateId: 'request-id',
        companyId: null,
        payload: {},
        occurredAt: new Date(),
        attemptCount: 1,
        maxAttempts: 8,
      }, new AbortController().signal);
    } finally {
      output.mockRestore();
    }

    const entry = logged
      .map((value) => JSON.parse(value) as Record<string, unknown>)
      .find(({ event }) => event === 'password_reset_email_provider_accepted');
    expect(entry).toMatchObject({ provider: 'resend', providerMessageId: messageId });
    expect(JSON.stringify(entry)).not.toMatch(/owner@example\.com|reset-password\?token/iu);
  });
});
