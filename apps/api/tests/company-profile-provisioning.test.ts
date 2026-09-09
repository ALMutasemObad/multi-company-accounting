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

describe('company business profile provisioning replay', () => {
  it('rejects a different chart template before changing an existing profile', async () => {
    const profileUpsert = vi.fn();
    const tx = {
      currency: { findUnique: vi.fn().mockResolvedValue({ id: 2n, code: 'YER', isActive: true }) },
      organization: { upsert: vi.fn().mockResolvedValue({ id: 3n, code: 'EXISTING_ORG', name: 'Existing organization' }) },
      company: {
        findUnique: vi.fn().mockResolvedValue({ id: 4n, organizationId: 3n, baseCurrencyId: 2n }),
        update: vi.fn().mockResolvedValue({ id: 4n, code: 'MAIN', name: 'Existing company', timezone: 'Asia/Aden', createdAt: new Date() }),
      },
      companyProfile: {
        findUnique: vi.fn().mockResolvedValue({ initialChartTemplateCode: 'PROFESSIONAL_SERVICES' }),
        upsert: profileUpsert,
      },
      businessActivity: { findUnique: vi.fn() },
      companyCurrency: { upsert: vi.fn() },
    };

    await expect(new TenantCompanyProvisioningAdapter().provisionTenant(tx as unknown as Prisma.TransactionClient, input))
      .rejects.toMatchObject({ reason: 'INVALID_BUSINESS_PROFILE' });
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(profileUpsert).not.toHaveBeenCalled();
    expect(tx.companyCurrency.upsert).not.toHaveBeenCalled();
  });
});
