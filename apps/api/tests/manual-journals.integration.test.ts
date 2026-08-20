import { hash, verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createDatabase } from '../src/database.js';
import { ManualJournalService, type JournalCreateInput } from '../src/journals/manual-journal-service.js';

const enabled = process.env.RUN_DB_TESTS === 'true';
const databaseUrl = process.env.DATABASE_URL ?? '';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? '';
const prisma = enabled ? createDatabase(databaseUrl) : null;
const makerEmail = 'journal.maker@mcap.local';
const makerPassword = 'Journal-Maker-2026!';

describe.runIf(enabled)('manual journal lifecycle with MariaDB', () => {
  let app: ReturnType<typeof createApp>;
  let service: ManualJournalService;
  let companyId: bigint;
  let adminUserId: bigint;
  let makerId: bigint;
  let yearId: bigint;
  let periodId: bigint;
  let debitId: bigint;
  let creditId: bigint;
  let currencyId: bigint;
  let costCenterId: bigint;
  let admin: ReturnType<typeof request.agent>;
  let maker: ReturnType<typeof request.agent>;
  let adminCsrf = '';
  let makerCsrf = '';

  function apiPayload(description = 'IT-JRN قيد متوازن') {
    return {
      fiscalPeriodId: periodId.toString(), documentDate: '2042-03-15', description,
      entries: [{ entryNumber: 1, entryDate: '2042-03-15', description, lines: [
        { lineNumber: 1, accountId: debitId.toString(), costCenterId: costCenterId.toString(), currencyId: currencyId.toString(), exchangeRate: '1.00000000', debitAmount: '125.0000', creditAmount: '0.0000' },
        { lineNumber: 2, accountId: creditId.toString(), currencyId: currencyId.toString(), exchangeRate: '1.00000000', debitAmount: '0.0000', creditAmount: '125.0000' },
      ] }],
    };
  }
  function servicePayload(description: string): JournalCreateInput {
    const value = apiPayload(description);
    return { ...value, fiscalPeriodId: periodId, entries: value.entries.map((entry) => ({ ...entry, lines: entry.lines.map((line) => ({ ...line, accountId: BigInt(line.accountId), costCenterId: 'costCenterId' in line ? BigInt(line.costCenterId) : null, currencyId: BigInt(line.currencyId) })) })) };
  }
  async function login(email: string, password: string) {
    const agent = request.agent(app);
    let csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string;
    csrf = (await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf).send({ email, password }).expect(200)).body.csrfToken;
    const companies = await agent.get('/api/v1/auth/companies').expect(200);
    await agent.put('/api/v1/auth/context').set('X-CSRF-Token', csrf).send({ companyId: companies.body.data[0].id }).expect(204);
    return { agent, csrf };
  }
  async function removeYear(id: bigint) {
    await prisma!.journalLine.deleteMany({ where: { companyId, journalEntry: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.journalEntry.updateMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } }, data: { reversalOfJournalEntryId: null } });
    await prisma!.journalEntry.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
    await prisma!.accountingDocument.updateMany({ where: { companyId, fiscalPeriod: { fiscalYearId: id }, status: 'REVERSED' }, data: { status: 'CANCELLED', postedBy: null, postedAt: null, reversedByDocumentId: null } });
    await prisma!.documentPrintArchive.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
    await prisma!.accountingDocument.deleteMany({ where: { companyId, fiscalPeriod: { fiscalYearId: id } } });
    await prisma!.documentSequence.deleteMany({ where: { fiscalYearId: id } });
    await prisma!.fiscalPeriod.deleteMany({ where: { fiscalYearId: id } });
    await prisma!.fiscalYear.delete({ where: { id } });
  }

  beforeAll(async () => {
    const adminUser = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    adminUserId = adminUser.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId: adminUserId, isActive: true } })).companyId;
    currencyId = (await prisma!.company.findUniqueOrThrow({ where: { id: companyId } })).baseCurrencyId;
    const abandonedYear = await prisma!.fiscalYear.findFirst({ where: { companyId, name: 'IT-JRN-2042' } });
    if (abandonedYear) await removeYear(abandonedYear.id);
    const oldMaker = await prisma!.user.findUnique({ where: { emailNormalized: makerEmail } });
    if (oldMaker) {
      await prisma!.idempotencyRecord.deleteMany({ where: { userId: oldMaker.id } });
      await prisma!.auditLog.deleteMany({ where: { actorUserId: oldMaker.id } });
      await prisma!.session.deleteMany({ where: { userId: oldMaker.id } });
      await prisma!.userCompanyRole.deleteMany({ where: { userId: oldMaker.id } });
      await prisma!.userCompany.deleteMany({ where: { userId: oldMaker.id } });
      await prisma!.user.delete({ where: { id: oldMaker.id } });
    }
    const makerUser = await prisma!.user.create({ data: { emailNormalized: makerEmail, displayName: 'منشئ القيود', passwordHash: await hash(makerPassword) } });
    makerId = makerUser.id;
    await prisma!.userCompany.create({ data: { userId: makerId, companyId } });
    const role = await prisma!.role.upsert({ where: { companyId_code: { companyId, code: 'JOURNAL_MAKER_TEST' } }, update: { isActive: true }, create: { companyId, code: 'JOURNAL_MAKER_TEST', nameAr: 'منشئ قيود اختباري' } });
    for (const code of ['manual_journals.view', 'manual_journals.create', 'manual_journals.update', 'manual_journals.cancel', 'manual_journals.post']) {
      const permission = await prisma!.permission.findUniqueOrThrow({ where: { code } });
      await prisma!.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
    }
    await prisma!.userCompanyRole.create({ data: { userId: makerId, companyId, roleId: role.id } });
    const type = await prisma!.accountType.findFirstOrThrow();
    debitId = (await prisma!.account.upsert({ where: { companyId_code: { companyId, code: 'IT-JRN-D' } }, update: { isActive: true, allowsPosting: true }, create: { companyId, accountTypeId: type.id, code: 'IT-JRN-D', nameAr: 'مدين اختباري', level: 1, allowsPosting: true } })).id;
    creditId = (await prisma!.account.upsert({ where: { companyId_code: { companyId, code: 'IT-JRN-C' } }, update: { isActive: true, allowsPosting: true }, create: { companyId, accountTypeId: type.id, code: 'IT-JRN-C', nameAr: 'دائن اختباري', level: 1, allowsPosting: true } })).id;
    costCenterId = (await prisma!.costCenter.upsert({ where: { companyId_code: { companyId, code: 'IT-JRN-CC' } }, update: { isActive: true }, create: { companyId, code: 'IT-JRN-CC', nameAr: 'مركز قيد اختباري' } })).id;
    const oldYear = await prisma!.fiscalYear.findFirst({ where: { companyId, name: 'IT-JRN-2042' } });
    if (oldYear) await removeYear(oldYear.id);
    const year = await prisma!.fiscalYear.create({ data: { companyId, name: 'IT-JRN-2042', startDate: new Date('2042-01-01'), endDate: new Date('2042-12-31'), periods: { create: [{ periodNumber: 1, name: '2042', startDate: new Date('2042-01-01'), endDate: new Date('2042-12-31') }] } }, include: { periods: true } });
    yearId = year.id; periodId = year.periods[0]!.id;
    service = new ManualJournalService(prisma!);
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, journals: service });
    ({ agent: admin, csrf: adminCsrf } = await login('admin@mcap.local', adminPassword));
    ({ agent: maker, csrf: makerCsrf } = await login(makerEmail, makerPassword));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ['POST_MANUAL_JOURNAL', 'REVERSE_MANUAL_JOURNAL'] } } });
    await prisma.auditLog.deleteMany({ where: { companyId, entityType: 'MANUAL_JOURNAL' } });
    if (yearId) await removeYear(yearId);
    if (debitId && creditId) await prisma.account.deleteMany({ where: { id: { in: [debitId, creditId] } } });
    if (costCenterId) await prisma.costCenter.delete({ where: { id: costCenterId } });
    if (makerId) {
      await prisma.session.deleteMany({ where: { userId: makerId } });
      await prisma.userCompanyRole.deleteMany({ where: { userId: makerId } });
      await prisma.userCompany.deleteMany({ where: { userId: makerId } });
      await prisma.user.delete({ where: { id: makerId } });
    }
    await prisma.$disconnect();
  });

  it('creates, validates, updates and cancels a draft', async () => {
    const invalid = apiPayload('IT-JRN سعر صرف غير صالح'); invalid.entries[0]!.lines[0]!.exchangeRate = '2.00000000';
    await maker.post('/api/v1/manual-journals').set('X-CSRF-Token', makerCsrf).send(invalid).expect(422);
    const created = await maker.post('/api/v1/manual-journals').set('X-CSRF-Token', makerCsrf).send(apiPayload()).expect(201);
    expect(created.body.entries[0].lines[0].baseDebitAmount).toBe('125.0000');
    const replacement = apiPayload('IT-JRN وصف محدث');
    replacement.entries[0]!.lines[0]!.debitAmount = '130.0000';
    replacement.entries[0]!.lines[1]!.creditAmount = '130.0000';
    const updated = await maker.patch(`/api/v1/manual-journals/${created.body.document.id}`).set('X-CSRF-Token', makerCsrf).send({ version: 0, description: replacement.description, entries: replacement.entries }).expect(200);
    expect(updated.body.document.version).toBe(1);
    expect(updated.body.entries[0].lines[0].debitAmount).toBe('130.0000');
    await maker.patch(`/api/v1/manual-journals/${created.body.document.id}`).set('X-CSRF-Token', makerCsrf).send({ version: 0, description: 'قديم' }).expect(409);
    await maker.post(`/api/v1/manual-journals/${created.body.document.id}/cancel`).set('X-CSRF-Token', makerCsrf).send({ version: 1, reason: 'إلغاء مسودة الاختبار' }).expect(200);
  });

  it('enforces maker-checker, balance, idempotent posting and reversal', async () => {
    const unbalanced = apiPayload('IT-JRN غير متوازن'); unbalanced.entries[0]!.lines[1]!.creditAmount = '120.0000';
    const bad = await maker.post('/api/v1/manual-journals').set('X-CSRF-Token', makerCsrf).send(unbalanced).expect(201);
    await admin.post(`/api/v1/manual-journals/${bad.body.document.id}/post`).set('X-CSRF-Token', adminCsrf).set('Idempotency-Key', 'post-unbalanced-journal').send({ version: 0 }).expect(422);
    const created = await maker.post('/api/v1/manual-journals').set('X-CSRF-Token', makerCsrf).send(apiPayload('IT-JRN للترحيل')).expect(201);
    await maker.post(`/api/v1/manual-journals/${created.body.document.id}/post`).set('X-CSRF-Token', makerCsrf).set('Idempotency-Key', 'maker-cannot-post').send({ version: 0 }).expect(422);
    const postUrl = `/api/v1/manual-journals/${created.body.document.id}/post`;
    const [posted, replay] = await Promise.all([
      admin.post(postUrl).set('X-CSRF-Token', adminCsrf).set('Idempotency-Key', 'post-balanced-journal').send({ version: 0 }).expect(200),
      admin.post(postUrl).set('X-CSRF-Token', adminCsrf).set('Idempotency-Key', 'post-balanced-journal').send({ version: 0 }).expect(200),
    ]);
    expect(replay.body).toEqual(posted.body);
    const reversed = await admin.post(`/api/v1/manual-journals/${created.body.document.id}/reverse`).set('X-CSRF-Token', adminCsrf).set('Idempotency-Key', 'reverse-balanced-journal').send({ version: 1, reversalDate: '2042-04-01', reason: 'عكس قيد الاختبار' }).expect(200);
    expect(reversed.body.document.status).toBe('REVERSED');
    const reversal = await prisma!.accountingDocument.findUniqueOrThrow({ where: { id: BigInt(reversed.body.document.reversedByDocumentId) }, include: { journalEntries: { include: { lines: true } } } });
    expect(reversal.journalEntries[0]!.lines[0]!.creditAmount.toFixed(4)).toBe('125.0000');
  });

  it('reserves unique numbers concurrently and isolates companies', async () => {
    const created = await Promise.all(Array.from({ length: 6 }, (_, index) => service.create({ userId: makerId, companyId }, servicePayload(`IT-JRN متزامن ${index}`))));
    expect(new Set(created.map((value) => value.documentNumber)).size).toBe(6);
    const base = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    const foreignCompany = await prisma!.company.create({ data: { organizationId: base.organizationId, baseCurrencyId: base.baseCurrencyId, name: 'IT-JRN شركة عزل', timezone: 'Asia/Riyadh' } });
    const foreignYear = await prisma!.fiscalYear.create({ data: { companyId: foreignCompany.id, name: 'IT-JRN-F-2042', startDate: new Date('2042-01-01'), endDate: new Date('2042-12-31'), periods: { create: [{ periodNumber: 1, name: '2042', startDate: new Date('2042-01-01'), endDate: new Date('2042-12-31') }] } }, include: { periods: true } });
    const foreignDocument = await prisma!.accountingDocument.create({ data: { companyId: foreignCompany.id, fiscalPeriodId: foreignYear.periods[0]!.id, documentType: 'MANUAL_JOURNAL', documentNumber: 'FOREIGN-1', documentDate: new Date('2042-01-01'), description: 'IT-JRN أجنبي', createdBy: adminUserId } });
    try { await admin.get(`/api/v1/manual-journals/${foreignDocument.id}`).expect(404); }
    finally { await prisma!.accountingDocument.delete({ where: { id: foreignDocument.id } }); await prisma!.fiscalPeriod.deleteMany({ where: { fiscalYearId: foreignYear.id } }); await prisma!.fiscalYear.delete({ where: { id: foreignYear.id } }); await prisma!.company.delete({ where: { id: foreignCompany.id } }); }
  });
});
