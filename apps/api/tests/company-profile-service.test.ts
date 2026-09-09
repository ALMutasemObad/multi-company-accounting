import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CompanyProfileService } from '../src/companies/company-profile-service.js';

const context = { userId: 7n, companyId: 19n };

describe('CompanyProfileService write boundaries', () => {
  it('scopes optimistic profile updates and audit records to the actor company', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      companyProfile: { findUnique: vi.fn().mockResolvedValue({ countryCode: 'YE' }), updateMany },
      companyRegistration: { count: vi.fn().mockResolvedValue(0) },
      companyTaxRegistration: { count: vi.fn().mockResolvedValue(0) },
      companyAddress: { count: vi.fn().mockResolvedValue(0) },
      auditLog: { create: auditCreate },
    };
    const prisma = {
      businessActivity: { findUnique: vi.fn().mockResolvedValue({ id: 4n, code: 'PROFESSIONAL_SERVICES', isActive: true }) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    } as unknown as PrismaClient;
    const service = new CompanyProfileService(prisma);
    vi.spyOn(service, 'getProfile').mockResolvedValue({} as never);

    await service.updateProfile(context, {
      version: 3, tradeName: '  Juwar  ', countryCode: 'ye',
      primaryBusinessActivityCode: 'professional_services', phone: ' +9671000000 ',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 19n, version: 3 },
      data: expect.objectContaining({
        tradeName: 'Juwar', countryCode: 'YE', primaryBusinessActivityId: 4n,
        phone: '+9671000000', version: { increment: 1 },
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      companyId: 19n, actorUserId: 7n, action: 'COMPANY_PROFILE_UPDATED', entityId: '19',
    }) });
  });

  it('persists only last-four registration suffixes, normalizes country codes, and excludes full numbers from audit', async () => {
    const registrationUpsert = vi.fn().mockResolvedValue({});
    const taxUpsert = vi.fn().mockResolvedValue({});
    const addressUpsert = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      companyProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      companyRegistration: { upsert: registrationUpsert },
      companyTaxRegistration: { upsert: taxUpsert },
      companyAddress: { upsert: addressUpsert },
      auditLog: { create: auditCreate },
    };
    const prisma = { $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)) } as unknown as PrismaClient;
    const service = new CompanyProfileService(prisma);
    vi.spyOn(service, 'getCompliance').mockResolvedValue({} as never);

    await service.updateCompliance(context, {
      version: 2,
      legalName: 'Juwar Legal',
      commercialRegistration: {
        documentType: 'COMMERCIAL_REGISTRATION', number: 'CR-1234567890', issuedAt: '2026-01-01', expiresAt: '2027-01-01',
      },
      taxRegistration: {
        registrationType: 'VAT', countryCode: 'ye', number: 'VAT-0987654321', issuedAt: '2026-02-01', expiresAt: '2027-02-01',
      },
      nationalAddress: { countryCode: 'ye', city: 'Sana’a' },
    });

    expect(registrationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId_documentType: { companyId: 19n, documentType: 'COMMERCIAL_REGISTRATION' } },
      create: expect.objectContaining({ companyId: 19n, numberLast4: '7890' }),
    }));
    expect(taxUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId_registrationType_countryCode: { companyId: 19n, registrationType: 'VAT', countryCode: 'YE' } },
      create: expect.objectContaining({ companyId: 19n, countryCode: 'YE', numberLast4: '4321' }),
    }));
    expect(addressUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId_type: { companyId: 19n, type: 'NATIONAL' } },
      create: expect.objectContaining({ companyId: 19n, countryCode: 'YE' }),
    }));
    const persistedArguments = JSON.stringify({
      registration: registrationUpsert.mock.calls,
      tax: taxUpsert.mock.calls,
      audit: auditCreate.mock.calls,
    }, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    expect(persistedArguments).not.toContain('CR-1234567890');
    expect(persistedArguments).not.toContain('VAT-0987654321');
  });
});
