import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CompanyProfileService } from '../src/companies/company-profile-service.js';

const context = { userId: 7n, companyId: 19n };

describe('CompanyProfileService write boundaries', () => {
  it('scopes optimistic profile updates and audit records to the actor company', async () => {
    const update = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ countryCode: 'YE', version: 3, complianceVersion: 3 }]),
      companyProfile: { update },
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
      version: 3, tradeName: '  Northstar  ', countryCode: 'ye',
      primaryBusinessActivityCode: 'professional_services', phone: ' +9671000000 ',
    });

    expect(update).toHaveBeenCalledWith({
      where: { companyId: 19n },
      data: expect.objectContaining({
        tradeName: 'Northstar', countryCode: 'YE', primaryBusinessActivityId: 4n,
        phone: '+9671000000', version: { increment: 1 }, complianceVersion: { increment: 1 },
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      companyId: 19n, actorUserId: 7n, action: 'COMPANY_PROFILE_UPDATED', entityId: '19',
    }) });
  });

  it('persists only last-four registration suffixes, normalizes country codes, and excludes full numbers from audit', async () => {
    const registrationCreate = vi.fn().mockResolvedValue({});
    const taxCreate = vi.fn().mockResolvedValue({});
    const addressCreate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ countryCode: 'YE', version: 2, complianceVersion: 2 }]),
      companyProfile: { update: vi.fn().mockResolvedValue({}) },
      companyRegistration: { findUnique: vi.fn().mockResolvedValue(null), create: registrationCreate },
      companyTaxRegistration: { findUnique: vi.fn().mockResolvedValue(null), create: taxCreate },
      companyAddress: { findUnique: vi.fn().mockResolvedValue(null), create: addressCreate },
      auditLog: { create: auditCreate },
    };
    const prisma = { $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)) } as unknown as PrismaClient;
    const service = new CompanyProfileService(prisma);
    vi.spyOn(service, 'getCompliance').mockResolvedValue({} as never);

    await service.updateCompliance(context, {
      version: 2,
      legalName: 'Northstar Legal',
      commercialRegistration: {
        documentType: 'COMMERCIAL_REGISTRATION', number: 'CR-1234567890', issuedAt: '2026-01-01', expiresAt: '2027-01-01',
      },
      taxRegistration: {
        registrationType: 'VAT', countryCode: 'ye', number: 'VAT-0987654321', issuedAt: '2026-02-01', expiresAt: '2027-02-01',
      },
      nationalAddress: { countryCode: 'ye', city: 'Sana’a' },
    });

    expect(registrationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ companyId: 19n, numberLast4: '7890' }) });
    expect(taxCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ companyId: 19n, countryCode: 'YE', numberLast4: '4321' }) });
    expect(addressCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ companyId: 19n, countryCode: 'YE' }) });
    const persistedArguments = JSON.stringify({
      registration: registrationCreate.mock.calls,
      tax: taxCreate.mock.calls,
      audit: auditCreate.mock.calls,
    }, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    expect(persistedArguments).not.toContain('CR-1234567890');
    expect(persistedArguments).not.toContain('VAT-0987654321');
  });

  it('applies true nested patches and preserves verification unless evidence changes', async () => {
    const verifiedAt = new Date('2026-03-01T12:00:00.000Z');
    const existing = {
      numberLast4: '7890', issuingAuthority: 'Registry', issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2027-01-01T00:00:00.000Z'), status: 'VERIFIED', verifiedAt,
    };
    const registrationUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ countryCode: 'YE', version: 4, complianceVersion: 4 }]),
      companyProfile: { update: vi.fn().mockResolvedValue({}) },
      companyRegistration: { findUnique: vi.fn().mockResolvedValue(existing), update: registrationUpdate },
      companyTaxRegistration: { findUnique: vi.fn(), update: vi.fn() },
      companyAddress: { findUnique: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)) } as unknown as PrismaClient;
    const service = new CompanyProfileService(prisma);
    vi.spyOn(service, 'getCompliance').mockResolvedValue({} as never);

    await service.updateCompliance(context, {
      version: 4,
      commercialRegistration: { documentType: 'COMMERCIAL_REGISTRATION', expiresAt: '2027-01-01' },
    });
    expect(registrationUpdate).toHaveBeenLastCalledWith({
      where: { companyId_documentType: { companyId: 19n, documentType: 'COMMERCIAL_REGISTRATION' } },
      data: { expiresAt: new Date('2027-01-01T00:00:00.000Z') },
    });

    await service.updateCompliance(context, {
      version: 4,
      commercialRegistration: { documentType: 'COMMERCIAL_REGISTRATION', number: 'CR-1234567890' },
    });
    expect(registrationUpdate).toHaveBeenLastCalledWith({
      where: { companyId_documentType: { companyId: 19n, documentType: 'COMMERCIAL_REGISTRATION' } },
      data: { numberLast4: '7890', status: 'DECLARED', verifiedAt: null },
    });

    await service.updateCompliance(context, {
      version: 4,
      commercialRegistration: { documentType: 'COMMERCIAL_REGISTRATION', number: 'CR-00001234' },
    });
    expect(registrationUpdate).toHaveBeenLastCalledWith({
      where: { companyId_documentType: { companyId: 19n, documentType: 'COMMERCIAL_REGISTRATION' } },
      data: { numberLast4: '1234', status: 'DECLARED', verifiedAt: null },
    });
  });

  it('does not touch compliance records when only the legal name changes', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ countryCode: 'YE', version: 5, complianceVersion: 5 }]),
      companyProfile: { update: vi.fn().mockResolvedValue({}) },
      companyRegistration: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      companyTaxRegistration: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      companyAddress: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)) } as unknown as PrismaClient;
    const service = new CompanyProfileService(prisma);
    vi.spyOn(service, 'getCompliance').mockResolvedValue({} as never);
    await service.updateCompliance(context, { version: 5, legalName: 'Updated legal name' });
    expect(tx.companyRegistration.findUnique).not.toHaveBeenCalled();
    expect(tx.companyTaxRegistration.findUnique).not.toHaveBeenCalled();
    expect(tx.companyAddress.findUnique).not.toHaveBeenCalled();
  });
});
