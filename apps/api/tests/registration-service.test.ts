import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { OutboxAppender } from '../src/outbox/outbox.js';
import type { CompanyProvisioningPort } from '../src/platform/company-provisioning-ports.js';
import { RegistrationService } from '../src/registration/registration-service.js';
import type { RegistrationOwnerPorts } from '../src/registration/registration-owner-ports.js';
import { SubscriptionStartPolicyError } from '../src/platform-subscriptions/new-company-start-policy.js';
import { socialOnboardingCompleteRequestRequestComponentSchema, startSelfRegistrationRequestSchema } from '../src/generated/openapi-request-guards.js';

const input = {
  email: ' owner@example.com ',
  password: 'a sufficiently long password',
  displayName: 'Owner',
  organizationName: 'Owner Group',
  companyName: 'Owner Company',
  phone: '+9671000000',
  countryCode: 'YE',
  primaryBusinessActivityCode: 'PROFESSIONAL_SERVICES',
  timezone: 'Asia/Aden',
  baseCurrencyCode: 'YER',
  locale: 'ar' as const,
  chartTemplateCode: 'PROFESSIONAL_SERVICES',
};

function fixture(existingUser = false, onboardingTemplateAllowed = true) {
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
      listCompanyCountries: vi.fn().mockResolvedValue([]),
      listBusinessActivities: vi.fn().mockResolvedValue([]),
      isActiveGlobalCurrency: vi.fn().mockResolvedValue(true),
      isSupportedCompanyCountry: vi.fn().mockResolvedValue(true),
      isActiveBusinessActivity: vi.fn().mockResolvedValue(true),
    },
    identity: { identityExists: vi.fn().mockResolvedValue(existingUser) },
    accounting: {
      listChartTemplates: vi.fn().mockReturnValue([]),
      isAllowedOnboardingChartTemplate: vi.fn().mockReturnValue(onboardingTemplateAllowed),
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

  it('canonicalizes a safe BCP47 locale without requiring a server allow-list entry', async () => {
    const { service, upsert } = fixture();
    await service.start({ ...input, locale: 'de-de' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ locale: 'de-DE' }),
      update: expect.objectContaining({ locale: 'de-DE' }),
    }));
  });

  it('rejects malformed or oversized locale values before persistence', async () => {
    const { service, upsert } = fixture();
    await expect(service.start({ ...input, locale: 'de_DE' })).rejects.toMatchObject({ reason: 'INVALID_OPTION' });
    await expect(service.start({ ...input, locale: `en-${'x'.repeat(36)}` })).rejects.toMatchObject({ reason: 'INVALID_OPTION' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a supported legacy chart that is not allowed for new onboarding', async () => {
    const { service, upsert } = fixture(false, false);
    await expect(service.start({ ...input, chartTemplateCode: 'SMALL_BUSINESS_GENERAL' }))
      .rejects.toMatchObject({ reason: 'INVALID_OPTION' });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('registration locale contract', () => {
  it('accepts safe BCP47 input for email and social registration while rejecting malformed tags', () => {
    const registration = { ...input, locale: 'zh-Hant-TW' };
    const { email: _email, password: _password, ...socialRegistration } = registration;
    const social = { ...socialRegistration, consent: true };
    expect(startSelfRegistrationRequestSchema.safeParse(registration).success).toBe(true);
    expect(socialOnboardingCompleteRequestRequestComponentSchema.safeParse(social).success).toBe(true);
    expect(startSelfRegistrationRequestSchema.safeParse({ ...registration, locale: 'zh_Hant_TW' }).success).toBe(false);
    expect(socialOnboardingCompleteRequestRequestComponentSchema.safeParse({ ...social, locale: 'x'.repeat(36) }).success).toBe(false);
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
        phone: '+966500000000', countryCode: 'SA', primaryBusinessActivityCode: 'PROFESSIONAL_SERVICES',
        chartTemplateCode: 'PROFESSIONAL_SERVICES', locale: 'ar',
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
      const service = new RegistrationService(prisma, provisioning, {} as OutboxAppender, {
        tenant: {
          listGlobalCurrencies: vi.fn(), listCompanyCountries: vi.fn(), listBusinessActivities: vi.fn(),
          isActiveGlobalCurrency: vi.fn(), isSupportedCompanyCountry: vi.fn().mockReturnValue(true),
          isActiveBusinessActivity: vi.fn().mockResolvedValue(true),
        },
        identity: { identityExists: vi.fn() },
        accounting: { listChartTemplates: vi.fn(), isAllowedOnboardingChartTemplate: vi.fn().mockReturnValue(true) },
        security: { recordCompletion: vi.fn() },
      }, {
        now: () => new Date('2026-08-31T12:00:00Z'), auditPepper: 'test-registration-pepper',
      });
      await expect(service.verify('synthetic-token')).rejects.toMatchObject({ reason: 'PROVISIONING_FAILED', message: 'PROVISIONING_FAILED' });
      expect(provisioning.provisionPreparedInTransaction).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledExactlyOnceWith({ where: { id: 9n }, data: {
        status: 'EMAIL_VERIFIED', lastErrorCode: 'PROVISIONING_FAILED',
      } });
    });
});

describe('registration verification business-profile migration boundary', () => {
  it.each([
    ['missing profile field', { phone: null }],
    ['legacy onboarding template', { chartTemplateCode: 'SMALL_BUSINESS_GENERAL' }],
  ])('rejects a pending migration-era request with %s before provisioning', async (_case, overrides) => {
    const request = {
      id: 19n,
      publicId: '11111111-1111-4111-8111-111111111119',
      status: 'PENDING_EMAIL',
      emailNormalized: 'legacy-pending@example.test',
      passwordHash: '$argon2id$prepared-hash',
      verificationExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      provisioningStartedAt: null,
      verifiedAt: null,
      phone: '+9671000000',
      countryCode: 'YE',
      primaryBusinessActivityCode: 'PROFESSIONAL_SERVICES',
      chartTemplateCode: 'PROFESSIONAL_SERVICES',
      ...overrides,
    };
    const updateMany = vi.fn();
    const tx = {
      registrationRequest: { findUnique: vi.fn().mockResolvedValue(request), updateMany },
      registrationEvent: { create: vi.fn().mockResolvedValue(undefined) },
    };
    const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) } as unknown as PrismaClient;
    const provisioning = { provisionPreparedInTransaction: vi.fn() };
    const owners: RegistrationOwnerPorts = {
      tenant: {
        listGlobalCurrencies: vi.fn(), listCompanyCountries: vi.fn(), listBusinessActivities: vi.fn(),
        isActiveGlobalCurrency: vi.fn(), isSupportedCompanyCountry: vi.fn().mockReturnValue(true),
        isActiveBusinessActivity: vi.fn().mockResolvedValue(true),
      },
      identity: { identityExists: vi.fn() },
      accounting: {
        listChartTemplates: vi.fn(),
        isAllowedOnboardingChartTemplate: vi.fn((code: string) => code !== 'SMALL_BUSINESS_GENERAL'),
      },
      security: { recordCompletion: vi.fn() },
    };
    const service = new RegistrationService(prisma, provisioning, {} as OutboxAppender, owners, {
      now: () => new Date('2026-09-09T12:00:00.000Z'), auditPepper: 'test-registration-pepper',
    });

    await expect(service.verify('synthetic-token')).rejects.toMatchObject({ reason: 'INVALID_OR_EXPIRED_TOKEN' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(provisioning.provisionPreparedInTransaction).not.toHaveBeenCalled();
    expect(tx.registrationEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      eventType: 'REGISTRATION_TOKEN_REJECTED',
      details: { reason: 'BUSINESS_PROFILE_RESTART_REQUIRED' },
    }) });
  });
});
