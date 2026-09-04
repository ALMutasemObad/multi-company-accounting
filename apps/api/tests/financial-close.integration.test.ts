import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApprovalError, ApprovalService } from "../src/approvals/approval-service.js";
import { CompanyCurrencyFinancialCloseReadinessAdapter } from "../src/companies/financial-close-readiness-adapter.js";
import { createDatabase } from "../src/database.js";
import { FinancialCloseError, FinancialCloseService } from "../src/fiscal/financial-close-service.js";
import { FinancialCloseApprovalAdapter } from "../src/fiscal/financial-close-approval-adapter.js";
import { parseOpenApiResponseBody } from "../src/generated/openapi-request-guards.js";
import { InventoryFinancialCloseReadinessAdapter } from "../src/inventory/financial-close-readiness-adapter.js";
import { SettlementFinancialCloseReadinessAdapter } from "../src/reports/financial-close-readiness-adapter.js";
import { TreasuryFinancialCloseReadinessAdapter } from "../src/treasury/financial-close-readiness-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("reviewed financial close workflow with MariaDB", () => {
  let service: FinancialCloseService;
  let approvals: ApprovalService;
  let companyId: bigint;
  let userId: bigint;
  let checkerUserId: bigint;
  let periodId: bigint;
  let assetAccountId: bigint;
  let revenueAccountId: bigint;
  let expenseAccountId: bigint;
  let retainedAccountId: bigint;
  let baseCurrencyId: bigint;

  const context = () => ({ companyId, userId });
  const checkerContext = () => ({ companyId, userId: checkerUserId });

  async function cleanupCompany(targetCompanyId: bigint) {
    await prisma!.idempotencyRecord.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.auditLog.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.approvalDecision.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.approvalRequest.deleteMany({ where: { companyId: targetCompanyId } });
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
    const checker = await prisma!.user.create({
      data: {
        emailNormalized: `financial-close-checker-${Date.now()}@example.test`,
        passwordHash: "integration-test-only",
        displayName: "مراجع إقفال مستقل",
      },
    });
    checkerUserId = checker.id;
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
    approvals = new ApprovalService(prisma!, {
      FINANCIAL_CLOSE_RUN: new FinancialCloseApprovalAdapter(service),
      PROFESSIONAL_TIMESHEET: {
        request: async () => { throw new Error("unused timesheet approval port"); },
        approve: async () => { throw new Error("unused timesheet approval port"); },
        reject: async () => { throw new Error("unused timesheet approval port"); },
      },
      EMPLOYEE_EXPENSE_CLAIM: {
        request: async () => { throw new Error("unused employee-expense approval port"); },
        approve: async () => { throw new Error("unused employee-expense approval port"); },
        reject: async () => { throw new Error("unused employee-expense approval port"); },
      },
    });
    await createPostedDocument("FC-IT-001", "200.0000", "70.0000");
  });

  afterAll(async () => {
    if (!prisma || !companyId) return;
    await cleanupCompany(companyId);
    await prisma.user.delete({ where: { id: checkerUserId } });
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

    const [submitted, submissionReplay] = await Promise.all([
      approvals.request(context(), {
        subjectType: "FINANCIAL_CLOSE_RUN",
        subjectId: started.run.id,
        subjectVersion: started.run.version,
        idempotencyKey: "fc-approval-submit-concurrent",
      }),
      approvals.request(context(), {
        subjectType: "FINANCIAL_CLOSE_RUN",
        subjectId: started.run.id,
        subjectVersion: started.run.version,
        idempotencyKey: "fc-approval-submit-concurrent",
      }),
    ]);
    expect(submissionReplay).toEqual(submitted);
    expect(submitted.approvalRequest.status).toBe("PENDING");
    expect(() => parseOpenApiResponseBody("createApprovalRequest", 201, submitted)).not.toThrow();
    expect((await service.currentRun(context(), periodId))?.status).toBe("AWAITING_APPROVAL");
    await expect(approvals.request(context(), {
      subjectType: "FINANCIAL_CLOSE_RUN",
      subjectId: started.run.id,
      subjectVersion: started.run.version + 1,
      idempotencyKey: "fc-approval-submit-concurrent",
    })).rejects.toEqual(new ApprovalError("IDEMPOTENCY_MISMATCH"));

    await expect(approvals.approve(context(), submitted.approvalRequest.id, {
      version: submitted.approvalRequest.version,
      idempotencyKey: "fc-maker-cannot-approve",
    })).rejects.toEqual(new ApprovalError("MAKER_CHECKER_VIOLATION"));

    const rejected = await approvals.reject(checkerContext(), submitted.approvalRequest.id, {
      version: submitted.approvalRequest.version,
      reason: "الحزمة تحتاج إلى مراجعة إضافية قبل الإقفال",
      idempotencyKey: "fc-checker-rejects-first",
    });
    expect(rejected.approvalRequest).toMatchObject({ status: "REJECTED", decision: { type: "REJECT" } });
    expect(() => parseOpenApiResponseBody("rejectApprovalRequest", 200, rejected)).not.toThrow();

    const preparingAfterReject = await service.currentRun(context(), periodId);
    expect(preparingAfterReject?.status).toBe("PREPARING");
    const secondSubmission = await approvals.request(context(), {
      subjectType: "FINANCIAL_CLOSE_RUN",
      subjectId: started.run.id,
      subjectVersion: preparingAfterReject!.version,
      idempotencyKey: "fc-approval-submit-second",
    });
    const approved = await approvals.approve(checkerContext(), secondSubmission.approvalRequest.id, {
      version: secondSubmission.approvalRequest.version,
      idempotencyKey: "fc-checker-approve-second",
    });
    expect(approved.approvalRequest).toMatchObject({ status: "APPROVED", decision: { type: "APPROVE" } });
    expect(() => parseOpenApiResponseBody("approveApprovalRequest", 200, approved)).not.toThrow();
    let reviewed = { run: (await service.currentRun(context(), periodId))! };
    expect(reviewed.run.status).toBe("REVIEWED");
    expect(reviewed.run.closePackHashSha256).toMatch(/^[a-f0-9]{64}$/u);

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
    const finalSubmission = await approvals.request(context(), {
      subjectType: "FINANCIAL_CLOSE_RUN",
      subjectId: returned.run.id,
      subjectVersion: returned.run.version,
      idempotencyKey: "fc-approval-submit-final",
    });
    await approvals.approve(checkerContext(), finalSubmission.approvalRequest.id, {
      version: finalSubmission.approvalRequest.version,
      idempotencyKey: "fc-approval-approve-final",
    });
    reviewed = { run: (await service.currentRun(context(), periodId))! };
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
    const request = await prisma!.approvalRequest.findFirstOrThrow({ where: { companyId } });
    await expect(approvals.get({ userId, companyId: otherCompany.id }, request.publicId)).rejects.toEqual(new ApprovalError("NOT_FOUND"));
  });
});
