import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { ReceiptService } from "../src/receipts/receipt-service.js";
import { SalesInvoiceService } from "../src/sales/sales-invoice-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)("sales invoices and receivables with MariaDB", () => {
  let app: ReturnType<typeof createApp>;
  let companyId: bigint;
  let userId: bigint;
  let yearId: bigint;
  let periodId: bigint;
  let currencyId: bigint;
  let arId: bigint;
  let revenueId: bigint;
  let taxAccountId: bigint;
  let cashLedgerId: bigint;
  let customerId: bigint;
  let cashBankId: bigint;
  let paymentMethodId: bigint;
  let taxRateId: bigint;

  async function removeYear(id: bigint) {
    const documentWhere = { companyId, fiscalPeriod: { fiscalYearId: id } };
    const invoiceWhere = { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } };
    await prisma!.receiptAllocation.deleteMany({ where: { companyId, receipt: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.receipt.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
    await prisma!.salesInvoice.updateMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } }, data: { arJournalLineId: null } });
    await prisma!.journalLine.deleteMany({ where: { companyId, journalEntry: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.journalEntry.updateMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } }, data: { reversalOfJournalEntryId: null } });
    await prisma!.journalEntry.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
    await prisma!.salesInvoiceLine.deleteMany({ where: { companyId, salesInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.salesInvoice.deleteMany({ where: { ...invoiceWhere, sourceInvoiceId: { not: null } } });
    await prisma!.salesInvoice.deleteMany({ where: invoiceWhere });
    await prisma!.documentPrintArchive.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
    await prisma!.accountingDocument.deleteMany({ where: documentWhere });
    await prisma!.documentSequence.deleteMany({ where: { companyId, fiscalYearId: id } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId, fiscalYearId: id } });
    await prisma!.fiscalYear.deleteMany({ where: { id, companyId } });
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = user.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true } })).companyId;
    currencyId = (await prisma!.company.findUniqueOrThrow({ where: { id: companyId } })).baseCurrencyId;
    const abandoned = await prisma!.fiscalYear.findFirst({ where: { companyId, name: "IT-SALES-2044" } });
    if (abandoned) await removeYear(abandoned.id);
    await prisma!.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ["POST_SALES_INVOICE", "REVERSE_SALES_INVOICE", "POST_RECEIPT"] } } });
    await prisma!.taxRate.deleteMany({ where: { companyId, code: "IT-VAT15" } });
    await prisma!.taxRate.deleteMany({ where: { companyId, code: { startsWith: "IT-SALES-RATE-" } } });
    await prisma!.customerAddress.deleteMany({ where: { companyId, customer: { code: "IT-SALES-CUST" } } });
    await prisma!.customer.deleteMany({ where: { companyId, code: "IT-SALES-CUST" } });
    await prisma!.cashBankAccount.deleteMany({ where: { companyId, code: "IT-SALES-CASH" } });
    await prisma!.account.deleteMany({ where: { companyId, code: { startsWith: "IT-SALES-" } } });

    const types = Object.fromEntries((await prisma!.accountType.findMany()).map((type) => [type.code, type.id]));
    arId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.ASSET!, code: "IT-SALES-AR", nameAr: "ذمم مبيعات اختبارية", level: 1, allowsPosting: true } })).id;
    cashLedgerId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.ASSET!, code: "IT-SALES-CASH", nameAr: "نقدية مبيعات اختبارية", level: 1, allowsPosting: true } })).id;
    revenueId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.REVENUE!, code: "IT-SALES-REV", nameAr: "إيراد مبيعات اختباري", level: 1, allowsPosting: true } })).id;
    taxAccountId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.LIABILITY!, code: "IT-SALES-TAX", nameAr: "ضريبة مخرجات اختبارية", level: 1, allowsPosting: true } })).id;
    customerId = (await prisma!.customer.create({ data: { companyId, receivableAccountId: arId, code: "IT-SALES-CUST", nameAr: "عميل دورة المبيعات", taxNumberLast4: "1234", addresses: { create: { addressType: "BILLING", line1: "الرياض، حي الاختبار", isPrimary: true } } } })).id;
    cashBankId = (await prisma!.cashBankAccount.create({ data: { companyId, ledgerAccountId: cashLedgerId, accountType: "CASH", code: "IT-SALES-CASH", nameAr: "صندوق مبيعات اختباري" } })).id;
    paymentMethodId = (await prisma!.paymentMethod.findFirstOrThrow({ where: { code: "CASH" } })).id;
    taxRateId = (await prisma!.taxRate.create({ data: { companyId, outputTaxAccountId: taxAccountId, code: "IT-VAT15", nameAr: "ضريبة 15% اختبارية", rate: "15.0000" } })).id;
    const year = await prisma!.fiscalYear.create({ data: { companyId, name: "IT-SALES-2044", startDate: new Date("2044-01-01T00:00:00.000Z"), endDate: new Date("2044-12-31T00:00:00.000Z"), periods: { create: { periodNumber: 1, name: "السنة الاختبارية", startDate: new Date("2044-01-01T00:00:00.000Z"), endDate: new Date("2044-12-31T00:00:00.000Z") } } }, include: { periods: true } });
    yearId = year.id;
    periodId = year.periods[0]!.id;

    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    app = createApp({ NODE_ENV: "test", PORT: 3000, WEB_ORIGIN: "http://localhost:5173", SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, salesInvoices: new SalesInvoiceService(prisma!), receipts: new ReceiptService(prisma!) });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ["POST_SALES_INVOICE", "REVERSE_SALES_INVOICE", "POST_RECEIPT"] } } });
    await prisma.auditLog.deleteMany({ where: { companyId, entityType: { in: ["SALES_INVOICE", "TAX_RATE", "RECEIPT"] } } });
    if (yearId) await removeYear(yearId);
    await prisma.taxRate.deleteMany({ where: { companyId, code: { startsWith: "IT-SALES-RATE-" } } });
    if (taxRateId) await prisma.taxRate.deleteMany({ where: { id: taxRateId } });
    if (customerId) {
      await prisma.customerAddress.deleteMany({ where: { companyId, customerId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
    }
    if (cashBankId) await prisma.cashBankAccount.deleteMany({ where: { id: cashBankId } });
    const accountIds = [arId, cashLedgerId, revenueId, taxAccountId].filter(Boolean);
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it("posts a taxed invoice, settles it with a receipt, credits it and reports aging", async () => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const login = await agent.post("/api/v1/auth/login").set("X-CSRF-Token", csrf.body.csrfToken).send({ email: "admin@mcap.local", password }).expect(200);
    const companies = await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context").set("X-CSRF-Token", login.body.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const headers = { "X-CSRF-Token": login.body.csrfToken };

    const invoice = await agent.post("/api/v1/sales-invoices").set(headers).send({
      documentType: "SALES_INVOICE", fiscalPeriodId: periodId.toString(), documentDate: "2044-01-10", dueDate: "2044-02-10", description: "فاتورة خدمات دورة كاملة", customerId: customerId.toString(), currencyId: currencyId.toString(), exchangeRate: "1.00000000",
      lines: [
        { description: "خدمات استشارية", quantity: "2.0000", unitPrice: "1000.0000", discountAmount: "100.0000", revenueAccountId: revenueId.toString(), taxRateId: taxRateId.toString() },
        { description: "خدمة معفاة", quantity: "1.0000", unitPrice: "500.0000", discountAmount: "0.0000", revenueAccountId: revenueId.toString(), taxRateId: null },
      ],
    }).expect(201);
    expect(invoice.body.total).toBe("2685.0000");
    expect(invoice.body.taxTotal).toBe("285.0000");

    const posted = await agent.post(`/api/v1/sales-invoices/${invoice.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-sales-invoice").send({ version: 0 }).expect(200);
    const detail = await agent.get(`/api/v1/sales-invoices/${invoice.body.id}`).expect(200);
    expect(detail.body.arJournalLineId).toMatch(/^[1-9][0-9]*$/);
    const entry = await prisma!.journalEntry.findUniqueOrThrow({ where: { id: BigInt(posted.body.generatedJournalEntryIds[0]) }, include: { lines: true } });
    expect(entry.lines.reduce((sum, line) => sum + Number(line.baseDebitAmount), 0)).toBe(2685);
    expect(entry.lines.reduce((sum, line) => sum + Number(line.baseCreditAmount), 0)).toBe(2685);

    const receipt = await agent.post("/api/v1/receipts").set(headers).send({ fiscalPeriodId: periodId.toString(), documentDate: "2044-02-01", description: "تحصيل جزئي للفاتورة", customerId: customerId.toString(), counterAccountId: null, cashBankAccountId: cashBankId.toString(), paymentMethodId: paymentMethodId.toString(), currencyId: currencyId.toString(), exchangeRate: "1.00000000", amount: "1000.0000", referenceNumber: null, counterpartyName: "عميل دورة المبيعات", allocations: [{ targetJournalLineId: detail.body.arJournalLineId, allocatedAmount: "1000.0000" }] }).expect(201);
    await agent.post(`/api/v1/receipts/${receipt.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-sales-receipt").send({ version: 0 }).expect(200);

    const credit = await agent.post("/api/v1/sales-invoices").set(headers).send({ documentType: "SALES_CREDIT_NOTE", fiscalPeriodId: periodId.toString(), documentDate: "2044-02-05", dueDate: "2044-02-05", description: "إشعار دائن جزئي", customerId: customerId.toString(), sourceInvoiceId: invoice.body.id, currencyId: currencyId.toString(), exchangeRate: "1.00000000", lines: [{ description: "تخفيض خدمة", quantity: "1.0000", unitPrice: "100.0000", discountAmount: "0.0000", revenueAccountId: revenueId.toString(), taxRateId: taxRateId.toString() }] }).expect(201);
    expect(credit.body.total).toBe("115.0000");
    await agent.post(`/api/v1/sales-invoices/${credit.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-sales-credit").send({ version: 0 }).expect(200);

    const settled = await agent.get(`/api/v1/sales-invoices/${invoice.body.id}`).expect(200);
    expect(settled.body.paidAmount).toBe("1000.0000");
    expect(settled.body.creditedAmount).toBe("115.0000");
    expect(settled.body.outstandingAmount).toBe("1570.0000");
    expect(settled.body.settlementStatus).toBe("PARTIAL");

    const aging = await agent.get("/api/v1/reports/receivables-aging").query({ asOf: "2044-02-20", customerId: customerId.toString() }).expect(200);
    expect(aging.body.baseCurrency.id).toBe(currencyId.toString());
    expect(aging.body.totals.days1To30).toBe("1570.0000");
    expect(aging.body.totals.total).toBe("1570.0000");
    await agent.post(`/api/v1/sales-invoices/${invoice.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-settled-sales-invoice").send({ version: 1, reversalDate: "2044-02-20", reason: "يجب منع عكس فاتورة محصلة" }).expect(422);
  }, 20_000);

  it("updates and cancels drafts, manages tax rates, and reverses an unsettled invoice", async () => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const login = await agent.post("/api/v1/auth/login").set("X-CSRF-Token", csrf.body.csrfToken).send({ email: "admin@mcap.local", password }).expect(200);
    const companies = await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context").set("X-CSRF-Token", login.body.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const headers = { "X-CSRF-Token": login.body.csrfToken };
    const draftPayload = {
      documentType: "SALES_INVOICE", fiscalPeriodId: periodId.toString(), documentDate: "2044-03-01", dueDate: "2044-03-31", description: "مسودة فاتورة للتعديل والإلغاء", customerId: customerId.toString(), currencyId: currencyId.toString(), exchangeRate: "1.00000000",
      lines: [{ description: "خدمة تجريبية", quantity: "1.0000", unitPrice: "300.0000", discountAmount: "0.0000", revenueAccountId: revenueId.toString(), taxRateId: null }],
    };
    const draft = await agent.post("/api/v1/sales-invoices").set(headers).send(draftPayload).expect(201);
    const updated = await agent.patch(`/api/v1/sales-invoices/${draft.body.id}`).set(headers).send({ ...draftPayload, version: 0, description: "مسودة معدلة قبل الإلغاء", lines: [{ ...draftPayload.lines[0], unitPrice: "450.0000", discountAmount: "50.0000" }] }).expect(200);
    expect(updated.body.total).toBe("400.0000");
    await agent.post(`/api/v1/sales-invoices/${draft.body.id}/cancel`).set(headers).send({ version: 1, reason: "إلغاء مسودة اختبارية" }).expect(200);

    const tax = await agent.post("/api/v1/tax-rates").set(headers).send({ code: "IT-SALES-RATE-5", nameAr: "ضريبة اختبارية 5%", rate: "5.0000", outputTaxAccountId: taxAccountId.toString() }).expect(201);
    const changedTax = await agent.patch(`/api/v1/tax-rates/${tax.body.id}`).set(headers).send({ nameAr: "ضريبة اختبارية معدلة", isActive: false }).expect(200);
    expect(changedTax.body.isActive).toBe(false);

    const reversible = await agent.post("/api/v1/sales-invoices").set(headers).send({ ...draftPayload, description: "فاتورة غير محصلة للعكس", documentDate: "2044-04-01", dueDate: "2044-04-30", lines: [{ ...draftPayload.lines[0], unitPrice: "450.0000", discountAmount: "50.0000" }] }).expect(201);
    await agent.post(`/api/v1/sales-invoices/${reversible.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-reversible-sales-invoice").send({ version: 0 }).expect(200);
    const reversed = await agent.post(`/api/v1/sales-invoices/${reversible.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-unsettled-sales-invoice").send({ version: 1, reversalDate: "2044-04-02", reason: "عكس فاتورة اختبارية غير محصلة" }).expect(200);
    expect(reversed.body.generatedJournalEntryIds).toHaveLength(1);
    const reversalEntry = await prisma!.journalEntry.findUniqueOrThrow({ where: { id: BigInt(reversed.body.generatedJournalEntryIds[0]) }, include: { lines: true } });
    expect(reversalEntry.lines.reduce((sum, line) => sum + Number(line.baseDebitAmount), 0)).toBe(400);
    expect(reversalEntry.lines.reduce((sum, line) => sum + Number(line.baseCreditAmount), 0)).toBe(400);
  }, 20_000);
});
