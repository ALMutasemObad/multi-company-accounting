import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { parseOpenApiResponseBody } from "../src/generated/openapi-request-guards.js";
import { PrismaCashFlowLedgerQueryAdapter } from "../src/reports/adapters/prisma-cash-flow-ledger-query-adapter.js";
import { CashFlowError, CashFlowService } from "../src/reports/cash-flow-service.js";
import { TreasuryCashFlowAccountAdapter } from "../src/treasury/cash-flow-account-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("indirect cash-flow report with MariaDB", () => {
  let service: CashFlowService;
  let companyId: bigint;
  let userId: bigint;
  let baseCurrencyId: bigint;
  let periodId: bigint;
  let cashAccountId: bigint;
  let receivableAccountId: bigint;
  let revenueAccountId: bigint;
  let expenseAccountId: bigint;

  const context = () => ({ companyId, userId });

  async function cleanupCompany(targetCompanyId: bigint) {
    await prisma!.cashFlowAccountMapping.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.auditLog.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.cashBankAccount.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.journalLine.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.journalEntry.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.accountingDocument.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.fiscalYear.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.account.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.companyCurrency.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.company.delete({ where: { id: targetCompanyId } });
  }

  async function createPostedDocument(
    number: string,
    date: string,
    lines: Array<{ accountId: bigint; debit: string; credit: string }>,
  ) {
    const document = await prisma!.accountingDocument.create({
      data: {
        companyId,
        fiscalPeriodId: periodId,
        documentType: "MANUAL_JOURNAL",
        documentNumber: number,
        documentDate: new Date(`${date}T00:00:00.000Z`),
        description: "قيد اصطناعي لاختبار التدفق النقدي",
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
    await prisma!.journalLine.createMany({
      data: lines.map((line, index) => ({
        companyId,
        journalEntryId: entry.id,
        lineNumber: index + 1,
        accountId: line.accountId,
        currencyId: baseCurrencyId,
        exchangeRate: "1.00000000",
        debitAmount: line.debit,
        creditAmount: line.credit,
        baseDebitAmount: line.debit,
        baseCreditAmount: line.credit,
      })),
    });
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    const assignment = await prisma!.userCompany.findFirstOrThrow({ where: { userId: user.id, isActive: true } });
    const seedCompany = await prisma!.company.findUniqueOrThrow({ where: { id: assignment.companyId } });
    const leakedCompanies = await prisma!.company.findMany({ where: { name: { startsWith: "CASH-FLOW-IT-" } }, select: { id: true } });
    for (const leaked of leakedCompanies) await cleanupCompany(leaked.id);
    userId = user.id;
    baseCurrencyId = seedCompany.baseCurrencyId;
    const company = await prisma!.company.create({
      data: {
        organizationId: seedCompany.organizationId,
        baseCurrencyId,
        name: `CASH-FLOW-IT-${Date.now()}`,
        timezone: "Asia/Riyadh",
      },
    });
    companyId = company.id;
    await prisma!.companyCurrency.create({ data: { companyId, currencyId: baseCurrencyId, isActive: true } });
    const [assetType, liabilityType, revenueType, expenseType] = await Promise.all([
      prisma!.accountType.findUniqueOrThrow({ where: { code: "ASSET" } }),
      prisma!.accountType.findUniqueOrThrow({ where: { code: "LIABILITY" } }),
      prisma!.accountType.findUniqueOrThrow({ where: { code: "REVENUE" } }),
      prisma!.accountType.findUniqueOrThrow({ where: { code: "EXPENSE" } }),
    ]);
    const accounts = await Promise.all([
      prisma!.account.create({ data: { companyId, accountTypeId: assetType.id, code: "1110", nameAr: "نقدية الاختبار", level: 1, allowsPosting: true, sourceTemplateCode: "cash-flow-it", sourceTemplateKey: "cash" } }),
      prisma!.account.create({ data: { companyId, accountTypeId: assetType.id, code: "1210", nameAr: "ذمم الاختبار", level: 1, allowsPosting: true, sourceTemplateCode: "cash-flow-it", sourceTemplateKey: "receivables" } }),
      prisma!.account.create({ data: { companyId, accountTypeId: liabilityType.id, code: "3110", nameAr: "رأس مال الاختبار", level: 1, allowsPosting: true, sourceTemplateCode: "cash-flow-it", sourceTemplateKey: "capital" } }),
      prisma!.account.create({ data: { companyId, accountTypeId: revenueType.id, code: "4110", nameAr: "إيراد الاختبار", level: 1, allowsPosting: true } }),
      prisma!.account.create({ data: { companyId, accountTypeId: expenseType.id, code: "5110", nameAr: "مصروف الاختبار", level: 1, allowsPosting: true } }),
    ]);
    [cashAccountId, receivableAccountId, , revenueAccountId, expenseAccountId] = accounts.map((account) => account.id);
    await prisma!.cashBankAccount.create({
      data: { companyId, ledgerAccountId: cashAccountId, accountType: "CASH", code: "CASH-IT", nameAr: "صندوق الاختبار" },
    });
    const year = await prisma!.fiscalYear.create({
      data: {
        companyId,
        name: "سنة اختبار التدفق 2057",
        startDate: new Date("2056-01-01T00:00:00.000Z"),
        endDate: new Date("2057-12-31T00:00:00.000Z"),
        periods: { create: { periodNumber: 1, name: "فترة الاختبار", startDate: new Date("2056-01-01T00:00:00.000Z"), endDate: new Date("2057-12-31T00:00:00.000Z") } },
      },
      include: { periods: true },
    });
    periodId = year.periods[0]!.id;
    service = new CashFlowService(prisma!, new PrismaCashFlowLedgerQueryAdapter(), new TreasuryCashFlowAccountAdapter());

    await createPostedDocument("CF-OPEN", "2056-12-31", [
      { accountId: cashAccountId, debit: "100.0000", credit: "0.0000" },
      { accountId: accounts[2]!.id, debit: "0.0000", credit: "100.0000" },
    ]);
    await createPostedDocument("CF-PERIOD", "2057-01-15", [
      { accountId: cashAccountId, debit: "60.0000", credit: "0.0000" },
      { accountId: receivableAccountId, debit: "40.0000", credit: "0.0000" },
      { accountId: expenseAccountId, debit: "20.0000", credit: "0.0000" },
      { accountId: revenueAccountId, debit: "0.0000", credit: "100.0000" },
      { accountId: cashAccountId, debit: "0.0000", credit: "20.0000" },
    ]);
  });

  afterAll(async () => {
    if (!prisma || !companyId) return;
    await cleanupCompany(companyId);
    await prisma.$disconnect();
  });

  it("reconciles net income and balance changes to actual cash", async () => {
    const report = await service.cashFlow(context(), { dateFrom: "2057-01-01", dateTo: "2057-01-31" });
    expect(report).toMatchObject({
      sections: {
        operating: { netIncome: "80.0000", total: "40.0000" },
        investing: { total: "0.0000" },
        financing: { total: "0.0000" },
      },
      cash: {
        opening: "100.0000",
        closing: "140.0000",
        calculatedNetChange: "40.0000",
        netChange: "40.0000",
        difference: "0.0000",
        reconciled: true,
      },
      mapping: { complete: true, unmappedAccounts: [] },
    });
    expect(report.sections.operating.workingCapital).toEqual([
      expect.objectContaining({ accountId: receivableAccountId.toString(), amount: "-40.0000" }),
    ]);
    expect(() => parseOpenApiResponseBody("getIndirectCashFlow", 200, report)).not.toThrow();
  });

  it("updates classifications with optimistic concurrency and keeps company isolation", async () => {
    const changed = await service.updateMapping(context(), receivableAccountId, { classification: "INVESTING", version: 0 });
    expect(changed).toMatchObject({ classification: "INVESTING", source: "EXPLICIT", version: 0 });
    const advanced = await service.updateMapping(context(), receivableAccountId, { classification: "FINANCING", version: 0 });
    expect(advanced).toMatchObject({ classification: "FINANCING", source: "EXPLICIT", version: 1 });
    await expect(service.updateMapping(context(), receivableAccountId, { classification: "INVESTING", version: 0 }))
      .rejects.toEqual(new CashFlowError("VERSION_CONFLICT"));

    const report = await service.cashFlow(context(), { dateFrom: "2057-01-01", dateTo: "2057-01-31" });
    expect(report).toMatchObject({
      sections: { operating: { total: "80.0000" }, financing: { total: "-40.0000" } },
      cash: { reconciled: true },
    });
    const foreignAccount = await prisma!.account.findFirstOrThrow({ where: { companyId: { not: companyId }, allowsPosting: true } });
    await expect(service.updateMapping(context(), foreignAccount.id, { classification: "INVESTING", version: 0 }))
      .rejects.toEqual(new CashFlowError("NOT_FOUND"));
  });
});
