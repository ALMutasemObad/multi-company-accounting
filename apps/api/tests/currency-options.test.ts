import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthError, type AuthService } from '../src/auth/auth-service.js';
import { CompanyService, enabledCurrencyOptionsQuerySchema } from '../src/companies/company-service.js';
import { parseOpenApiResponseBody } from '../src/generated/openapi-request-guards.js';
import { RequestDeadlineExceededError } from '../src/operations/request-context.js';

const context = { userId: 7n, companyId: 11n };
const currency = { id: 9007199254740993n, code: 'SAR', nameAr: 'ريال سعودي', decimals: 2 };
const config = { NODE_ENV: 'test' as const, PORT: 3141, WEB_ORIGIN: 'http://localhost:4191',
  SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12 };

function harness() {
  const findMany = vi.fn().mockResolvedValue([{ currency }]);
  const count = vi.fn().mockResolvedValue(37);
  const tx = { companyCurrency: { findMany, count } };
  const transaction = vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  const companies = new CompanyService(prisma, [{ isAnyCurrencyUsed: vi.fn().mockResolvedValue(false) }]);
  const authorize = vi.fn().mockResolvedValue(context);
  const app = createApp(config, { auth: { authorize } as unknown as AuthService, companies });
  return { app, authorize, companies, transaction, findMany, count };
}

