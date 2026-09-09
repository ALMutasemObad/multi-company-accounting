import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { TenantCompanyProvisioningAdapter } from '../src/companies/company-provisioning-adapter.js';

const input = {
  organizationCode: 'EXISTING_ORG', organizationName: 'Existing organization',
  companyCode: 'MAIN', companyName: 'Existing company', timezone: 'Asia/Aden', baseCurrencyCode: 'YER',
  adminEmail: 'owner@example.test', adminDisplayName: 'Owner',
  businessProfile: {
    phone: '+9671000000', countryCode: 'YE', primaryBusinessActivityCode: 'PROFESSIONAL_SERVICES',
    preferredLocale: 'ar', initialChartTemplateCode: 'MANUFACTURING',
  },
};

function fixture(profileOverrides: Record<string, unknown> = {}) {
  const company = {
    id: 4n, organizationId: 3n, baseCurrencyId: 2n, code: 'MAIN', name: 'Existing company',
    timezone: 'Asia/Aden', isActive: true, createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date(),
  };
  const profile = {
    tradeName: 'Existing company', phone: '+9671000000', countryCode: 'YE', preferredLocale: 'ar',
    initialChartTemplateCode: 'MANUFACTURING', primaryBusinessActivity: { code: 'PROFESSIONAL_SERVICES' },
    version: 12, complianceVersion: 12, ...profileOverrides,
  };
  const tx = {
    currency: { findUnique: vi.fn().mockResolvedValue({ id: 2n, code: 'YER', isActive: true }) },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ id: 3n, code: 'EXISTING_ORG', name: 'Existing organization' }),
      create: vi.fn(),
    },
    company: { findUnique: vi.fn().mockResolvedValue(company), create: vi.fn(), update: vi.fn() },
    companyProfile: { findUnique: vi.fn().mockResolvedValue(profile), upsert: vi.fn(), update: vi.fn() },
    businessActivity: { findUnique: vi.fn() },
    companyRegistration: { count: vi.fn().mockResolvedValue(1) },
    companyCurrency: { upsert: vi.fn().mockResolvedValue({}) },
  };
  return { tx, company };
}

describe('company business profile provisioning replay', () => {
  it('rejects a different chart template before changing an existing profile', async () => {
    const { tx } = fixture({ initialChartTemplateCode: 'PROFESSIONAL_SERVICES' });

    await expect(new TenantCompanyProvisioningAdapter().provisionTenant(tx as unknown as Prisma.TransactionClient, input))
      .rejects.toMatchObject({ reason: 'INVALID_BUSINESS_PROFILE' });
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(tx.companyProfile.upsert).not.toHaveBeenCalled();
    expect(tx.companyCurrency.upsert).not.toHaveBeenCalled();
  });

  it('rejects a country mismatch with existing compliance before any tenant mutation', async () => {
    const { tx } = fixture({ countryCode: 'SA' });

    await expect(new TenantCompanyProvisioningAdapter().provisionTenant(tx as unknown as Prisma.TransactionClient, input))
      .rejects.toMatchObject({ reason: 'INVALID_BUSINESS_PROFILE' });
    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(tx.company.create).not.toHaveBeenCalled();
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(tx.companyProfile.upsert).not.toHaveBeenCalled();
    expect(tx.companyProfile.update).not.toHaveBeenCalled();
    expect(tx.companyCurrency.upsert).not.toHaveBeenCalled();
  });

  it('confirms an exact replay without rewriting the versioned company profile', async () => {
    const { tx, company } = fixture();

    await expect(new TenantCompanyProvisioningAdapter().provisionTenant(tx as unknown as Prisma.TransactionClient, input))
      .resolves.toMatchObject({ company: {
        id: company.id, code: company.code, name: company.name, timezone: company.timezone, createdAt: company.createdAt,
      }, created: false });
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(tx.companyProfile.upsert).not.toHaveBeenCalled();
    expect(tx.companyProfile.update).not.toHaveBeenCalled();
    expect(tx.businessActivity.findUnique).not.toHaveBeenCalled();
    expect(tx.companyCurrency.upsert).toHaveBeenCalledOnce();
  });
});
