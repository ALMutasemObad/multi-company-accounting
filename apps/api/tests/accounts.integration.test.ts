import { verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AccountError, AccountService } from '../src/accounts/account-service.js';
import { DEFAULT_CHART_TEMPLATE_CODE, defaultChartDefinitions } from '../src/accounts/default-chart-template.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createDatabase } from '../src/database.js';

const enabled = process.env.RUN_DB_TESTS === 'true'; const databaseUrl = process.env.DATABASE_URL ?? ''; const password = process.env.SEED_ADMIN_PASSWORD ?? ''; const prisma = enabled ? createDatabase(databaseUrl) : null;
describe.runIf(enabled)('accounts and cost centers with MariaDB', () => {
  let app: ReturnType<typeof createApp>; let service: AccountService; let companyId: bigint; let csrf = ''; let agent: ReturnType<typeof request.agent>;
  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId: user.id, isActive: true } })).companyId;
    await prisma!.receiptAllocation.deleteMany({ where: { companyId, targetJournalLine: { account: { code: { startsWith: 'IT-' } } } } });
    await prisma!.salesInvoice.updateMany({ where: { companyId, arJournalLine: { account: { code: { startsWith: 'IT-' } } } }, data: { arJournalLineId: null } });
    await prisma!.journalLine.deleteMany({ where: { companyId, account: { code: { startsWith: 'IT-' } } } });
    await prisma!.account.updateMany({ where: { companyId, code: { startsWith: 'IT-' } }, data: { parentAccountId: null } });
    await prisma!.account.deleteMany({ where: { companyId, code: { startsWith: 'IT-' } } });
    await prisma!.costCenter.updateMany({ where: { companyId, code: { startsWith: 'IT-' } }, data: { parentId: null } });
    await prisma!.costCenter.deleteMany({ where: { companyId, code: { startsWith: 'IT-' } } });
    service = new AccountService(prisma!);
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, accounts: service });
    agent = request.agent(app);
    csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken;
    const login = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin@mcap.local', password }).expect(200);
    csrf = login.body.csrfToken;
    const companies = await agent.get('/api/v1/auth/companies').expect(200);
    await agent.put('/api/v1/auth/context').set('X-CSRF-Token', csrf).send({ companyId: companies.body.data[0].id }).expect(204);
  });
  afterAll(async () => { await prisma!.auditLog.deleteMany({ where: { companyId, entityType: { in: ['ACCOUNT', 'COST_CENTER'] } } }); await prisma!.account.updateMany({ where: { companyId, code: { startsWith: 'IT-' } }, data: { parentAccountId: null } }); await prisma!.account.deleteMany({ where: { companyId, code: { startsWith: 'IT-' } } }); await prisma!.costCenter.updateMany({ where: { companyId, code: { startsWith: 'IT-' } }, data: { parentId: null } }); await prisma!.costCenter.deleteMany({ where: { companyId, code: { startsWith: 'IT-' } } }); await prisma!.$disconnect(); });
  it('builds an account tree, prevents cycles and enforces posting eligibility', async () => { const type = (await agent.get('/api/v1/account-types').expect(200)).body.data[0]; const parent = await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, code: 'IT-PARENT', nameAr: 'حساب تجميعي', allowsPosting: false }).expect(201); const child = await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: parent.body.id, code: 'IT-CHILD', nameAr: 'حساب ترحيل', allowsPosting: true }).expect(201); expect(child.body.level).toBe(2); await expect(service.assertPostingAllowed(companyId, BigInt(parent.body.id))).rejects.toMatchObject({ reason: 'POSTING_NOT_ALLOWED' } satisfies Partial<AccountError>); await service.assertPostingAllowed(companyId, BigInt(child.body.id)); await agent.patch(`/api/v1/accounts/${parent.body.id}`).set('X-CSRF-Token', csrf).send({ parentAccountId: child.body.id }).expect(422); await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: child.body.id, code: 'IT-BAD', nameAr: 'غير صالح', allowsPosting: true }).expect(422); await agent.post(`/api/v1/accounts/${child.body.id}/deactivate`).set('X-CSRF-Token', csrf).send({ reason: 'انتهاء الحاجة للاختبار' }).expect(200); await expect(service.assertPostingAllowed(companyId, BigInt(child.body.id))).rejects.toMatchObject({ reason: 'POSTING_NOT_ALLOWED' }); });
  it('generates concurrent cost-center codes, prevents cycles and preserves manual account numbering', async () => {
    const createdIds: string[] = [];
    try {
      const root = await agent.post('/api/v1/cost-centers').set('X-CSRF-Token', csrf).send({ nameAr: 'المركز الرئيسي' }).expect(201);
      const child = await agent.post('/api/v1/cost-centers').set('X-CSRF-Token', csrf).send({ parentId: root.body.id, nameAr: 'المركز الفرعي' }).expect(201);
      createdIds.push(root.body.id, child.body.id);
      expect(root.body.code).toMatch(/^CC-[0-9]{6,}$/);
      await agent.patch(`/api/v1/cost-centers/${root.body.id}`).set('X-CSRF-Token', csrf).send({ parentId: child.body.id }).expect(422);

      const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) => agent.post('/api/v1/cost-centers').set('X-CSRF-Token', csrf).send({ nameAr: `مركز تزامن ${index + 1}` })));
      expect(concurrent.every((response) => response.status === 201)).toBe(true);
      createdIds.push(...concurrent.map((response) => response.body.id));
      const codes = concurrent.map((response) => response.body.code as string);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes.every((code) => /^CC-[0-9]{6,}$/.test(code))).toBe(true);

      const type = (await agent.get('/api/v1/account-types')).body.data[0];
      const results = await Promise.all([1, 2].map(() => agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, code: 'IT-CONCURRENT', nameAr: 'تزامن', allowsPosting: true })));
      expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    } finally {
      await prisma!.costCenter.updateMany({ where: { id: { in: createdIds.map(BigInt) } }, data: { parentId: null } });
      await prisma!.auditLog.deleteMany({ where: { companyId, entityType: 'COST_CENTER', entityId: { in: createdIds } } });
      await prisma!.costCenter.deleteMany({ where: { id: { in: createdIds.map(BigInt) } } });
    }
  });
  it('applies the default chart idempotently, preserves customizations and safely restores deleted template leaves', async () => {
    const originalIds = (await prisma!.account.findMany({ where: { companyId }, select: { id: true } })).map(({ id }) => id);
    try {
      const before = await agent.get('/api/v1/accounts/default-template').expect(200);
      expect(before.body.total).toBe(defaultChartDefinitions.length);
      expect(before.body.missing).toBeGreaterThan(0);
      const applied = await agent.post('/api/v1/accounts/default-template/apply').set('X-CSRF-Token', csrf).expect(200);
      expect(applied.body.created + applied.body.linked + applied.body.existing).toBe(defaultChartDefinitions.length);
      expect(applied.body.missing).toBe(0);

      const cash = await prisma!.account.findFirstOrThrow({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE, sourceTemplateKey: 'cash' } });
      await agent.patch(`/api/v1/accounts/${cash.id}`).set('X-CSRF-Token', csrf).send({ code: 'IT-TEMPLATE-CUSTOM', nameAr: 'صندوق مخصص' }).expect(200);
      const replay = await agent.post('/api/v1/accounts/default-template/apply').set('X-CSRF-Token', csrf).expect(200);
      expect(replay.body.created).toBe(0);
      expect(await prisma!.account.count({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE, sourceTemplateKey: 'cash' } })).toBe(1);
      expect(await prisma!.account.count({ where: { companyId, code: '1110' } })).toBe(0);

      const leaf = await prisma!.account.findFirstOrThrow({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE, sourceTemplateKey: 'misc-expense' } });
      await agent.delete(`/api/v1/accounts/${leaf.id}`).set('X-CSRF-Token', csrf).send({ reason: 'اختبار إعادة بناء الحساب' }).expect(200);
      expect((await agent.get('/api/v1/accounts/default-template').expect(200)).body.missing).toBe(1);
      expect((await agent.post('/api/v1/accounts/default-template/apply').set('X-CSRF-Token', csrf).expect(200)).body.created).toBe(1);

      const root = await prisma!.account.findFirstOrThrow({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE, sourceTemplateKey: 'assets' } });
      const blocked = await agent.delete(`/api/v1/accounts/${root.id}`).set('X-CSRF-Token', csrf).send({ reason: 'اختبار منع حذف الجذر' }).expect(422);
      expect(blocked.body.reason).toBe('HAS_CHILDREN');
      const used = await agent.delete(`/api/v1/accounts/${cash.id}`).set('X-CSRF-Token', csrf).send({ reason: 'اختبار منع حذف حساب مستخدم' }).expect(409);
      expect(used.body.reason).toBe('ACCOUNT_IN_USE');
      await agent.patch(`/api/v1/accounts/${cash.id}`).set('X-CSRF-Token', csrf).send({ code: '1110', nameAr: 'الصندوق الرئيسي' }).expect(200);
    } finally {
      const createdIds = (await prisma!.account.findMany({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE, id: { notIn: originalIds } }, select: { id: true } })).map(({ id }) => id);
      if (createdIds.length) {
        await prisma!.account.updateMany({ where: { id: { in: createdIds } }, data: { parentAccountId: null } });
        await prisma!.account.deleteMany({ where: { id: { in: createdIds } } });
      }
      await prisma!.account.updateMany({ where: { id: { in: originalIds }, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE }, data: { sourceTemplateCode: null, sourceTemplateKey: null } });
      await prisma!.auditLog.deleteMany({ where: { companyId, action: { in: ['DEFAULT_CHART_TEMPLATE_APPLIED', 'ACCOUNT_DELETED'] } } });
    }
  });
  it('isolates records belonging to another company', async () => { const base = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } }); const other = await prisma!.company.create({ data: { organizationId: base.organizationId, baseCurrencyId: base.baseCurrencyId, name: 'شركة عزل الحسابات', timezone: 'Asia/Riyadh' } }); const type = await prisma!.accountType.findFirstOrThrow(); const foreign = await prisma!.account.create({ data: { companyId: other.id, accountTypeId: type.id, code: 'IT-FOREIGN', nameAr: 'حساب شركة أخرى', level: 1, allowsPosting: true } }); try { await agent.get(`/api/v1/accounts/${foreign.id}`).expect(404); expect((await agent.get('/api/v1/accounts').query({ search: 'IT-FOREIGN' }).expect(200)).body.data).toHaveLength(0); } finally { await prisma!.account.delete({ where: { id: foreign.id } }); await prisma!.company.delete({ where: { id: other.id } }); } });
});
