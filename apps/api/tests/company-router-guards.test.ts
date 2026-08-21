import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { AuthService } from '../src/auth/auth-service.js';
import { CompanyCurrencyError, type CompanyService } from '../src/companies/company-service.js';

const context = { sessionId: 9n, userId: 1n, companyId: 1n };
const updatedAt = new Date('2026-08-21T06:00:00.000Z');
const company = {
  id: 1n,
  name: 'شركة الاختبار',
  baseCurrencyId: 1n,
  timezone: 'Asia/Riyadh',
  isActive: true,
  manualJournalMakerCheckerEnabled: true,
  updatedAt,
  baseCurrency: { code: 'SAR', nameAr: 'الريال السعودي' },
};
const rate = {
  id: 10n,
  rateDate: new Date('2026-08-21T00:00:00.000Z'),
  rate: { toFixed: () => '0.10000000' },
  source: 'البنك المركزي',
  updatedAt,
  companyCurrency: { currency: { id: 2n, code: 'USD', nameAr: 'الدولار الأمريكي' } },
  updatedBy: { id: 1n, displayName: 'مدير النظام' },
};
const customCurrency = {
  id: 11n,
  code: 'ABC',
  nameAr: 'عملة اختبار',
  decimals: 3,
  isBase: false,
  isCustom: true,
  isEnabled: true,
  latestExchangeRate: null,
  latestExchangeRateDate: null,
};

const config = {
  NODE_ENV: 'test' as const,
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  SESSION_COOKIE_SECURE: false,
  PRE_AUTH_TTL_MINUTES: 10,
  SESSION_TTL_HOURS: 12,
};

describe('company routes generated request guards', () => {
  const authorize = vi.fn(async () => context);
  const update = vi.fn(async (_context, input) => ({ ...company, ...input }));
  const updateMakerChecker = vi.fn(async (_context, enabled: boolean) => ({
    ...company,
    manualJournalMakerCheckerEnabled: enabled,
  }));
  const updateCompanyCurrencies = vi.fn(async () => []);
  const createCompanyCurrency = vi.fn(async () => customCurrency);
  const upsertExchangeRate = vi.fn(async () => rate);
  const auth = { authorize } as unknown as AuthService;
  const companies = {
    update,
    updateMakerChecker,
    updateCompanyCurrencies,
    createCompanyCurrency,
    upsertExchangeRate,
  } as unknown as CompanyService;
  const app = createApp(config, { auth, companies });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trims company fields before passing them to the service', async () => {
    const response = await request(app)
      .patch('/api/v1/companies/current')
      .send({ name: '  شركة الاختبار  ', timezone: '  Asia/Riyadh  ' })
      .expect(200);

    expect(update).toHaveBeenCalledWith(context, { name: 'شركة الاختبار', timezone: 'Asia/Riyadh' });
    expect(response.body).toMatchObject({ name: 'شركة الاختبار', timezone: 'Asia/Riyadh' });
  });

  it('requires exactly the one supported company setting', async () => {
    await request(app).put('/api/v1/settings').send({ settings: [] }).expect(400);
    expect(updateMakerChecker).not.toHaveBeenCalled();

    const response = await request(app)
      .put('/api/v1/settings')
      .send({ settings: [{ key: 'accounting.manual_journal_maker_checker_enabled', value: false }] })
      .expect(200);

    expect(updateMakerChecker).toHaveBeenCalledWith(context, false);
    expect(response.body.data[0]).toMatchObject({
      key: 'accounting.manual_journal_maker_checker_enabled',
      value: false,
    });
  });

  it('keeps duplicate currency identifiers compatible and converts them to bigint', async () => {
    await request(app)
      .put('/api/v1/company-currencies')
      .send({ currencyIds: ['2', '2'] })
      .expect(200, { data: [] });

    expect(updateCompanyCurrencies).toHaveBeenCalledWith(context, [2n, 2n]);
  });

  it('creates a normalized company-owned currency and requires its dedicated permission', async () => {
    const response = await request(app)
      .post('/api/v1/company-currencies')
      .send({ code: ' ABC ', nameAr: '  عملة اختبار  ', decimals: 3 })
      .expect(201);

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: 'currencies.create', requireCsrf: true }));
    expect(createCompanyCurrency).toHaveBeenCalledWith(context, { code: 'ABC', nameAr: 'عملة اختبار', decimals: 3 });
    expect(response.body).toMatchObject({ code: 'ABC', nameAr: 'عملة اختبار', decimals: 3, isCustom: true, isEnabled: true });

    await request(app).post('/api/v1/company-currencies').send({ code: 'abc', nameAr: 'عملة اختبار', decimals: 2 }).expect(400);
    expect(createCompanyCurrency).toHaveBeenCalledTimes(1);
  });

  it('maps a duplicate visible currency code to an explicit conflict', async () => {
    createCompanyCurrency.mockRejectedValueOnce(new CompanyCurrencyError('CURRENCY_CODE_EXISTS') as never);
    const response = await request(app)
      .post('/api/v1/company-currencies')
      .send({ code: 'USD', nameAr: 'دولار خاص', decimals: 2 })
      .expect(409);

    expect(response.body).toMatchObject({ code: 'CONFLICT', reason: 'CURRENCY_CODE_EXISTS' });
  });

  it('normalizes a positive exchange rate request and rejects a zero rate', async () => {
    const response = await request(app)
      .put('/api/v1/exchange-rates')
      .send({ currencyId: '2', rateDate: '2026-08-21', rate: '0.10000000', source: '  البنك المركزي  ' })
      .expect(200);

    expect(upsertExchangeRate).toHaveBeenCalledWith(context, {
      currencyId: 2n,
      rateDate: '2026-08-21',
      rate: '0.10000000',
      source: 'البنك المركزي',
    });
    expect(response.body).toMatchObject({ rate: '0.10000000', source: 'البنك المركزي' });

    await request(app)
      .put('/api/v1/exchange-rates')
      .send({ currencyId: '2', rateDate: '2026-08-21', rate: '0.00000000' })
      .expect(400);
    expect(upsertExchangeRate).toHaveBeenCalledTimes(1);
  });
});
