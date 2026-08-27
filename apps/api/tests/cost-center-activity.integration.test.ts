import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { parseOpenApiResponseBody } from "../src/generated/openapi-request-guards.js";
import { PrismaCostCenterActivityLedgerQueryAdapter } from "../src/reports/adapters/prisma-cost-center-activity-ledger-query-adapter.js";
import { CostCenterActivityError, CostCenterActivityService } from "../src/reports/cost-center-activity-service.js";
import { ReportService } from "../src/reports/report-service.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("cost-center activity report with MariaDB", () => {
  let service: CostCenterActivityService;
  let reportService: ReportService;
  let userId: bigint;
  let companyId: bigint;
  let foreignCompanyId: bigint;
  let expenseAccountId: bigint;
  let centerOneId: bigint;
  let centerTwoId: bigint;
  let foreignCenterId: bigint;

  async function cleanupCompany(targetCompanyId: bigint) {
    await prisma!.auditLog.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.journalLine.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.journalEntry.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.accountingDocument.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.costCenter.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.fiscalYear.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.account.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.companyCurrency.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.company.delete({ where: { id: targetCompanyId } });
  }

  async function createFixture(name: string) {
    const assignment = await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true }, include: { company: true } });
    const company = await prisma!.company.create({ data: { organizationId: assignment.company.organizationId, baseCurrencyId: assignment.company.baseCurrencyId, name, timezone: "Asia/Riyadh" } });
    await prisma!.companyCurrency.create({ data: { companyId: company.id, currencyId: company.baseCurrencyId, isActive: true } });
    const [expenseType, equityType] = await Promise.all([
      prisma!.accountType.findUniqueOrThrow({ where: { code: "EXPENSE" } }),
      prisma!.accountType.findUniqueOrThrow({ where: { code: "EQUITY" } }),
    ]);
    const [expense, offset] = await Promise.all([
      prisma!.account.create({ data: { companyId: company.id, accountTypeId: expenseType.id, code: "5100", nameAr: "مصروف الاختبار", nameEn: "Test expense", level: 1, allowsPosting: true } }),
      prisma!.account.create({ data: { companyId: company.id, accountTypeId: equityType.id, code: "3100", nameAr: "حساب مقابل", nameEn: "Offset", level: 1, allowsPosting: true } }),
    ]);
    const [centerOne, centerTwo] = await Promise.all([
      prisma!.costCenter.create({ data: { companyId: company.id, code: "CC-001", nameAr: "المشروع الأول", nameEn: "Project one" } }),
      prisma!.costCenter.create({ data: { companyId: company.id, code: "CC-002", nameAr: "المشروع الثاني", nameEn: "Project two" } }),
    ]);
    const year = await prisma!.fiscalYear.create({ data: { companyId: company.id, name: "سنة تقرير مراكز التكلفة", startDate: new Date("2059-01-01T00:00:00.000Z"), endDate: new Date("2059-12-31T00:00:00.000Z"), periods: { create: { periodNumber: 1, name: "الفترة", startDate: new Date("2059-01-01T00:00:00.000Z"), endDate: new Date("2059-12-31T00:00:00.000Z") } } }, include: { periods: true } });
    return { company, expense, offset, centerOne, centerTwo, periodId: year.periods[0]!.id };
  }

  async function createDocument(fixture: Awaited<ReturnType<typeof createFixture>>, number: string, date: string, amount: string, costCenterId: bigint, status: "POSTED" | "DRAFT" = "POSTED") {
    const document = await prisma!.accountingDocument.create({ data: { companyId: fixture.company.id, fiscalPeriodId: fixture.periodId, documentType: "MANUAL_JOURNAL", documentNumber: number, documentDate: new Date(`${date}T00:00:00.000Z`), description: "قيد تقرير مراكز التكلفة", status, createdBy: userId, ...(status === "POSTED" ? { postedBy: userId, postedAt: new Date() } : {}) } });
    const entry = await prisma!.journalEntry.create({ data: { companyId: fixture.company.id, accountingDocumentId: document.id, entryNumber: 1, entryDate: document.documentDate, description: document.description } });
    await prisma!.journalLine.createMany({ data: [
      { companyId: fixture.company.id, journalEntryId: entry.id, lineNumber: 1, accountId: fixture.expense.id, costCenterId, currencyId: fixture.company.baseCurrencyId, exchangeRate: "1.00000000", debitAmount: amount, creditAmount: "0.0000", baseDebitAmount: amount, baseCreditAmount: "0.0000" },
      { companyId: fixture.company.id, journalEntryId: entry.id, lineNumber: 2, accountId: fixture.offset.id, currencyId: fixture.company.baseCurrencyId, exchangeRate: "1.00000000", debitAmount: "0.0000", creditAmount: amount, baseDebitAmount: "0.0000", baseCreditAmount: amount },
    ] });
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = user.id;
    const leaked = await prisma!.company.findMany({ where: { name: { startsWith: "COST-CENTER-REPORT-IT-" } }, select: { id: true } });
    for (const company of leaked) await cleanupCompany(company.id);
    const fixture = await createFixture(`COST-CENTER-REPORT-IT-${Date.now()}`);
    companyId = fixture.company.id;
    expenseAccountId = fixture.expense.id;
    centerOneId = fixture.centerOne.id;
    centerTwoId = fixture.centerTwo.id;
    await createDocument(fixture, "CC-ACT-1", "2059-03-05", "0.1000", centerOneId);
    await createDocument(fixture, "CC-ACT-2", "2059-03-06", "0.2000", centerOneId);
    await createDocument(fixture, "CC-ACT-3", "2059-03-07", "12.3456", centerTwoId);
    await createDocument(fixture, "CC-ACT-DRAFT", "2059-03-08", "999.0000", centerOneId, "DRAFT");
    const foreign = await createFixture(`COST-CENTER-REPORT-IT-FOREIGN-${Date.now()}`);
    foreignCompanyId = foreign.company.id;
    foreignCenterId = foreign.centerOne.id;
    await createDocument(foreign, "CC-ACT-FOREIGN", "2059-03-05", "1000.0000", foreignCenterId);
    service = new CostCenterActivityService(prisma!, new PrismaCostCenterActivityLedgerQueryAdapter());
    reportService = new ReportService(prisma!);
  });

  afterAll(async () => {
    if (!prisma) return;
    if (foreignCompanyId) await cleanupCompany(foreignCompanyId);
    if (companyId) await cleanupCompany(companyId);
    await prisma.$disconnect();
  });

  it("groups actual ledger movement with Decimal totals and excludes drafts and other companies", async () => {
    const report = await service.activity({ companyId, userId }, { dateFrom: "2059-03-01", dateTo: "2059-03-31" });
    expect(report.totals).toEqual({ costCenterCount: 2, accountCount: 1, movementLineCount: 3, debit: "12.6456", credit: "0.0000", net: "12.6456" });
    expect(report.data[0]).toMatchObject({ costCenter: { id: centerOneId.toString() }, accounts: [{ debit: "0.3000", movementLineCount: 2 }] });
    expect(report.data.some((row) => row.totals.debit === "1000.0000")).toBe(false);
    expect(() => parseOpenApiResponseBody("getCostCenterActivity", 200, report)).not.toThrow();
  });

  it("keeps both report and ledger drill-down filters inside the current company", async () => {
    const filtered = await service.activity({ companyId, userId }, { dateFrom: "2059-03-01", dateTo: "2059-03-31", costCenterId: centerOneId });
    expect(filtered.data).toHaveLength(1);
    expect(filtered.totals.debit).toBe("0.3000");
    await expect(service.activity({ companyId, userId }, { dateFrom: "2059-03-01", dateTo: "2059-03-31", costCenterId: foreignCenterId })).rejects.toEqual(new CostCenterActivityError("NOT_FOUND"));

    const ledger = await reportService.ledger({ companyId, userId }, { accountId: expenseAccountId, costCenterId: centerOneId, dateFrom: "2059-03-01", dateTo: "2059-03-31", page: 1, pageSize: 25 });
    expect(ledger.costCenter?.id).toBe(centerOneId.toString());
    expect(ledger.data).toHaveLength(2);
    expect(ledger.closingDebit).toBe("0.3000");
  });
});
