import { verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/auth-service.js';
import { PrismaAuthStore } from '../src/auth/prisma-auth-store.js';
import { createDatabase } from '../src/database.js';
import { FiscalError, FiscalService } from '../src/fiscal/fiscal-service.js';

const enabled = process.env.RUN_DB_TESTS === 'true';
const databaseUrl = process.env.DATABASE_URL ?? '';
const password = process.env.SEED_ADMIN_PASSWORD ?? '';
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)('fiscal periods and document sequences with MariaDB', () => {
  let fiscal: FiscalService;
  let app: ReturnType<typeof createApp>;
  let companyId: bigint;
  let userId: bigint;
  let debitAccountId: bigint;
  let creditAccountId: bigint;

  async function deleteCompanyDocuments() {
    await prisma!.receiptAllocation.deleteMany({ where: { companyId } });
    await prisma!.paymentAllocation.deleteMany({ where: { companyId } });
    await prisma!.receipt.deleteMany({ where: { companyId } });
    await prisma!.payment.deleteMany({ where: { companyId } });
    await prisma!.receivableItem.deleteMany({ where: { companyId } });
    await prisma!.payableItem.deleteMany({ where: { companyId } });
    await prisma!.salesInvoice.updateMany({ where: { companyId }, data: { arJournalLineId: null } });
    await prisma!.purchaseInvoice.updateMany({ where: { companyId }, data: { apJournalLineId: null } });
    await prisma!.journalLine.deleteMany({ where: { companyId } });
    await prisma!.journalEntry.updateMany({ where: { companyId }, data: { reversalOfJournalEntryId: null } });
    await prisma!.journalEntry.deleteMany({ where: { companyId } });
    await prisma!.salesInvoiceLine.deleteMany({ where: { companyId } });
    await prisma!.salesInvoice.deleteMany({ where: { companyId, sourceInvoiceId: { not: null } } });
    await prisma!.salesInvoice.deleteMany({ where: { companyId } });
    await prisma!.purchaseInvoiceLine.deleteMany({ where: { companyId } });
    await prisma!.purchaseInvoice.deleteMany({ where: { companyId, sourceInvoiceId: { not: null } } });
    await prisma!.purchaseInvoice.deleteMany({ where: { companyId } });
    await prisma!.documentPrintArchive.deleteMany({ where: { companyId } });
    await prisma!.accountingDocument.updateMany({ where: { companyId }, data: { reversedByDocumentId: null } });
    await prisma!.accountingDocument.deleteMany({ where: { companyId } });
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: 'admin@mcap.local' } });
    const assignment = await prisma!.userCompany.findFirstOrThrow({ where: { userId: user.id, isActive: true } });
    userId = user.id; companyId = assignment.companyId;
    await prisma!.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ['CLOSE_PERIOD', 'REOPEN_PERIOD'] } } });
    await deleteCompanyDocuments();
    await prisma!.documentSequence.deleteMany({ where: { companyId } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId } });
    await prisma!.fiscalYear.deleteMany({ where: { companyId } });
    const accountType = await prisma!.accountType.findFirstOrThrow();
    await prisma!.account.deleteMany({ where: { companyId, code: { in: ['FISCAL-TEST-D', 'FISCAL-TEST-C'] } } });
    const debitAccount = await prisma!.account.create({ data: { companyId, accountTypeId: accountType.id, code: 'FISCAL-TEST-D', nameAr: 'حساب مدين اختباري', level: 1, allowsPosting: true } });
    const creditAccount = await prisma!.account.create({ data: { companyId, accountTypeId: accountType.id, code: 'FISCAL-TEST-C', nameAr: 'حساب دائن اختباري', level: 1, allowsPosting: true } });
    debitAccountId = debitAccount.id; creditAccountId = creditAccount.id;
    fiscal = new FiscalService(prisma!);
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    app = createApp({ NODE_ENV: 'test', PORT: 3000, WEB_ORIGIN: 'http://localhost:5173', SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, fiscal });
  });

  afterAll(async () => {
    await prisma!.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ['CLOSE_PERIOD', 'REOPEN_PERIOD'] } } });
    await deleteCompanyDocuments();
    await prisma!.documentSequence.deleteMany({ where: { companyId } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId } });
    await prisma!.fiscalYear.deleteMany({ where: { companyId } });
    await prisma!.account.deleteMany({ where: { id: { in: [debitAccountId, creditAccountId] } } });
    await prisma!.$disconnect();
  });

  it('enforces overlap, chronological close/reopen, idempotency and date locking', async () => {
    const agent = request.agent(app);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const login = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf.body.csrfToken).send({ email: 'admin@mcap.local', password }).expect(200);
    const companies = await agent.get('/api/v1/auth/companies').expect(200);
    await agent.put('/api/v1/auth/context').set('X-CSRF-Token', login.body.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);

    const created = await agent.post('/api/v1/fiscal-years').set('X-CSRF-Token', login.body.csrfToken).send({
      name: 'السنة الاختبارية 2031', startDate: '2031-01-01', endDate: '2031-12-31',
      periods: [
        { periodNumber: 1, name: 'النصف الأول', startDate: '2031-01-01', endDate: '2031-06-30' },
        { periodNumber: 2, name: 'النصف الثاني', startDate: '2031-07-01', endDate: '2031-12-31' },
      ],
    }).expect(201);
    let [first, second] = created.body.periods;
    const listed = await agent.get('/api/v1/fiscal-years?page=1&pageSize=25').expect(200);
    const listedYear = listed.body.data.find((year: { id: string }) => year.id === created.body.id);
    expect(listedYear.periods.map((period: { periodNumber: number }) => period.periodNumber)).toEqual([1, 2]);
    await agent.post('/api/v1/fiscal-years').set('X-CSRF-Token', login.body.csrfToken).send({ name: 'متداخلة', startDate: '2031-06-01', endDate: '2032-05-31', periods: [{ periodNumber: 1, name: 'فترة', startDate: '2031-06-01', endDate: '2032-05-31' }] }).expect(422);
    const renamed = await agent.patch(`/api/v1/fiscal-periods/${first.id}`).set('X-CSRF-Token', login.body.csrfToken).send({ version: 0, name: 'النصف الأول المحدث' }).expect(200);
    first = renamed.body;
    await agent.patch(`/api/v1/fiscal-periods/${first.id}`).set('X-CSRF-Token', login.body.csrfToken).send({ version: 0, name: 'تعديل بإصدار قديم' }).expect(409);
    await agent.patch(`/api/v1/fiscal-periods/${second.id}`).set('X-CSRF-Token', login.body.csrfToken).send({ version: 0, startDate: '2031-06-15' }).expect(422);
    await agent.post(`/api/v1/fiscal-periods/${second.id}/close`).set('X-CSRF-Token', login.body.csrfToken).set('Idempotency-Key', 'close-second-too-early').send({ version: 0, reviewConfirmed: true }).expect(422);

    const numbers = await Promise.all(Array.from({ length: 10 }, () => fiscal.reserveDocumentNumber({ userId, companyId }, BigInt(created.body.id), 'MANUAL_JOURNAL')));
    expect(new Set(numbers).size).toBe(10);
    expect(numbers.sort()[0]).toBe('20310101-20311231-000001');
    await agent.patch(`/api/v1/fiscal-years/${created.body.id}`).set('X-CSRF-Token', login.body.csrfToken).send({ startDate: '2031-01-02' }).expect(422);

    const company = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    const draft = await prisma!.accountingDocument.create({ data: { companyId, fiscalPeriodId: BigInt(first.id), documentType: 'MANUAL_JOURNAL', documentNumber: 'TEST-DRAFT-1', documentDate: new Date('2031-02-01T00:00:00.000Z'), description: 'مسودة تمنع الإغلاق', createdBy: userId } });
    await agent.post(`/api/v1/fiscal-periods/${first.id}/close`).set('X-CSRF-Token', login.body.csrfToken).set('Idempotency-Key', 'close-with-draft-2031').send({ version: first.version, reviewConfirmed: true }).expect(422);
    await prisma!.accountingDocument.update({ where: { id: draft.id }, data: { status: 'CANCELLED' } });

    const posted = await prisma!.accountingDocument.create({ data: { companyId, fiscalPeriodId: BigInt(first.id), documentType: 'MANUAL_JOURNAL', documentNumber: 'TEST-POSTED-1', documentDate: new Date('2031-02-02T00:00:00.000Z'), description: 'قيد مصالحة اختباري', status: 'POSTED', createdBy: userId, postedBy: userId, postedAt: new Date() } });
    const entry = await prisma!.journalEntry.create({ data: { companyId, accountingDocumentId: posted.id, entryNumber: 1, entryDate: new Date('2031-02-02T00:00:00.000Z'), description: 'قيد غير متوازن أولاً' } });
    await prisma!.journalLine.createMany({ data: [
      { companyId, journalEntryId: entry.id, lineNumber: 1, accountId: debitAccountId, currencyId: company.baseCurrencyId, exchangeRate: '1.00000000', debitAmount: '100.0000', creditAmount: '0.0000', baseDebitAmount: '100.0000', baseCreditAmount: '0.0000' },
      { companyId, journalEntryId: entry.id, lineNumber: 2, accountId: creditAccountId, currencyId: company.baseCurrencyId, exchangeRate: '1.00000000', debitAmount: '0.0000', creditAmount: '90.0000', baseDebitAmount: '0.0000', baseCreditAmount: '90.0000' },
    ] });
    await agent.post(`/api/v1/fiscal-periods/${first.id}/close`).set('X-CSRF-Token', login.body.csrfToken).set('Idempotency-Key', 'close-unbalanced-2031').send({ version: first.version, reviewConfirmed: true }).expect(422);
    await prisma!.journalLine.update({ where: { journalEntryId_lineNumber: { journalEntryId: entry.id, lineNumber: 2 } }, data: { creditAmount: '100.0000', baseCreditAmount: '100.0000' } });

    const closedFirst = await agent.post(`/api/v1/fiscal-periods/${first.id}/close`).set('X-CSRF-Token', login.body.csrfToken).set('Idempotency-Key', 'close-first-period-2031').send({ version: first.version, reviewConfirmed: true }).expect(200);
    const replay = await agent.post(`/api/v1/fiscal-periods/${first.id}/close`).set('X-CSRF-Token', login.body.csrfToken).set('Idempotency-Key', 'close-first-period-2031').send({ version: first.version, reviewConfirmed: true }).expect(200);
    expect(replay.body).toEqual(closedFirst.body);
    await agent.post(`/api/v1/fiscal-periods/${second.id}/close`).set('X-CSRF-Token', login.body.csrfToken).set('Idempotency-Key', 'close-second-requires-document').send({ version: 0, reviewConfirmed: true, requirePeriodCloseDocument: true }).expect(422);
    const closedSecond = await agent.post(`/api/v1/fiscal-periods/${second.id}/close`).set('X-CSRF-Token', login.body.csrfToken).set('Idempotency-Key', 'close-second-period-2031').send({ version: 0, reviewConfirmed: true }).expect(200);
    await agent.post(`/api/v1/fiscal-periods/${first.id}/reopen`).set('X-CSRF-Token', login.body.csrfToken).set('Idempotency-Key', 'reopen-first-too-early').send({ version: closedFirst.body.period.version, reason: 'سبب اختبار يمنع الترتيب' }).expect(422);
    await agent.post(`/api/v1/fiscal-periods/${second.id}/reopen`).set('X-CSRF-Token', login.body.csrfToken).set('Idempotency-Key', 'reopen-second-period-2031').send({ version: closedSecond.body.period.version, reason: 'إعادة فتح موثقة للاختبار' }).expect(200);
  });

  it('replays a concurrent idempotent close and prevents cross-company access', async () => {
    const baseCompany = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    const otherCompany = await prisma!.company.create({ data: { organizationId: baseCompany.organizationId, baseCurrencyId: baseCompany.baseCurrencyId, name: 'شركة Fiscal للعزل', timezone: 'Asia/Riyadh' } });
    const otherContext = { userId, companyId: otherCompany.id };
    try {
      const year = await fiscal.createYear(otherContext, { name: 'سنة عزل 2040', startDate: '2040-01-01', endDate: '2040-12-31', periods: [{ periodNumber: 1, name: 'السنة كاملة', startDate: '2040-01-01', endDate: '2040-12-31' }] });
      await expect(fiscal.getYear({ userId, companyId }, year.id)).rejects.toEqual(new FiscalError('NOT_FOUND'));
      const command = { version: 0, reviewConfirmed: true as const, idempotencyKey: 'concurrent-close-other-company' };
      const results = await Promise.all([fiscal.closePeriod(otherContext, year.periods[0]!.id, command), fiscal.closePeriod(otherContext, year.periods[0]!.id, command)]);
      expect(results[0]).toEqual(results[1]);
    } finally {
      await prisma!.idempotencyRecord.deleteMany({ where: { companyId: otherCompany.id } });
      await prisma!.auditLog.deleteMany({ where: { companyId: otherCompany.id } });
      await prisma!.fiscalPeriod.deleteMany({ where: { companyId: otherCompany.id } });
      await prisma!.fiscalYear.deleteMany({ where: { companyId: otherCompany.id } });
      await prisma!.company.delete({ where: { id: otherCompany.id } });
    }
  });
});
