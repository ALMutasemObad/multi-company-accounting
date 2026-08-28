import { verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createCompanyService } from '../src/composition/create-company-service.js';
import { createDatabase } from '../src/database.js';

const enabled = process.env.RUN_DB_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const databaseUrl = process.env.DATABASE_URL ?? '';
const password = process.env.SEED_ADMIN_PASSWORD ?? '';
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)('company currencies and dated exchange rates with MariaDB', () => {
  let companyId: bigint;
  let userId: bigint;
  let baseCurrencyId: bigint;
  let usdId: bigint;
  let csrf = '';
  let agent: ReturnType<typeof request.agent>;
  const foreignCompanyCode = 'IT-CURRENCY-ISOLATION';
  const customCodes = ['ITX', 'RCX'];

  async function cleanup() {
    if (!prisma || !companyId || !usdId) return;
    const foreign = await prisma.company.findFirst({ where: { code: foreignCompanyCode } });
    const companyIds = [companyId, ...(foreign ? [foreign.id] : [])];
    await prisma.companyExchangeRate.deleteMany({ where: { companyId: { in: companyIds }, currencyId: usdId } });
    const ownedCurrencies = await prisma.currency.findMany({ where: { ownerCompanyId: { in: companyIds }, code: { in: customCodes } }, select: { id: true } });
    const ownedCurrencyIds = ownedCurrencies.map(({ id }) => id);
    if (ownedCurrencyIds.length) {
      await prisma.companyExchangeRate.deleteMany({ where: { currencyId: { in: ownedCurrencyIds } } });
      await prisma.companyCurrency.deleteMany({ where: { currencyId: { in: ownedCurrencyIds } } });
    }
    await prisma.auditLog.deleteMany({ where: { companyId: { in: companyIds }, action: { in: ['COMPANY_CURRENCIES_UPDATED', 'COMPANY_CURRENCY_CREATED', 'EXCHANGE_RATE_UPSERTED'] } } });
    await prisma.companyCurrency.deleteMany({ where: { companyId: { in: companyIds }, currencyId: usdId } });
    if (foreign) {
      await prisma.companyCurrency.deleteMany({ where: { companyId: foreign.id } });
      if (ownedCurrencyIds.length) await prisma.currency.deleteMany({ where: { id: { in: ownedCurrencyIds } } });
      await prisma.company.delete({ where: { id: foreign.id } });
    } else if (ownedCurrencyIds.length) {
      await prisma.currency.deleteMany({ where: { id: { in: ownedCurrencyIds } } });
    }
  }

  async function ensureForeignCompany() {
    const current = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    const foreign = await prisma!.company.upsert({
      where: { organizationId_code: { organizationId: current.organizationId, code: foreignCompanyCode } },
      update: { baseCurrencyId, name: 'شركة عزل العملات', timezone: 'Asia/Riyadh', isActive: true },
      create: { code: foreignCompanyCode, organizationId: current.organizationId, baseCurrencyId, name: 'شركة عزل العملات', timezone: 'Asia/Riyadh' },
    });
    for (const currencyId of [baseCurrencyId, usdId]) {
      await prisma!.companyCurrency.upsert({
        where: { companyId_currencyId: { companyId: foreign.id, currencyId } },
        update: { isActive: true },
        create: { companyId: foreign.id, currencyId },
      });
    }
    return foreign;
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    userId = user.id;
    const assignment = await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true }, include: { company: true } });
    companyId = assignment.companyId;
    baseCurrencyId = assignment.company.baseCurrencyId;
    const usd = await prisma!.currency.upsert({
      where: { scopeKey_code: { scopeKey: 'GLOBAL', code: 'USD' } },
      update: { nameAr: 'دولار أمريكي', decimals: 2, isActive: true, scope: 'GLOBAL', ownerCompanyId: null },
      create: { code: 'USD', nameAr: 'دولار أمريكي', decimals: 2, scope: 'GLOBAL', scopeKey: 'GLOBAL' },
    });
    usdId = usd.id;
    await cleanup();

    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    const companies = createCompanyService(prisma!);
    const app = createApp(
      { NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl },
      { auth, companies },
    );
    agent = request.agent(app);
    csrf = (await agent.get('/api/v1/auth/csrf').expect(200)).body.csrfToken;
    const login = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin@mcap.local', password }).expect(200);
    csrf = login.body.csrfToken;
    await agent.put('/api/v1/auth/context').set('X-CSRF-Token', csrf).send({ companyId: companyId.toString() }).expect(204);
  });

  afterAll(async () => {
    await cleanup();
    await prisma?.$disconnect();
  });

  it('keeps the base currency enabled and scopes selectable currencies to the company', async () => {
    const initial = await agent.get('/api/v1/company-currencies').expect(200);
    expect(initial.body.data.find((item: { id: string }) => item.id === baseCurrencyId.toString())).toMatchObject({ isBase: true, isEnabled: true });
    expect(initial.body.data.find((item: { id: string }) => item.id === usdId.toString())).toMatchObject({ isBase: false, isEnabled: false });

    const enabledCurrencies = await agent.put('/api/v1/company-currencies').set('X-CSRF-Token', csrf).send({ currencyIds: [usdId.toString()] }).expect(200);
    expect(enabledCurrencies.body.data.find((item: { id: string }) => item.id === baseCurrencyId.toString()).isEnabled).toBe(true);
    expect(enabledCurrencies.body.data.find((item: { id: string }) => item.id === usdId.toString()).isEnabled).toBe(true);

    const selectable = await agent.get('/api/v1/currencies').expect(200);
    expect(selectable.body.data.map((item: { code: string }) => item.code)).toContain('USD');
    expect(selectable.body.data[0]).toMatchObject({ isBase: true, latestExchangeRate: '1.00000000' });
  });

  it('upserts, audits and resolves the latest rate on or before a document date', async () => {
    await agent.put('/api/v1/exchange-rates').set('X-CSRF-Token', csrf).send({ currencyId: usdId.toString(), rateDate: '2026-08-01', rate: '3.75000000', source: 'مصرف الاختبار' }).expect(200);
    await agent.put('/api/v1/exchange-rates').set('X-CSRF-Token', csrf).send({ currencyId: usdId.toString(), rateDate: '2026-08-10', rate: '3.76000000', source: 'مصرف الاختبار' }).expect(200);
    await agent.put('/api/v1/exchange-rates').set('X-CSRF-Token', csrf).send({ currencyId: usdId.toString(), rateDate: '2026-08-01', rate: '3.75500000', source: 'تصحيح مصرف الاختبار' }).expect(200);

    const resolved = await agent.get('/api/v1/exchange-rates/resolve').query({ currencyId: usdId.toString(), rateDate: '2026-08-09' }).expect(200);
    expect(resolved.body).toMatchObject({ rate: '3.75500000', rateDate: '2026-08-01', source: 'تصحيح مصرف الاختبار' });
    expect(await prisma!.auditLog.count({ where: { companyId, action: 'EXCHANGE_RATE_UPSERTED', entityType: 'COMPANY_EXCHANGE_RATE' } })).toBe(3);
    const correctionAudit = await prisma!.auditLog.findFirstOrThrow({ where: { companyId, action: 'EXCHANGE_RATE_UPSERTED' }, orderBy: { id: 'desc' } });
    expect(correctionAudit.details).toMatchObject({ previousRate: '3.75000000', previousSource: 'مصرف الاختبار' });

    await agent.put('/api/v1/exchange-rates').set('X-CSRF-Token', csrf).send({ currencyId: baseCurrencyId.toString(), rateDate: '2026-08-01', rate: '1.00000000' }).expect(422);
  });

  it('isolates rates with the same currency and date between companies', async () => {
    const foreign = await ensureForeignCompany();
    const service = createCompanyService(prisma!);
    await service.upsertExchangeRate({ userId, companyId: foreign.id }, { currencyId: usdId, rateDate: '2026-08-01', rate: '7.50000000', source: 'شركة أخرى' });

    const currentRate = await service.resolveExchangeRate({ userId, companyId }, usdId, '2026-08-01');
    const foreignRate = await service.resolveExchangeRate({ userId, companyId: foreign.id }, usdId, '2026-08-01');
    expect(currentRate.rate.toFixed(8)).toBe('3.75500000');
    expect(foreignRate.rate.toFixed(8)).toBe('7.50000000');
  });

  it('creates, audits and isolates company-owned currencies while handling duplicate races', async () => {
    const foreign = await ensureForeignCompany();
    const service = createCompanyService(prisma!);
    const currentContext = { userId, companyId };
    const foreignContext = { userId, companyId: foreign.id };

    const created = await agent
      .post('/api/v1/company-currencies')
      .set('X-CSRF-Token', csrf)
      .send({ code: 'ITX', nameAr: 'عملة الشركة الاختبارية', decimals: 3 })
      .expect(201);
    expect(created.body).toMatchObject({ code: 'ITX', decimals: 3, isCustom: true, isEnabled: true, isBase: false });
    expect(await prisma!.auditLog.count({ where: { companyId, action: 'COMPANY_CURRENCY_CREATED', entityId: created.body.id } })).toBe(1);

    await agent
      .post('/api/v1/company-currencies')
      .set('X-CSRF-Token', csrf)
      .send({ code: 'ITX', nameAr: 'نسخة مكررة', decimals: 2 })
      .expect(409);
    await agent
      .post('/api/v1/company-currencies')
      .set('X-CSRF-Token', csrf)
      .send({ code: 'USD', nameAr: 'نسخة خاصة من الدولار', decimals: 2 })
      .expect(409);

    const foreignBefore = await service.listCurrencyCatalog(foreignContext);
    expect(foreignBefore.some(({ id }) => id.toString() === created.body.id)).toBe(false);
    await expect(service.updateCompanyCurrencies(foreignContext, [BigInt(created.body.id)])).rejects.toMatchObject({ reason: 'CURRENCY_NOT_FOUND' });

    const foreignCurrency = await service.createCompanyCurrency(foreignContext, { code: 'ITX', nameAr: 'عملة الشركة الأخرى', decimals: 2 });
    expect(foreignCurrency.id.toString()).not.toBe(created.body.id);
    const currentCatalog = await service.listCurrencyCatalog(currentContext);
    const foreignCatalog = await service.listCurrencyCatalog(foreignContext);
    expect(currentCatalog.some(({ id }) => id === foreignCurrency.id)).toBe(false);
    expect(foreignCatalog.some(({ id }) => id.toString() === created.body.id)).toBe(false);

    const race = await Promise.allSettled([
      service.createCompanyCurrency(currentContext, { code: 'RCX', nameAr: 'عملة سباق أولى', decimals: 2 }),
      service.createCompanyCurrency(currentContext, { code: 'RCX', nameAr: 'عملة سباق ثانية', decimals: 2 }),
    ]);
    expect(race.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = race.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: { reason: 'CURRENCY_CODE_EXISTS' } });
  });
});
