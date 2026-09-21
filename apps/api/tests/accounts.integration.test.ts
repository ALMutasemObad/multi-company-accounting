import { verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AccountError, AccountService } from '../src/accounts/account-service.js';
import { DEFAULT_CHART_TEMPLATE_CODE, defaultChartDefinitions } from '../src/accounts/default-chart-template.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createDatabase } from '../src/database.js';
import { testAuthOptions } from './helpers/test-auth-options.js';

const enabled = process.env.RUN_DB_TESTS === 'true'; const databaseUrl = process.env.DATABASE_URL ?? ''; const password = process.env.SEED_ADMIN_PASSWORD ?? ''; const prisma = enabled ? createDatabase(databaseUrl) : null;
describe.runIf(enabled)('accounts and cost centers with MariaDB', () => {
  let app: ReturnType<typeof createApp>; let service: AccountService; let companyId: bigint; let csrf = ''; let agent: ReturnType<typeof request.agent>;
  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId: user.id, isActive: true } })).companyId;
    await prisma!.receiptAllocation.deleteMany({ where: { companyId, receivableItem: { salesInvoice: { arJournalLine: { account: { code: { startsWith: 'IT-' } } } } } } });
    await prisma!.receivableItem.deleteMany({ where: { companyId, salesInvoice: { arJournalLine: { account: { code: { startsWith: 'IT-' } } } } } });
    await prisma!.salesInvoice.updateMany({ where: { companyId, arJournalLine: { account: { code: { startsWith: 'IT-' } } } }, data: { arJournalLineId: null } });
    await prisma!.journalLine.deleteMany({ where: { companyId, account: { code: { startsWith: 'IT-' } } } });
    await prisma!.account.updateMany({ where: { companyId, code: { startsWith: 'IT-' } }, data: { parentAccountId: null } });
    await prisma!.account.deleteMany({ where: { companyId, code: { startsWith: 'IT-' } } });
    await prisma!.costCenter.updateMany({ where: { companyId, code: { startsWith: 'IT-' } }, data: { parentId: null } });
    await prisma!.costCenter.deleteMany({ where: { companyId, code: { startsWith: 'IT-' } } });
    service = new AccountService(prisma!);
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, testAuthOptions(prisma!));
    app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, accounts: service });
    agent = request.agent(app);
    csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken;
    const login = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf).send({ email: 'admin@mcap.local', password }).expect(200);
    csrf = login.body.csrfToken;
    const companies = await agent.get('/api/v1/auth/companies').expect(200);
    await agent.put('/api/v1/auth/context').set('X-CSRF-Token', csrf).send({ companyId: companies.body.data[0].id }).expect(204);
  });
  afterAll(async () => { await prisma!.auditLog.deleteMany({ where: { companyId, entityType: { in: ['ACCOUNT', 'COST_CENTER'] } } }); await prisma!.account.updateMany({ where: { companyId, code: { startsWith: 'IT-' } }, data: { parentAccountId: null } }); await prisma!.account.deleteMany({ where: { companyId, code: { startsWith: 'IT-' } } }); await prisma!.costCenter.updateMany({ where: { companyId, code: { startsWith: 'IT-' } }, data: { parentId: null } }); await prisma!.costCenter.deleteMany({ where: { companyId, code: { startsWith: 'IT-' } } }); await prisma!.$disconnect(); });
  it('builds an account tree, prevents cycles and enforces posting eligibility', async () => { const type = (await agent.get('/api/v1/account-types').expect(200)).body.data[0]; const parent = await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, code: 'IT-PARENT', nameAr: 'حساب تجميعي', allowsPosting: false }).expect(201); const child = await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: parent.body.id, code: 'IT-CHILD', nameAr: 'حساب ترحيل', allowsPosting: true }).expect(201); expect(child.body).toMatchObject({ level: 2, version: 0 }); await expect(service.assertPostingAllowed(companyId, BigInt(parent.body.id))).rejects.toMatchObject({ reason: 'POSTING_NOT_ALLOWED' } satisfies Partial<AccountError>); await service.assertPostingAllowed(companyId, BigInt(child.body.id)); await agent.patch(`/api/v1/accounts/${parent.body.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: parent.body.version, parentAccountId: child.body.id }).expect(422); await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: child.body.id, code: 'IT-BAD', nameAr: 'غير صالح', allowsPosting: true }).expect(422); const deactivated = await agent.post(`/api/v1/accounts/${child.body.id}/deactivate`).set('X-CSRF-Token', csrf).send({ expectedVersion: child.body.version, reason: 'انتهاء الحاجة للاختبار' }).expect(200); expect(deactivated.body.version).toBe(child.body.version + 1); expect((await agent.post(`/api/v1/accounts/${child.body.id}/deactivate`).set('X-CSRF-Token', csrf).send({ expectedVersion: child.body.version, reason: 'نسخة قديمة للتعطيل' }).expect(409)).body.code).toBe('VERSION_CONFLICT'); await expect(service.assertPostingAllowed(companyId, BigInt(child.body.id))).rejects.toMatchObject({ reason: 'POSTING_NOT_ALLOWED' }); });
  it('uses atomic CAS and increments only levels changed by reparenting', async () => {
    const type = (await agent.get('/api/v1/account-types').expect(200)).body.data[0];
    const source = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, code: 'IT-CAS-SOURCE', nameAr: 'مصدر', allowsPosting: false }).expect(201)).body;
    const targetRoot = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, code: 'IT-CAS-TARGET', nameAr: 'هدف', allowsPosting: false }).expect(201)).body;
    const targetParent = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: targetRoot.id, code: 'IT-CAS-TARGET-P', nameAr: 'أب هدف', allowsPosting: false }).expect(201)).body;
    const moved = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: source.id, code: 'IT-CAS-MOVED', nameAr: 'منقول', allowsPosting: false }).expect(201)).body;
    const descendant = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: moved.id, code: 'IT-CAS-DESC', nameAr: 'تابع', allowsPosting: true }).expect(201)).body;
    const unaffected = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: source.id, code: 'IT-CAS-STABLE', nameAr: 'غير متأثر', allowsPosting: true }).expect(201)).body;

    const reparented = await agent.patch(`/api/v1/accounts/${moved.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: moved.version, parentAccountId: targetParent.id }).expect(200);
    expect(reparented.body).toMatchObject({ level: 3, version: moved.version + 1 });
    expect(await prisma!.account.findFirstOrThrow({ where: { id: BigInt(descendant.id), companyId }, select: { level: true, version: true } })).toEqual({ level: 4, version: descendant.version + 1 });
    expect(await prisma!.account.findFirstOrThrow({ where: { id: BigInt(unaffected.id), companyId }, select: { level: true, version: true } })).toEqual({ level: 2, version: unaffected.version });

    const stale = await agent.patch(`/api/v1/accounts/${moved.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: moved.version, nameAr: 'نسخة قديمة' }).expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', reason: 'VERSION_CONFLICT' });
    const concurrent = await Promise.all(['أ', 'ب'].map((suffix) => agent.patch(`/api/v1/accounts/${moved.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: reparented.body.version, nameAr: `تحديث ${suffix}` })));
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    const renamed = await agent.patch(`/api/v1/accounts/${unaffected.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: unaffected.version, nameAr: 'ورقة محدثة' }).expect(200);
    expect((await agent.delete(`/api/v1/accounts/${unaffected.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: unaffected.version, reason: 'نسخة قديمة للحذف' }).expect(409)).body.code).toBe('VERSION_CONFLICT');
    await agent.delete(`/api/v1/accounts/${unaffected.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: renamed.body.version, reason: 'حذف CAS ناجح' }).expect(200);
  });
  it('serializes child creation and reparenting against parent deactivation', async () => {
    const type = (await agent.get('/api/v1/account-types').expect(200)).body.data[0];
    const createParent = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, code: 'IT-RACE-CREATE-P', nameAr: 'أب سباق الإنشاء', allowsPosting: false }).expect(201)).body;
    const [createdChild, createParentDeactivation] = await Promise.all([
      agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: createParent.id, code: 'IT-RACE-CREATE-C', nameAr: 'طفل سباق الإنشاء', allowsPosting: true }),
      agent.post(`/api/v1/accounts/${createParent.id}/deactivate`).set('X-CSRF-Token', csrf).send({ expectedVersion: createParent.version, reason: 'سباق إنشاء طفل' }),
    ]);
    expect([createdChild.status, createParentDeactivation.status].filter((status) => status === 200 || status === 201)).toHaveLength(1);
    const persistedCreateParent = await prisma!.account.findFirstOrThrow({ where: { id: BigInt(createParent.id), companyId } });
    const persistedChild = await prisma!.account.findFirst({ where: { companyId, code: 'IT-RACE-CREATE-C' } });
    expect(persistedChild == null || persistedCreateParent.isActive).toBe(true);

    const postingParent = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, code: 'IT-RACE-POST-P', nameAr: 'أب سباق الترحيل', allowsPosting: false }).expect(201)).body;
    const [postingChild, madePosting] = await Promise.all([
      agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: postingParent.id, code: 'IT-RACE-POST-C', nameAr: 'طفل سباق الترحيل', allowsPosting: true }),
      agent.patch(`/api/v1/accounts/${postingParent.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: postingParent.version, allowsPosting: true }),
    ]);
    expect([postingChild.status, madePosting.status].filter((status) => status === 200 || status === 201)).toHaveLength(1);
    const [persistedPostingParent, persistedPostingChild] = await Promise.all([
      prisma!.account.findFirstOrThrow({ where: { id: BigInt(postingParent.id), companyId } }),
      prisma!.account.findFirst({ where: { companyId, code: 'IT-RACE-POST-C' } }),
    ]);
    expect(persistedPostingParent.allowsPosting && persistedPostingChild != null).toBe(false);

    const source = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, code: 'IT-RACE-SOURCE', nameAr: 'مصدر سباق النقل', allowsPosting: false }).expect(201)).body;
    const moved = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, parentAccountId: source.id, code: 'IT-RACE-MOVED', nameAr: 'حساب منقول', allowsPosting: true }).expect(201)).body;
    const target = (await agent.post('/api/v1/accounts').set('X-CSRF-Token', csrf).send({ accountTypeId: type.id, code: 'IT-RACE-TARGET', nameAr: 'هدف سباق النقل', allowsPosting: false }).expect(201)).body;
    const [reparented, targetDeactivation] = await Promise.all([
      agent.patch(`/api/v1/accounts/${moved.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: moved.version, parentAccountId: target.id }),
      agent.post(`/api/v1/accounts/${target.id}/deactivate`).set('X-CSRF-Token', csrf).send({ expectedVersion: target.version, reason: 'سباق نقل طفل' }),
    ]);
    expect([reparented.status, targetDeactivation.status].filter((status) => status === 200)).toHaveLength(1);
    const [persistedMoved, persistedTarget] = await Promise.all([
      prisma!.account.findFirstOrThrow({ where: { id: BigInt(moved.id), companyId } }),
      prisma!.account.findFirstOrThrow({ where: { id: BigInt(target.id), companyId } }),
    ]);
    expect(persistedMoved.parentAccountId === persistedTarget.id && !persistedTarget.isActive).toBe(false);
  });
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
    let usageId: bigint | undefined;
    try {
      const before = await agent.get('/api/v1/accounts/default-template').expect(200);
      expect(before.body.total).toBe(defaultChartDefinitions.length);
      const applied = await agent.post('/api/v1/accounts/default-template/apply').set('X-CSRF-Token', csrf).expect(200);
      expect(applied.body.created + applied.body.linked + applied.body.existing).toBe(defaultChartDefinitions.length);
      expect(applied.body.missing).toBe(0);

      const cash = await prisma!.account.findFirstOrThrow({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE, sourceTemplateKey: 'cash' } });
      const customized = await agent.patch(`/api/v1/accounts/${cash.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: cash.version, code: 'IT-TEMPLATE-CUSTOM', nameAr: 'صندوق مخصص' }).expect(200);
      const replay = await agent.post('/api/v1/accounts/default-template/apply').set('X-CSRF-Token', csrf).expect(200);
      expect(replay.body.created).toBe(0);
      expect(await prisma!.account.count({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE, sourceTemplateKey: 'cash' } })).toBe(1);
      expect(await prisma!.account.count({ where: { companyId, code: '1110' } })).toBe(0);

      const leaf = await prisma!.account.findFirstOrThrow({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE, sourceTemplateKey: 'misc-expense' } });
      await agent.delete(`/api/v1/accounts/${leaf.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: leaf.version, reason: 'اختبار إعادة بناء الحساب' }).expect(200);
      expect((await agent.get('/api/v1/accounts/default-template').expect(200)).body.missing).toBe(1);
      expect((await agent.post('/api/v1/accounts/default-template/apply').set('X-CSRF-Token', csrf).expect(200)).body.created).toBe(1);

      const root = await prisma!.account.findFirstOrThrow({ where: { companyId, sourceTemplateCode: DEFAULT_CHART_TEMPLATE_CODE, sourceTemplateKey: 'assets' } });
      const blocked = await agent.delete(`/api/v1/accounts/${root.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: root.version, reason: 'اختبار منع حذف الجذر' }).expect(422);
      expect(blocked.body.reason).toBe('HAS_CHILDREN');
      usageId = (await prisma!.cashBankAccount.create({
        data: { companyId, ledgerAccountId: cash.id, accountType: 'CASH', code: `IT-ACCOUNT-USE-${Date.now().toString().slice(-8)}`, nameAr: 'استخدام حساب لاختبار منع الحذف' },
      })).id;
      const used = await agent.delete(`/api/v1/accounts/${cash.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: customized.body.version, reason: 'اختبار منع حذف حساب مستخدم' }).expect(409);
      expect(used.body.reason).toBe('ACCOUNT_IN_USE');
      await agent.patch(`/api/v1/accounts/${cash.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: customized.body.version, code: '1110', nameAr: 'الصندوق الرئيسي' }).expect(200);
    } finally {
      if (usageId) await prisma!.cashBankAccount.deleteMany({ where: { id: usageId, companyId } });
      await prisma!.auditLog.deleteMany({ where: { companyId, action: { in: ['DEFAULT_CHART_TEMPLATE_APPLIED', 'ACCOUNT_DELETED'] } } });
    }
  });
  it('isolates records belonging to another company', async () => { const base = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } }); const other = await prisma!.company.create({ data: { organizationId: base.organizationId, baseCurrencyId: base.baseCurrencyId, name: 'شركة عزل الحسابات', timezone: 'Asia/Riyadh' } }); const type = await prisma!.accountType.findFirstOrThrow(); const foreign = await prisma!.account.create({ data: { companyId: other.id, accountTypeId: type.id, code: 'IT-FOREIGN', nameAr: 'حساب شركة أخرى', level: 1, allowsPosting: true } }); try { await agent.get(`/api/v1/accounts/${foreign.id}`).expect(404); await agent.patch(`/api/v1/accounts/${foreign.id}`).set('X-CSRF-Token', csrf).send({ expectedVersion: foreign.version, nameAr: 'محاولة عابرة للشركات' }).expect(404); await agent.post(`/api/v1/accounts/${foreign.id}/deactivate`).set('X-CSRF-Token', csrf).send({ expectedVersion: foreign.version, reason: 'محاولة عابرة للشركات' }).expect(404); expect((await agent.get('/api/v1/accounts').query({ search: 'IT-FOREIGN' }).expect(200)).body.data).toHaveLength(0); } finally { await prisma!.account.delete({ where: { id: foreign.id } }); await prisma!.company.delete({ where: { id: other.id } }); } });
});
