import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { OutboxAppender } from '../src/outbox/outbox.js';
import type { CompanyProvisioningPort } from '../src/platform/company-provisioning-ports.js';
import { RegistrationService } from '../src/registration/registration-service.js';
import type { RegistrationOwnerPorts } from '../src/registration/registration-owner-ports.js';
import { SubscriptionStartPolicyError } from '../src/platform-subscriptions/new-company-start-policy.js';

const input = {
  email: ' owner@example.com ',
  password: 'a sufficiently long password',
  displayName: 'Owner',
  organizationName: 'Owner Group',
  companyName: 'Owner Company',
  timezone: 'Asia/Aden',
  baseCurrencyCode: 'YER',
  locale: 'ar' as const,
  chartTemplateCode: 'SMALL_BUSINESS_GENERAL',
};

function fixture(existingUser = false) {
  const events: unknown[] = [];
  const upsert = vi.fn().mockResolvedValue({ id: 9n, publicId: 'registration-public-id', deliveryGeneration: 4 });
  const tx = {
    registrationRequest: { upsert },
    registrationEvent: { create: vi.fn((event) => { events.push(event); return Promise.resolve(event); }) },
  };
  const prisma = {
    registrationRequest: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
  const outbox: OutboxAppender = { append: vi.fn().mockResolvedValue({ eventId: 'event-id' }) };
  const owners: RegistrationOwnerPorts = {
    tenant: {
      listGlobalCurrencies: vi.fn().mockResolvedValue([]),
      isActiveGlobalCurrency: vi.fn().mockResolvedValue(true),
    },
    identity: { identityExists: vi.fn().mockResolvedValue(existingUser) },
    accounting: {
      listChartTemplates: vi.fn().mockReturnValue([]),
      isSupportedChartTemplate: vi.fn().mockReturnValue(true),
    },
    security: { recordCompletion: vi.fn().mockResolvedValue(undefined) },
  };
  const passwordHasher = vi.fn().mockResolvedValue('$argon2id$prepared-hash');
  const service = new RegistrationService(prisma, {} as CompanyProvisioningPort, outbox, owners, {
    auditPepper: 'unit-test-registration-audit-pepper-12345',
    passwordHasher,
    now: () => new Date('2026-08-22T01:00:00.000Z'),
  });
  return { service, events, upsert, passwordHasher, outbox };
}

describe('RegistrationService anonymous boundary', () => {
  it('atomically appends a secret-free verification event beside prepared registration state', async () => {
    const { service, upsert, outbox } = fixture();
    await expect(service.start(input)).resolves.toEqual({ status: 'PENDING_VERIFICATION' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        emailNormalized: 'owner@example.com',
        passwordHash: '$argon2id$prepared-hash',
        deliveryAttempts: 0,
      }),
    }));
    expect(outbox.append).toHaveBeenCalledWith(expect.anything(), {
      eventType: 'RegistrationVerificationRequested',
      schemaVersion: 1,
      aggregateType: 'RegistrationRequest',
      aggregateId: 'registration-public-id',
      payload: { deliveryGeneration: 4 },
      occurredAt: new Date('2026-08-22T01:00:00.000Z'),
    });
    const envelope = vi.mocked(outbox.append).mock.calls[0]?.[1];
    expect(JSON.stringify(envelope)).not.toContain('owner@example.com');
    expect(JSON.stringify(envelope)).not.toContain('token');
  });

  it('does equal password work but returns the same response without an outbox event for an existing identity', async () => {
    const { service, upsert, passwordHasher, outbox, events } = fixture(true);
    await expect(service.start(input)).resolves.toEqual({ status: 'PENDING_VERIFICATION' });
    expect(passwordHasher).toHaveBeenCalledWith(input.password);
    expect(upsert).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ data: expect.objectContaining({ eventType: 'REGISTRATION_EXISTING_IDENTITY_ATTEMPT', severity: 'WARNING' }) })]);
  });
});

describe('registration start-policy failures', () => {
  it.each(['NOT_CONFIGURED', 'INVALID_CONFIGURATION', 'PLAN_NOT_ELIGIBLE'] as const)
    ('maps %s to the existing generic retryable provisioning failure', async (reason) => {
      const request = {
        id: 9n, publicId: '11111111-1111-4111-8111-111111111111', status: 'PENDING_EMAIL',
        emailNormalized: 'owner@example.com', passwordHash: 'prepared-hash',
        verificationExpiresAt: new Date('2030-01-01T00:00:00Z'), provisioningStartedAt: null,
        verifiedAt: null, companyName: 'Test company', organizationName: 'Test organization',
        timezone: 'Asia/Riyadh', baseCurrencyCode: 'SAR', displayName: 'Owner',
      };
      const update = vi.fn().mockResolvedValue(undefined);
      const tx = {
        registrationRequest: {
          findUnique: vi.fn().mockResolvedValueOnce(request).mockResolvedValue({ ...request, status: 'PROVISIONING' }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ ...request, status: 'PROVISIONING' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }), update,
        },
        registrationEvent: { create: vi.fn().mockResolvedValue(undefined) },
      };
      const prisma = { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) } as unknown as PrismaClient;
      const provisioning = { provisionPreparedInTransaction: vi.fn().mockRejectedValue(new SubscriptionStartPolicyError(reason)) };
      const service = new RegistrationService(prisma, provisioning, {} as OutboxAppender, {} as RegistrationOwnerPorts, {
        now: () => new Date('2026-08-31T12:00:00Z'), auditPepper: 'test-registration-pepper',
      });
      await expect(service.verify('synthetic-token')).rejects.toMatchObject({ reason: 'PROVISIONING_FAILED', message: 'PROVISIONING_FAILED' });
      expect(provisioning.provisionPreparedInTransaction).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledExactlyOnceWith({ where: { id: 9n }, data: {
        status: 'EMAIL_VERIFIED', lastErrorCode: 'PROVISIONING_FAILED',
      } });
    });
});
