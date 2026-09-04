import type { Prisma, PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createCompanyProvisioningService } from '../src/composition/create-company-provisioning-service.js';
import { CompanyProvisioningService } from '../src/platform/company-provisioning-service.js';
import { SubscriptionStartPolicyError } from '../src/platform-subscriptions/new-company-start-policy.js';

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

describe('company subscription provisioning boundary', () => {
  const input = {
    organizationCode: 'TEST_ORG', organizationName: 'Test organization', companyCode: 'MAIN', companyName: 'Test company',
    timezone: 'Asia/Riyadh', baseCurrencyCode: 'SAR', adminEmail: 'owner@example.com', adminDisplayName: 'Owner',
  };
  const createdAt = new Date('2026-08-31T12:00:00Z');
  function fixture(created: boolean) {
    const subscriptions = { provisionNewCompanyAccess: vi.fn().mockResolvedValue(undefined) };
    const audit = { append: vi.fn().mockResolvedValue(undefined) };
    const tx = {} as Prisma.TransactionClient;
    const service = new CompanyProvisioningService({} as PrismaClient, {
      provisionTenant: vi.fn().mockResolvedValue({
        created, organization: { id: 1n, code: 'TEST_ORG', name: 'Test organization' },
        company: { id: 2n, code: 'MAIN', name: 'Test company', timezone: 'Asia/Riyadh', createdAt },
        baseCurrency: { id: 3n, code: 'SAR' },
      }),
    }, { provisionAdministrator: vi.fn().mockResolvedValue({
      administrator: { id: 4n, email: 'owner@example.com' }, organizationRole: 'OWNER', reusedIdentity: false, permissionsGranted: 5,
    }) }, { provisionAccounting: vi.fn().mockResolvedValue(null) }, {
      provisionTreasury: vi.fn().mockResolvedValue(undefined),
    }, subscriptions, audit);
    return { service, tx, subscriptions, audit };
  }

  it('passes only the new company identity, trusted currency and time in the same transaction', async () => {
    const { service, tx, subscriptions, audit } = fixture(true);
    await service.provisionPreparedInTransaction(tx, input, 'prepared-password-hash');
    expect(subscriptions.provisionNewCompanyAccess).toHaveBeenCalledExactlyOnceWith(tx, {
      companyId: 2n, baseCurrencyCode: 'SAR', effectiveFrom: createdAt,
    });
    expect(audit.append).toHaveBeenLastCalledWith(tx, expect.objectContaining({
      organizationId: 1n, action: 'ORGANIZATION_MEMBERSHIP_PROVISIONED',
    }));
  });

  it('does not consult the start policy for an existing tenant, even if it would fail', async () => {
    const { service, tx, subscriptions } = fixture(false);
    subscriptions.provisionNewCompanyAccess.mockRejectedValue(new SubscriptionStartPolicyError('NOT_CONFIGURED'));
    await expect(service.provisionPreparedInTransaction(tx, input, 'prepared-password-hash')).resolves.toMatchObject({ company: { id: '2' } });
    expect(subscriptions.provisionNewCompanyAccess).not.toHaveBeenCalled();
  });

  it('propagates policy failure to the transaction owner without a success audit', async () => {
    const { service, tx, subscriptions, audit } = fixture(true);
    subscriptions.provisionNewCompanyAccess.mockRejectedValue(new SubscriptionStartPolicyError('NOT_CONFIGURED'));
    await expect(service.provisionPreparedInTransaction(tx, input, 'prepared-password-hash')).rejects.toBeInstanceOf(SubscriptionStartPolicyError);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('rejects a supplied plan identifier at the strict provisioning input boundary', async () => {
    const { service, tx, subscriptions } = fixture(true);
    const untrustedInput = { ...input, planId: '999' };
    await expect(service.provisionPreparedInTransaction(tx, untrustedInput, 'prepared-password-hash')).rejects.toThrow();
    expect(subscriptions.provisionNewCompanyAccess).not.toHaveBeenCalled();
  });
});
