import { verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { CompanyService } from '../src/companies/company-service.js';
import { createDatabase } from '../src/database.js';
import { ReceiptReferenceService } from '../src/receipts/reference-service.js';

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

  async function cleanup() {
    if (!prisma || !companyId || !usdId) return;
    const foreign = await prisma.company.findFirst({ where: { code: foreignCompanyCode } });
    const companyIds = [companyId, ...(foreign ? [foreign.id] : [])];
    await prisma.companyExchangeRate.deleteMany({ where: { companyId: { in: companyIds }, currencyId: usdId } });
    await prisma.auditLog.deleteMany({ where: { companyId: { in: companyIds }, action: { in: ['COMPANY_CURRENCIES_UPDATED', 'EXCHANGE_RATE_UPSERTED'] } } });
    await prisma.companyCurrency.deleteMany({ where: { companyId: { in: companyIds }, currencyId: usdId } });
    if (foreign) {
      await prisma.companyCurrency.deleteMany({ where: { companyId: foreign.id } });
      await prisma.company.delete({ where: { id: foreign.id } });
    }
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    userId = user.id;
    const assignment = await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true }, include: { company: true } });
    companyId = assignment.companyId;
    baseCurrencyId = assignment.company.baseCurrencyId;
    const usd = await prisma!.currency.upsert({
      where: { code: 'USD' },
      update: { nameAr: 'دولار أمريكي', decimals: 2, isActive: true },
      create: { code: 'USD', nameAr: 'دولار أمريكي', decimals: 2 },
    });
    usdId = usd.id;
    await cleanup();

    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    const companies = new CompanyService(prisma!);
    const app = createApp(
      { NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl },
      { auth, companies, receiptReferences: new ReceiptReferenceService(prisma!) },
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
    const current = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    const foreign = await prisma!.company.create({ data: { code: foreignCompanyCode, organizationId: current.organizationId, baseCurrencyId, name: 'شركة عزل العملات', timezone: 'Asia/Riyadh' } });
    await prisma!.companyCurrency.createMany({ data: [
      { companyId: foreign.id, currencyId: baseCurrencyId },
      { companyId: foreign.id, currencyId: usdId },
    ] });
    const service = new CompanyService(prisma!);
    await service.upsertExchangeRate({ userId, companyId: foreign.id }, { currencyId: usdId, rateDate: '2026-08-01', rate: '7.50000000', source: 'شركة أخرى' });

    const currentRate = await service.resolveExchangeRate({ userId, companyId }, usdId, '2026-08-01');
    const foreignRate = await service.resolveExchangeRate({ userId, companyId: foreign.id }, usdId, '2026-08-01');
    expect(currentRate.rate.toFixed(8)).toBe('3.75500000');
    expect(foreignRate.rate.toFixed(8)).toBe('7.50000000');
  });
});
