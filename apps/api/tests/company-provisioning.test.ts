import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createCompanyProvisioningService } from '../src/composition/create-company-provisioning-service.js';

describe('company provisioning input preparation', () => {
  it('removes the plaintext password before strict prepared-input validation', async () => {
    const transaction = vi.fn().mockResolvedValue({ status: 'accepted' });
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    const service = createCompanyProvisioningService(prisma);

    await expect(service.provision({
      organizationCode: 'E2E_ORG',
      organizationName: 'E2E Organization',
      companyCode: 'E2E_COMPANY',
      companyName: 'E2E Company',
      timezone: 'Asia/Aden',
      baseCurrencyCode: 'YER',
      adminEmail: 'owner@example.com',
      adminDisplayName: 'Owner',
      adminPassword: 'Unit-Test-Password-2026!',
    })).resolves.toEqual({ status: 'accepted' });

    expect(transaction).toHaveBeenCalledOnce();
  });
});
