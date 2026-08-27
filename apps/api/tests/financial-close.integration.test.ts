import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompanyCurrencyFinancialCloseReadinessAdapter } from "../src/companies/financial-close-readiness-adapter.js";
import { createDatabase } from "../src/database.js";
import { FinancialCloseError, FinancialCloseService } from "../src/fiscal/financial-close-service.js";
import { parseOpenApiResponseBody } from "../src/generated/openapi-request-guards.js";
import { InventoryFinancialCloseReadinessAdapter } from "../src/inventory/financial-close-readiness-adapter.js";
import { SettlementFinancialCloseReadinessAdapter } from "../src/reports/financial-close-readiness-adapter.js";
import { TreasuryFinancialCloseReadinessAdapter } from "../src/treasury/financial-close-readiness-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("reviewed financial close workflow with MariaDB", () => {
  let service: FinancialCloseService;
  let companyId: bigint;
  let userId: bigint;
  let periodId: bigint;
  let assetAccountId: bigint;
  let revenueAccountId: bigint;
  let expenseAccountId: bigint;
  let retainedAccountId: bigint;
  let baseCurrencyId: bigint;

  const context = () => ({ companyId, userId });

  async function cleanupCompany(targetCompanyId: bigint) {
    await prisma!.idempotencyRecord.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.auditLog.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.financialCloseRun.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.journalLine.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.journalEntry.updateMany({ where: { companyId: targetCompanyId }, data: { reversalOfJournalEntryId: null } });
    await prisma!.journalEntry.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.accountingDocument.updateMany({
      where: { companyId: targetCompanyId, status: "REVERSED" },
      data: { status: "CANCELLED", postedBy: null, postedAt: null, reversedByDocumentId: null },
    });
    await prisma!.accountingDocument.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.documentSequence.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.fiscalYear.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.account.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.companyCurrency.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.company.delete({ where: { id: targetCompanyId } });
  }

  async function createPostedDocument(number: string, revenue: string, expense: string) {
    const document = await prisma!.accountingDocument.create({
      data: {
        companyId,
        fiscalPeriodId: periodId,
        documentType: "MANUAL_JOURNAL",
        documentNumber: number,
        documentDate: new Date("2056-06-30T00:00:00.000Z"),
        description: "قيد نتيجة اصطناعي لاختبار الإقفال",
        status: "POSTED",
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      },
    });
    const entry = await prisma!.journalEntry.create({
      data: {
        companyId,
        accountingDocumentId: document.id,
        entryNumber: 1,
        entryDate: document.documentDate,
        description: document.description,
      },
    });
    const lines = [
      { companyId, journalEntryId: entry.id, lineNumber: 1, accountId: assetAccountId, currencyId: baseCurrencyId, exchangeRate: "1.00000000", debitAmount: revenue, creditAmount: "0.0000", baseDebitAmount: revenue, baseCreditAmount: "0.0000" },
      { companyId, journalEntryId: entry.id, lineNumber: 2, accountId: revenueAccountId, currencyId: baseCurrencyId, exchangeRate: "1.00000000", debitAmount: "0.0000", creditAmount: revenue, baseDebitAmount: "0.0000", baseCreditAmount: revenue },
      ...(Number(expense) > 0 ? [
        { companyId, journalEntryId: entry.id, lineNumber: 3, accountId: expenseAccountId, currencyId: baseCurrencyId, exchangeRate: "1.00000000", debitAmount: expense, creditAmount: "0.0000", baseDebitAmount: expense, baseCreditAmount: "0.0000" },
        { companyId, journalEntryId: entry.id, lineNumber: 4, accountId: assetAccountId, currencyId: baseCurrencyId, exchangeRate: "1.00000000", debitAmount: "0.0000", creditAmount: expense, baseDebitAmount: "0.0000", baseCreditAmount: expense },
      ] : []),
    ];
    await prisma!.journalLine.createMany({ data: lines });
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    const assignment = await prisma!.userCompany.findFirstOrThrow({ where: { userId: user.id, isActive: true } });
    const seedCompany = await prisma!.company.findUniqueOrThrow({ where: { id: assignment.companyId } });
    const leakedCompanies = await prisma!.company.findMany({ where: { name: { startsWith: "FINANCIAL-CLOSE-IT-" } }, select: { id: true } });
    for (const leaked of leakedCompanies) await cleanupCompany(leaked.id);
    userId = user.id;
    baseCurrencyId = seedCompany.baseCurrencyId;
    const company = await prisma!.company.create({
      data: {
        organizationId: seedCompany.organizationId,
        baseCurrencyId,
        name: `FINANCIAL-CLOSE-IT-${Date.now()}`,
        timezone: "Asia/Riyadh",
      },
    });
    companyId = company.id;
    await prisma!.companyCurrency.create({ data: { companyId, currencyId: baseCurrencyId, isActive: true } });
    const [assetType, revenueType, expenseType, equityType] = await Promise.all([
      prisma!.accountType.findUniqueOrThrow({ where: { code: "ASSET" } }),
      prisma!.accountType.findUniqueOrThrow({ where: { code: "REVENUE" } }),
      prisma!.accountType.findUniqueOrThrow({ where: { code: "EXPENSE" } }),
      prisma!.accountType.findUniqueOrThrow({ where: { code: "EQUITY" } }),
    ]);
    const accounts = await Promise.all([
      prisma!.account.create({ data: { companyId, accountTypeId: assetType.id, code: "1100", nameAr: "أصل اختبار الإقفال", level: 1, allowsPosting: true } }),
      prisma!.account.create({ data: { companyId, accountTypeId: revenueType.id, code: "4100", nameAr: "إيراد اختبار الإقفال", level: 1, allowsPosting: true } }),
      prisma!.account.create({ data: { companyId, accountTypeId: expenseType.id, code: "5100", nameAr: "مصروف اختبار الإقفال", level: 1, allowsPosting: true } }),
      prisma!.account.create({ data: { companyId, accountTypeId: equityType.id, code: "3300", nameAr: "الأرباح المبقاة", level: 1, allowsPosting: true } }),
    ]);
    assetAccountId = accounts[0]!.id;
    revenueAccountId = accounts[1]!.id;
    expenseAccountId = accounts[2]!.id;
    retainedAccountId = accounts[3]!.id;
    const year = await prisma!.fiscalYear.create({
      data: {
        companyId,
        name: "سنة اختبار الإقفال 2056",
        startDate: new Date("2056-01-01T00:00:00.000Z"),
        endDate: new Date("2056-12-31T00:00:00.000Z"),
        periods: { create: { periodNumber: 1, name: "السنة كاملة", startDate: new Date("2056-01-01T00:00:00.000Z"), endDate: new Date("2056-12-31T00:00:00.000Z") } },
      },
      include: { periods: true },
    });
    periodId = year.periods[0]!.id;
    service = new FinancialCloseService(prisma!, {
      treasury: new TreasuryFinancialCloseReadinessAdapter(),
      inventory: new InventoryFinancialCloseReadinessAdapter(),
      currencies: new CompanyCurrencyFinancialCloseReadinessAdapter(),
      settlements: new SettlementFinancialCloseReadinessAdapter(),
    });
    await createPostedDocument("FC-IT-001", "200.0000", "70.0000");
  });

  afterAll(async () => {
    if (!prisma || !companyId) return;
    await cleanupCompany(companyId);
    await prisma.$disconnect();
  });

  it("requires a stable reviewed snapshot, closes annual results, and reverses the close on reopen", async () => {
    const readiness = await service.readiness(context(), periodId);
    expect(readiness).toMatchObject({ ready: true, isYearEnd: true, periodVersion: 0 });
    expect(readiness.items.every((item) => item.status === "PASS")).toBe(true);
    expect(() => parseOpenApiResponseBody("getFinancialCloseReadiness", 200, readiness)).not.toThrow();

    const [started, replayed] = await Promise.all([
      service.startRun(context(), periodId, { periodVersion: 0, idempotencyKey: "fc-start-concurrent" }),
      service.startRun(context(), periodId, { periodVersion: 0, idempotencyKey: "fc-start-concurrent" }),
    ]);
    expect(replayed).toEqual(started);
    expect(started.run.status).toBe("PREPARING");
    expect(() => parseOpenApiResponseBody("startFinancialCloseRun", 201, started)).not.toThrow();

    let reviewed = await service.reviewRun(context(), started.run.id, { version: started.run.version, idempotencyKey: "fc-review-first" });
    expect(reviewed.run.status).toBe("REVIEWED");
    expect(reviewed.run.closePackHashSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => parseOpenApiResponseBody("reviewFinancialCloseRun", 200, reviewed)).not.toThrow();

    await createPostedDocument("FC-IT-002", "20.0000", "0.0000");
    await expect(service.closePeriod(context(), periodId, {
      periodVersion: 0,
      closeRunId: reviewed.run.id,
      closeRunVersion: reviewed.run.version,
      idempotencyKey: "fc-close-stale",
    })).rejects.toEqual(new FinancialCloseError("CHECKLIST_CHANGED"));

    const returned = await service.returnRun(context(), reviewed.run.id, {
      version: reviewed.run.version,
      reason: "تغيرت بيانات الإيراد بعد المراجعة",
      idempotencyKey: "fc-return-after-change",
    });
    reviewed = await service.reviewRun(context(), returned.run.id, {
      version: returned.run.version,
      idempotencyKey: "fc-review-second",
    });
    const closed = await service.closePeriod(context(), periodId, {
      periodVersion: 0,
      closeRunId: reviewed.run.id,
      closeRunVersion: reviewed.run.version,
      idempotencyKey: "fc-close-final",
    });
    expect(closed.period.status).toBe("CLOSED");
    expect(closed.closeRun).toMatchObject({ status: "CLOSED", closeDocumentId: expect.any(String) });
    expect(() => parseOpenApiResponseBody("closeFiscalPeriod", 200, closed)).not.toThrow();

    const closeDocument = await prisma!.accountingDocument.findUniqueOrThrow({
      where: { id: BigInt(closed.closeRun.closeDocumentId!) },
      include: { journalEntries: { include: { lines: true } } },
    });
    expect(closeDocument).toMatchObject({ documentType: "PERIOD_CLOSE", status: "POSTED" });
    const retainedLine = closeDocument.journalEntries.flatMap((entry) => entry.lines).find((line) => line.accountId === retainedAccountId);
    expect(retainedLine?.baseCreditAmount.toFixed(4)).toBe("150.0000");

    const resultBalances = await prisma!.journalLine.groupBy({
      by: ["accountId"],
      where: { companyId, accountId: { in: [revenueAccountId, expenseAccountId] } },
      _sum: { baseDebitAmount: true, baseCreditAmount: true },
      orderBy: { accountId: "asc" },
    });
    expect(resultBalances.every((row) => row._sum.baseDebitAmount?.equals(row._sum.baseCreditAmount ?? 0))).toBe(true);

    const reopened = await service.reopenPeriod(context(), periodId, {
      version: closed.period.version,
      reason: "إعادة فتح موثقة لاختبار عكس الإقفال",
      idempotencyKey: "fc-reopen-final",
    });
    expect(reopened.period.status).toBe("REOPENED");
    const reversedClose = await prisma!.accountingDocument.findUniqueOrThrow({ where: { id: closeDocument.id } });
    expect(reversedClose.status).toBe("REVERSED");
    expect(reversedClose.reversedByDocumentId).not.toBeNull();
  });

  it("does not disclose the close run across companies", async () => {
    const otherCompany = await prisma!.company.findFirstOrThrow({ where: { id: { not: companyId } } });
    await expect(service.currentRun({ userId, companyId: otherCompany.id }, periodId)).rejects.toEqual(new FinancialCloseError("NOT_FOUND"));
  });
});
