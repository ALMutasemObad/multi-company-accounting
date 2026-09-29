import type { Prisma, PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { GroupCompanyOnboardingService } from '../src/organizations/group-company-onboarding-service.js';
import { SubscriptionStartPolicyError } from '../src/platform-subscriptions/new-company-start-policy.js';

type Ports = ConstructorParameters<typeof GroupCompanyOnboardingService>[1];

function fixture(eligibleCurrencies = ['SAR'], availableCurrencies = [
  { code: 'AED', nameAr: 'درهم إماراتي' },
  { code: 'SAR', nameAr: 'ريال سعودي' },
]) {
  const tx = {} as Prisma.TransactionClient;
  const prisma = { $transaction: vi.fn(async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx)) } as unknown as PrismaClient;
  const authorizeOwner = vi.fn().mockResolvedValue(undefined);
  const eligibleStartCurrencies = vi.fn().mockResolvedValue(eligibleCurrencies);
  const currencies = vi.fn().mockResolvedValue(availableCurrencies);
  const businessActivities = vi.fn().mockResolvedValue([{ code: 'RETAIL_TRADE', nameAr: 'تجارة', nameEn: 'Retail' }]);
  const ports = {
    identity: { authorizeOwner },
    subscriptions: { eligibleStartCurrencies },
    tenant: { currencies, businessActivities, countries: () => [{ code: 'SA', nameAr: 'السعودية', nameEn: 'Saudi Arabia' }] },
    accountingOptions: { listChartTemplates: () => [{ code: 'RETAIL_INVENTORY', nameAr: 'تجارة' }] },
  } as unknown as Ports;
  return { service: new GroupCompanyOnboardingService(prisma, ports), tx, authorizeOwner,
    eligibleStartCurrencies, currencies, businessActivities };
}

describe('group company onboarding options', () => {
  it('shows only the active start-plan currency, not an alphabetically earlier unusable currency', async () => {
    const test = fixture();
    const options = await test.service.options(11n, 22n);
    expect(options.currencies).toEqual([{ code: 'SAR', nameAr: 'ريال سعودي' }]);
    expect(test.authorizeOwner).toHaveBeenCalledExactlyOnceWith(test.tx, 11n, 22n);
    expect(test.eligibleStartCurrencies).toHaveBeenCalledOnce();
    expect(test.eligibleStartCurrencies.mock.calls[0]?.[0]).toBe(test.tx);
    expect(test.eligibleStartCurrencies.mock.calls[0]?.[1]).toBeInstanceOf(Date);
  });

  it('offers both SAR and AED when both configured versions pass the preflight', async () => {
    const options = await fixture(['SAR', 'AED']).service.options(11n, 22n);
    expect(options.currencies.map(currency => currency.code)).toEqual(['AED', 'SAR']);
  });

  it('fails closed if the eligible currency is not active in the global catalog', async () => {
    const test = fixture(['SAR'], [{ code: 'AED', nameAr: 'درهم إماراتي' }]);
    await expect(test.service.options(11n, 22n))
      .rejects.toThrowError(new SubscriptionStartPolicyError('PLAN_NOT_ELIGIBLE'));
  });

  it('does not reveal options or inspect the start plan to a non-owner', async () => {
    const test = fixture();
    const denied = new Error('ORGANIZATION_ROLE_FORBIDDEN');
    test.authorizeOwner.mockRejectedValueOnce(denied);
    await expect(test.service.options(11n, 22n)).rejects.toBe(denied);
    expect(test.eligibleStartCurrencies).not.toHaveBeenCalled();
    expect(test.currencies).not.toHaveBeenCalled();
    expect(test.businessActivities).not.toHaveBeenCalled();
  });
});
