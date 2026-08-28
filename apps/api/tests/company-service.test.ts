import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CompanyService } from '../src/companies/company-service.js';

const context = { userId: 7n, companyId: 11n };

function setup(used: boolean) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const upsert = vi.fn(async () => ({}));
  const audit = vi.fn(async () => ({}));
  const findUsage = vi.fn(async () => used);
  const tx = {
    companyCurrency: {
      findMany: vi.fn(async () => [{ currencyId: 2n }]),
      updateMany,
      upsert,
    },
    auditLog: { create: audit },
  };
  const prisma = {
    company: { findUniqueOrThrow: vi.fn(async () => ({ baseCurrencyId: 1n })) },
    currency: { findMany: vi.fn(async () => [{ id: 1n, code: 'SAR' }]) },
    $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  } as unknown as PrismaClient;
  const service = new CompanyService(prisma, [{ isAnyCurrencyUsed: findUsage }]);
  vi.spyOn(service, 'listCurrencyCatalog').mockResolvedValue([]);
  return { service, tx, updateMany, upsert, audit };
}

describe('CompanyService currency deactivation safety', () => {
  it('refuses to disable a currency referenced by a company document', async () => {
    const { service, updateMany, audit } = setup(true);

    await expect(service.updateCompanyCurrencies(context, [])).rejects.toMatchObject({ reason: 'CURRENCY_IN_USE' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('keeps the base currency enabled while disabling an unused currency', async () => {
    const { service, updateMany, upsert, audit } = setup(false);

    await expect(service.updateCompanyCurrencies(context, [])).resolves.toEqual([]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { companyId: 11n, currencyId: { notIn: [1n] }, isActive: true },
      data: { isActive: false },
    });
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId_currencyId: { companyId: 11n, currencyId: 1n } },
    }));
    expect(audit).toHaveBeenCalledOnce();
  });
});
