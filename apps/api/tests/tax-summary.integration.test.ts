import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { parseOpenApiResponseBody } from "../src/generated/openapi-request-guards.js";
import { PrismaTaxSummaryQueryAdapter } from "../src/reports/adapters/prisma-tax-summary-query-adapter.js";
import { TaxSummaryService } from "../src/reports/tax-summary-service.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("tax summary report with MariaDB", () => {
  let service: TaxSummaryService;
  let userId: bigint;
  let companyId: bigint;
  let foreignCompanyId: bigint;

  async function cleanupCompany(targetCompanyId: bigint) {
    await prisma!.salesInvoiceLine.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.purchaseInvoiceLine.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.salesInvoice.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.purchaseInvoice.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.accountingDocument.updateMany({ where: { companyId: targetCompanyId, status: "REVERSED" }, data: { status: "POSTED", reversedByDocumentId: null } });
    await prisma!.accountingDocument.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.taxRate.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.customer.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.supplier.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.fiscalYear.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.account.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.companyCurrency.deleteMany({ where: { companyId: targetCompanyId } });
    await prisma!.company.delete({ where: { id: targetCompanyId } });
  }

  async function createFixture(name: string, outputNet: string, outputTax: string, documentDate: string, withPurchase: boolean) {
    const seedAssignment = await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true }, include: { company: true } });
    const company = await prisma!.company.create({ data: { organizationId: seedAssignment.company.organizationId, baseCurrencyId: seedAssignment.company.baseCurrencyId, name, timezone: "Asia/Riyadh" } });
    await prisma!.companyCurrency.create({ data: { companyId: company.id, currencyId: company.baseCurrencyId, isActive: true } });
    const accountTypes = Object.fromEntries((await prisma!.accountType.findMany()).map((type) => [type.code, type.id]));
    const [receivable, payable, revenue, expense] = await Promise.all([
      prisma!.account.create({ data: { companyId: company.id, accountTypeId: accountTypes.ASSET!, code: "1110", nameAr: "ذمم العملاء", level: 1, allowsPosting: true } }),
      prisma!.account.create({ data: { companyId: company.id, accountTypeId: accountTypes.LIABILITY!, code: "2110", nameAr: "ذمم الموردين", level: 1, allowsPosting: true } }),
      prisma!.account.create({ data: { companyId: company.id, accountTypeId: accountTypes.REVENUE!, code: "4110", nameAr: "الإيرادات", level: 1, allowsPosting: true } }),
      prisma!.account.create({ data: { companyId: company.id, accountTypeId: accountTypes.EXPENSE!, code: "5110", nameAr: "المصروفات", level: 1, allowsPosting: true } }),
    ]);
    const [customer, supplier, taxRate] = await Promise.all([
      prisma!.customer.create({ data: { companyId: company.id, receivableAccountId: receivable.id, code: "CUS-1", nameAr: "عميل الاختبار" } }),
      prisma!.supplier.create({ data: { companyId: company.id, payableAccountId: payable.id, code: "SUP-1", nameAr: "مورد الاختبار" } }),
      prisma!.taxRate.create({ data: { companyId: company.id, code: "VAT-15", nameAr: "ضريبة 15%", rate: "15.0000" } }),
    ]);
    const year = await prisma!.fiscalYear.create({ data: { companyId: company.id, name: "سنة التقرير الضريبي", startDate: new Date("2058-01-01T00:00:00.000Z"), endDate: new Date("2058-12-31T00:00:00.000Z"), periods: { create: { periodNumber: 1, name: "فترة التقرير", startDate: new Date("2058-01-01T00:00:00.000Z"), endDate: new Date("2058-12-31T00:00:00.000Z") } } }, include: { periods: true } });
    const periodId = year.periods[0]!.id;
    const salesDocument = await prisma!.accountingDocument.create({ data: { companyId: company.id, fiscalPeriodId: periodId, documentType: "SALES_INVOICE", documentNumber: "SI-TAX-1", documentDate: new Date(`${documentDate}T00:00:00.000Z`), description: "فاتورة اختبار التقرير الضريبي", status: "POSTED", createdBy: userId, postedBy: userId, postedAt: new Date() } });
    const sales = await prisma!.salesInvoice.create({ data: { companyId: company.id, accountingDocumentId: salesDocument.id, customerId: customer.id, currencyId: company.baseCurrencyId, exchangeRate: "1.00000000", dueDate: salesDocument.documentDate, subtotal: outputNet, discountTotal: "0.0000", taxableTotal: outputNet, taxTotal: outputTax, total: String(Number(outputNet) + Number(outputTax)), baseTotal: String(Number(outputNet) + Number(outputTax)), customerNameSnapshot: customer.nameAr } });
    await prisma!.salesInvoiceLine.create({ data: { companyId: company.id, salesInvoiceId: sales.id, lineNumber: 1, revenueAccountId: revenue.id, taxRateId: taxRate.id, description: "خدمة خاضعة", quantity: "1.000000", unitPrice: outputNet, discountAmount: "0.0000", netAmount: outputNet, taxRateSnapshot: "15.0000", taxAmount: outputTax, totalAmount: String(Number(outputNet) + Number(outputTax)) } });
    if (withPurchase) {
      const purchaseDocument = await prisma!.accountingDocument.create({ data: { companyId: company.id, fiscalPeriodId: periodId, documentType: "PURCHASE_INVOICE", documentNumber: "PI-TAX-1", documentDate: new Date("2058-07-12T00:00:00.000Z"), description: "فاتورة مشتريات اختبارية", status: "POSTED", createdBy: userId, postedBy: userId, postedAt: new Date() } });
      const purchase = await prisma!.purchaseInvoice.create({ data: { companyId: company.id, accountingDocumentId: purchaseDocument.id, supplierId: supplier.id, currencyId: company.baseCurrencyId, exchangeRate: "1.00000000", dueDate: purchaseDocument.documentDate, subtotal: "40.0000", discountTotal: "0.0000", taxableTotal: "40.0000", taxTotal: "6.0000", total: "46.0000", baseTotal: "46.0000", supplierNameSnapshot: supplier.nameAr } });
      await prisma!.purchaseInvoiceLine.create({ data: { companyId: company.id, purchaseInvoiceId: purchase.id, lineNumber: 1, debitAccountId: expense.id, taxRateId: taxRate.id, description: "مصروف خاضع", quantity: "1.000000", unitPrice: "40.0000", discountAmount: "0.0000", netAmount: "40.0000", taxRateSnapshot: "15.0000", taxAmount: "6.0000", totalAmount: "46.0000" } });
    }
    return { companyId: company.id, salesDocumentId: salesDocument.id, periodId };
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = user.id;
    const leaked = await prisma!.company.findMany({ where: { name: { startsWith: "TAX-SUMMARY-IT-" } }, select: { id: true } });
    for (const company of leaked) await cleanupCompany(company.id);
    const primary = await createFixture(`TAX-SUMMARY-IT-${Date.now()}`, "100.0000", "15.0000", "2058-07-10", true);
    companyId = primary.companyId;
    const reversal = await prisma!.accountingDocument.create({ data: { companyId, fiscalPeriodId: primary.periodId, documentType: "SALES_INVOICE", documentNumber: "SI-TAX-1-REV", documentDate: new Date("2058-08-10T00:00:00.000Z"), description: "عكس فاتورة التقرير الضريبي", status: "POSTED", createdBy: userId, postedBy: userId, postedAt: new Date() } });
    await prisma!.accountingDocument.update({ where: { id: primary.salesDocumentId }, data: { status: "REVERSED", reversedByDocumentId: reversal.id } });
    foreignCompanyId = (await createFixture(`TAX-SUMMARY-IT-FOREIGN-${Date.now()}`, "1000.0000", "150.0000", "2058-08-05", false)).companyId;
    service = new TaxSummaryService(prisma!, new PrismaTaxSummaryQueryAdapter());
  });

  afterAll(async () => {
    if (!prisma) return;
    if (foreignCompanyId) await cleanupCompany(foreignCompanyId);
    if (companyId) await cleanupCompany(companyId);
    await prisma.$disconnect();
  });

  it("summarizes posted output and input snapshots and satisfies the OpenAPI response", async () => {
    const report = await service.summary({ companyId, userId }, { dateFrom: "2058-07-01", dateTo: "2058-07-31" });
    expect(report.totals).toEqual({ outputTaxable: "100.0000", outputTax: "15.0000", inputTaxable: "40.0000", inputTax: "6.0000", netTaxDue: "9.0000", documentCount: 2 });
    expect(report.rows).toHaveLength(2);
    expect(() => parseOpenApiResponseBody("getTaxSummary", 200, report)).not.toThrow();
  });

  it("reports reversals on their event date without leaking another company", async () => {
    const report = await service.summary({ companyId, userId }, { dateFrom: "2058-08-01", dateTo: "2058-08-31" });
    expect(report.totals).toMatchObject({ outputTaxable: "-100.0000", outputTax: "-15.0000", inputTax: "0.0000", netTaxDue: "-15.0000", documentCount: 1 });
    expect(report.rows).toEqual([expect.objectContaining({ status: "REVERSED", documentCount: 1, taxCode: "VAT-15" })]);
    expect(report.rows.some((row) => row.taxBase === "150.0000")).toBe(false);
  });
});