describe('Companies bounded enabled currency options', () => {
  it('applies defaults and validates the actual HTTP response with generated schemas', async () => {
    const { app, authorize, findMany } = harness();
    const response = await request(app).get('/api/v1/currencies/options').expect(200);
    expect(response.body).toEqual({ data: [{ ...currency, id: '9007199254740993' }],
      meta: { page: 1, pageSize: 20, total: 37, totalPages: 2 } });
    expect(parseOpenApiResponseBody('listEnabledCurrencyOptions', 200, response.body)).toEqual(response.body);
    expect(authorize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ permission: 'currencies.view', requireCsrf: false }));
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(findMany.mock.invocationCallOrder[0]!);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
  });

  it('counts with the exact scoped filter, paginates in DB, and selects no rates or company data', async () => {
    const { companies, transaction, findMany, count } = harness();
    await companies.listEnabledCurrencyOptions(context, { page: 3, pageSize: 10, search: '  ريال  ' });
    const where = { companyId: 11n, isActive: true, currency: { isActive: true,
      OR: [{ scope: 'GLOBAL', ownerCompanyId: null }, { scope: 'COMPANY', ownerCompanyId: 11n }],
      AND: [{ OR: [{ code: { contains: 'ريال' } }, { nameAr: { contains: 'ريال' } }] }] } };
    expect(findMany).toHaveBeenCalledExactlyOnceWith({ where,
      select: { currency: { select: { id: true, code: true, nameAr: true, decimals: true } } },
      orderBy: [{ currency: { code: 'asc' } }, { currencyId: 'asc' }], skip: 20, take: 10 });
    expect(count).toHaveBeenCalledExactlyOnceWith({ where });
    expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { maxWait: 2000, timeout: 8000 });
  });

  it('uses only the session company in both membership and custom-currency ownership filters', async () => {
    const { app, authorize, findMany, count } = harness();
    authorize.mockResolvedValue({ ...context, companyId: 99n });
    await request(app).get('/api/v1/currencies/options?search=USD').expect(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: 99n,
      currency: expect.objectContaining({ isActive: true, OR: [{ scope: 'GLOBAL', ownerCompanyId: null },
        { scope: 'COMPANY', ownerCompanyId: 99n }] }) }) }));
    expect(count.mock.calls[0]?.[0].where).toEqual(findMany.mock.calls[0]?.[0].where);
  });

  it.each(['UNAUTHENTICATED', 'FORBIDDEN'] as const)('authorizes before query validation or database access: %s', async (reason) => {
    const { app, authorize, transaction, findMany, count } = harness();
    authorize.mockRejectedValue(new AuthError(reason));
    const status = reason === 'UNAUTHENTICATED' ? 401 : 403;
    const response = await request(app).get('/api/v1/currencies/options?page=10001').expect(status);
    expect(response.body.code).toBe(reason);
    expect(() => parseOpenApiResponseBody('listEnabledCurrencyOptions', status, response.body)).not.toThrow();
    expect(transaction).not.toHaveBeenCalled(); expect(findMany).not.toHaveBeenCalled(); expect(count).not.toHaveBeenCalled();
  });

  it.each(['page=0', 'page=10001', 'page=1.5', 'pageSize=0', 'pageSize=101', 'page=1&page=2',
    'companyId=99', 'active=true', 'search%5Bx%5D=foo', `search=${'x'.repeat(101)}`,
    'search=%00x', 'search=x%0A', 'search=%09x', 'search=x%7F'])('rejects invalid/unknown query before DB: %s', async (query) => {
    const { app, transaction } = harness();
    const response = await request(app).get(`/api/v1/currencies/options?${query}`).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(() => parseOpenApiResponseBody('listEnabledCurrencyOptions', 400, response.body)).not.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('accepts the maximum bounded page/search and keeps blank search unfiltered', async () => {
    expect(enabledCurrencyOptionsQuerySchema.parse({ page: '10000', pageSize: '100', search: `  ${'x'.repeat(100)}  ` }))
      .toEqual({ page: 10000, pageSize: 100, search: 'x'.repeat(100) });
    const { app, findMany, count } = harness();
    findMany.mockResolvedValue([]); count.mockResolvedValue(0);
    const response = await request(app).get('/api/v1/currencies/options?page=10000&pageSize=100&search=%20%20').expect(200);
    expect(response.body).toEqual({ data: [], meta: { page: 10000, pageSize: 100, total: 0, totalPages: 0 } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 999900, take: 100 }));
    expect(findMany.mock.calls[0]?.[0].where.currency).not.toHaveProperty('AND');
  });

  it('also rejects an unbounded internal call before opening a transaction', () => {
    const { companies, transaction } = harness();
    expect(() => companies.listEnabledCurrencyOptions(context, { page: 1, pageSize: 101 })).toThrow();
    expect(() => companies.listEnabledCurrencyOptions(context, { page: 1, pageSize: 20, search: 'x\n' })).toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('proves the actual generated response validator rejects an invalid numeric projection', async () => {
    const { app, findMany } = harness();
    findMany.mockResolvedValue([{ currency: { ...currency, decimals: 1.5 } }]);
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await request(app).get('/api/v1/currencies/options').expect(500);
      expect(logging).toHaveBeenCalledWith(expect.stringContaining('"operationId":"listEnabledCurrencyOptions"'));
      expect(logging).toHaveBeenCalledWith(expect.stringContaining('"contractReason":"INVALID_BODY"'));
    } finally { logging.mockRestore(); }
  });

  it('maps query failures to a safe declared error without leaking database details', async () => {
    const { app, findMany } = harness();
    findMany.mockRejectedValue(new Error('fixture-database-detail'));
    const logging = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app).get('/api/v1/currencies/options').expect(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('fixture-database-detail');
      expect(() => parseOpenApiResponseBody('listEnabledCurrencyOptions', 500, response.body)).not.toThrow();
    } finally { logging.mockRestore(); }
  });

  it('preserves the central deadline error contract', async () => {
    const { app, findMany } = harness();
    findMany.mockRejectedValue(new RequestDeadlineExceededError('LIST_ENABLED_CURRENCY_OPTIONS'));
    const response = await request(app).get('/api/v1/currencies/options').expect(504);
    expect(response.body.code).toBe('REQUEST_DEADLINE_EXCEEDED');
    expect(() => parseOpenApiResponseBody('listEnabledCurrencyOptions', 504, response.body)).not.toThrow();
  });

  it('rejects leaked source fields and unbounded response arrays in the executable contract', () => {
    const entry = { ...currency, id: currency.id.toString() };
    const page = { data: [entry], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } };
    expect(() => parseOpenApiResponseBody('listEnabledCurrencyOptions', 200, { ...page,
      data: [{ ...entry, ownerCompanyId: '99', latestExchangeRate: '1.00000000' }] })).toThrow();
    expect(() => parseOpenApiResponseBody('listEnabledCurrencyOptions', 200, { ...page, data: Array(101).fill(entry) })).toThrow();
  });
});
