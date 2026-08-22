import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { ReceiptService } from "../src/receipts/receipt-service.js";
import { SalesInvoiceService } from "../src/sales/sales-invoice-service.js";
import { TaxService } from "../src/tax/tax-service.js";
import { TreasuryService } from "../src/treasury/treasury-service.js";

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
    await prisma!.receivableItem.deleteMany({ where: { companyId, salesInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
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
    const taxes = new TaxService(prisma!);
    const treasury = new TreasuryService(prisma!);
    app = createApp({ NODE_ENV: "test", PORT: 3000, WEB_ORIGIN: "http://localhost:5173", SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, taxes, salesInvoices: new SalesInvoiceService(prisma!, taxes), receipts: new ReceiptService(prisma!, treasury) });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ["POST_SALES_INVOICE", "REVERSE_SALES_INVOICE", "POST_RECEIPT"] } } });
    await prisma.auditLog.deleteMany({ where: { companyId, entityType: { in: ["SALES_INVOICE", "TAX_RATE", "RECEIPT"] } } });
    if (yearId) await removeYear(yearId);
    if (taxAccountId) await prisma.taxRate.deleteMany({ where: { companyId, outputTaxAccountId: taxAccountId } });
    await prisma.taxRate.deleteMany({ where: { companyId, code: { startsWith: "IT-SALES-RATE-" } } });
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
    expect(detail.body.receivableItemId).toMatch(/^[1-9][0-9]*$/);
    expect(detail.body.settlementVersion).toBe(0);
    const entry = await prisma!.journalEntry.findUniqueOrThrow({ where: { id: BigInt(posted.body.generatedJournalEntryIds[0]) }, include: { lines: true } });
    expect(entry.lines.reduce((sum, line) => sum + Number(line.baseDebitAmount), 0)).toBe(2685);
    expect(entry.lines.reduce((sum, line) => sum + Number(line.baseCreditAmount), 0)).toBe(2685);

    const receipt = await agent.post("/api/v1/receipts").set(headers).send({ fiscalPeriodId: periodId.toString(), documentDate: "2044-02-01", description: "تحصيل جزئي للفاتورة", customerId: customerId.toString(), counterAccountId: null, cashBankAccountId: cashBankId.toString(), paymentMethodId: paymentMethodId.toString(), currencyId: currencyId.toString(), exchangeRate: "1.00000000", amount: "1000.0000", referenceNumber: null, counterpartyName: "عميل دورة المبيعات", allocations: [{ receivableItemId: detail.body.receivableItemId, allocatedAmount: "1000.0000" }] }).expect(201);
    await agent.post(`/api/v1/receipts/${receipt.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-sales-receipt").send({ version: 0 }).expect(200);

    const credit = await agent.post("/api/v1/sales-invoices").set(headers).send({ documentType: "SALES_CREDIT_NOTE", fiscalPeriodId: periodId.toString(), documentDate: "2044-02-05", dueDate: "2044-02-05", description: "إشعار دائن جزئي", customerId: customerId.toString(), sourceInvoiceId: invoice.body.id, currencyId: currencyId.toString(), exchangeRate: "1.00000000", lines: [{ description: "تخفيض خدمة", quantity: "1.0000", unitPrice: "100.0000", discountAmount: "0.0000", revenueAccountId: revenueId.toString(), taxRateId: taxRateId.toString() }] }).expect(201);
    expect(credit.body.total).toBe("115.0000");
    await agent.post(`/api/v1/sales-invoices/${credit.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-sales-credit").send({ version: 0 }).expect(200);

    const settled = await agent.get(`/api/v1/sales-invoices/${invoice.body.id}`).expect(200);
    expect(settled.body.paidAmount).toBe("1000.0000");
    expect(settled.body.creditedAmount).toBe("115.0000");
    expect(settled.body.outstandingAmount).toBe("1570.0000");
    expect(settled.body.settlementStatus).toBe("PARTIAL");
    expect(settled.body.settlementVersion).toBe(2);
    const materializedItem = await prisma!.receivableItem.findUniqueOrThrow({ where: { id: BigInt(detail.body.receivableItemId) } });
    expect(materializedItem.outstandingAmount.toFixed(4)).toBe("1570.0000");
    expect(materializedItem.status).toBe("PARTIAL");
    expect(materializedItem.version).toBe(2);

    const aging = await agent.get("/api/v1/reports/receivables-aging").query({ asOf: "2044-02-20", customerId: customerId.toString() }).expect(200);
    expect(aging.body.baseCurrency.id).toBe(currencyId.toString());
    expect(aging.body.totals.days1To30).toBe("1570.0000");
    expect(aging.body.totals.total).toBe("1570.0000");
    await agent.post(`/api/v1/sales-invoices/${invoice.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-settled-sales-invoice").send({ version: 1, reversalDate: "2044-02-20", reason: "يجب منع عكس فاتورة محصلة" }).expect(422);
    await agent.post(`/api/v1/sales-invoices/${credit.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-sales-credit").send({ version: 1, reversalDate: "2044-02-21", reason: "عكس الإشعار الدائن لاستعادة رصيد الذمة" }).expect(200);
    const restored = await prisma!.receivableItem.findUniqueOrThrow({ where: { id: BigInt(detail.body.receivableItemId) } });
    expect(restored.outstandingAmount.toFixed(4)).toBe("1685.0000");
    expect(restored.status).toBe("PARTIAL");
    expect(restored.version).toBe(3);
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

    const tax = await agent.post("/api/v1/tax-rates").set(headers).send({ nameAr: "ضريبة اختبارية 5%", rate: "5.0000", outputTaxAccountId: taxAccountId.toString() }).expect(201);
    expect(tax.body.code).toMatch(/^TAX-[0-9]{6,}$/);
    expect(tax.body.version).toBe(0);
    const concurrentTaxUpdates = await Promise.all([
      agent.patch(`/api/v1/tax-rates/${tax.body.id}`).set(headers).send({ version: tax.body.version, nameAr: "ضريبة اختبارية معدلة أ", isActive: false }),
      agent.patch(`/api/v1/tax-rates/${tax.body.id}`).set(headers).send({ version: tax.body.version, nameAr: "ضريبة اختبارية معدلة ب", isActive: false }),
    ]);
    expect(concurrentTaxUpdates.map((response) => response.status).sort()).toEqual([200, 409]);
    const changedTax = concurrentTaxUpdates.find((response) => response.status === 200)!;
    expect(changedTax.body.isActive).toBe(false);
    expect(changedTax.body.version).toBe(1);
    await agent.post("/api/v1/tax-rates").set(headers).send({ nameAr: "حساب ضريبي غير صالح", rate: "5.0000", outputTaxAccountId: arId.toString() }).expect(422);
    await prisma!.taxRate.delete({ where: { id: BigInt(tax.body.id) } });

    const reversible = await agent.post("/api/v1/sales-invoices").set(headers).send({ ...draftPayload, description: "فاتورة غير محصلة للعكس", documentDate: "2044-04-01", dueDate: "2044-04-30", lines: [{ ...draftPayload.lines[0], unitPrice: "450.0000", discountAmount: "50.0000" }] }).expect(201);
    await agent.post(`/api/v1/sales-invoices/${reversible.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-reversible-sales-invoice").send({ version: 0 }).expect(200);
    const reversed = await agent.post(`/api/v1/sales-invoices/${reversible.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-unsettled-sales-invoice").send({ version: 1, reversalDate: "2044-04-02", reason: "عكس فاتورة اختبارية غير محصلة" }).expect(200);
    expect(reversed.body.generatedJournalEntryIds).toHaveLength(1);
    const reversalEntry = await prisma!.journalEntry.findUniqueOrThrow({ where: { id: BigInt(reversed.body.generatedJournalEntryIds[0]) }, include: { lines: true } });
    expect(reversalEntry.lines.reduce((sum, line) => sum + Number(line.baseDebitAmount), 0)).toBe(400);
    expect(reversalEntry.lines.reduce((sum, line) => sum + Number(line.baseCreditAmount), 0)).toBe(400);
    const reversedItem = await prisma!.receivableItem.findUniqueOrThrow({ where: { salesInvoiceId: BigInt(reversible.body.id) } });
    expect(reversedItem.outstandingAmount.toFixed(4)).toBe("0.0000");
    expect(reversedItem.status).toBe("REVERSED");
    expect(reversedItem.version).toBe(1);
  }, 20_000);

  it("serializes concurrent receipt allocations and invoice reversal on the receivable line", async () => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const login = await agent.post("/api/v1/auth/login").set("X-CSRF-Token", csrf.body.csrfToken).send({ email: "admin@mcap.local", password }).expect(200);
    const companies = await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context").set("X-CSRF-Token", login.body.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const headers = { "X-CSRF-Token": login.body.csrfToken };
    const invoicePayload = (description: string, documentDate: string, amount: string) => ({
      documentType: "SALES_INVOICE",
      fiscalPeriodId: periodId.toString(),
      documentDate,
      dueDate: documentDate,
      description,
      customerId: customerId.toString(),
      currencyId: currencyId.toString(),
      exchangeRate: "1.00000000",
      lines: [{ description, quantity: "1.0000", unitPrice: amount, discountAmount: "0.0000", revenueAccountId: revenueId.toString(), taxRateId: null }],
    });
    const receiptPayload = (description: string, documentDate: string, amount: string, receivableItemId: string) => ({
      fiscalPeriodId: periodId.toString(),
      documentDate,
      description,
      customerId: customerId.toString(),
      counterAccountId: null,
      cashBankAccountId: cashBankId.toString(),
      paymentMethodId: paymentMethodId.toString(),
      currencyId: currencyId.toString(),
      exchangeRate: "1.00000000",
      amount,
      referenceNumber: null,
      counterpartyName: "عميل اختبار التزامن",
      allocations: [{ receivableItemId, allocatedAmount: amount }],
    });

    const allocationInvoice = await agent.post("/api/v1/sales-invoices").set(headers).send(invoicePayload("فاتورة اختبار تجاوز التحصيل", "2044-05-01", "100.0000")).expect(201);
    await agent.post(`/api/v1/sales-invoices/${allocationInvoice.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-allocation-race-invoice").send({ version: 0 }).expect(200);
    const allocationDetail = await agent.get(`/api/v1/sales-invoices/${allocationInvoice.body.id}`).expect(200);
    const firstReceipt = await agent.post("/api/v1/receipts").set(headers).send(receiptPayload("تحصيل متزامن أول", "2044-05-02", "70.0000", allocationDetail.body.receivableItemId)).expect(201);
    const secondReceipt = await agent.post("/api/v1/receipts").set(headers).send(receiptPayload("تحصيل متزامن ثان", "2044-05-02", "70.0000", allocationDetail.body.receivableItemId)).expect(201);
    const allocationResponses = await Promise.all([
      agent.post(`/api/v1/receipts/${firstReceipt.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-allocation-race-receipt-1").send({ version: 0 }),
      agent.post(`/api/v1/receipts/${secondReceipt.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-allocation-race-receipt-2").send({ version: 0 }),
    ]);
    expect(allocationResponses.map((response) => response.status).sort()).toEqual([200, 422]);
    const allocated = await prisma!.receiptAllocation.aggregate({
      where: { companyId, receivableItemId: BigInt(allocationDetail.body.receivableItemId), receipt: { accountingDocument: { status: "POSTED" } } },
      _sum: { allocatedAmount: true },
    });
    expect(allocated._sum.allocatedAmount?.toFixed(4)).toBe("70.0000");
    const partiallySettledItem = await prisma!.receivableItem.findUniqueOrThrow({ where: { id: BigInt(allocationDetail.body.receivableItemId) } });
    expect(partiallySettledItem.outstandingAmount.toFixed(4)).toBe("30.0000");
    expect(partiallySettledItem.status).toBe("PARTIAL");
    expect(partiallySettledItem.version).toBe(1);

    const reversalInvoice = await agent.post("/api/v1/sales-invoices").set(headers).send(invoicePayload("فاتورة اختبار العكس مقابل التحصيل", "2044-06-01", "90.0000")).expect(201);
    await agent.post(`/api/v1/sales-invoices/${reversalInvoice.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-reversal-race-invoice").send({ version: 0 }).expect(200);
    const reversalDetail = await agent.get(`/api/v1/sales-invoices/${reversalInvoice.body.id}`).expect(200);
    const racingReceipt = await agent.post("/api/v1/receipts").set(headers).send(receiptPayload("تحصيل ينافس العكس", "2044-06-02", "90.0000", reversalDetail.body.receivableItemId)).expect(201);
    const [reverseResponse, receiptResponse] = await Promise.all([
      agent.post(`/api/v1/sales-invoices/${reversalInvoice.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-race-sales-invoice").send({ version: 1, reversalDate: "2044-06-03", reason: "اختبار عكس متزامن مع التحصيل" }),
      agent.post(`/api/v1/receipts/${racingReceipt.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-reversal-race-receipt").send({ version: 0 }),
    ]);
    expect([reverseResponse.status, receiptResponse.status].sort()).toEqual([200, 422]);
    const finalInvoice = await prisma!.salesInvoice.findUniqueOrThrow({ where: { id: BigInt(reversalInvoice.body.id) }, include: { accountingDocument: true } });
    const finalReceipt = await prisma!.receipt.findUniqueOrThrow({ where: { id: BigInt(racingReceipt.body.id) }, include: { accountingDocument: true } });
    expect(finalInvoice.accountingDocument.status === "REVERSED" && finalReceipt.accountingDocument.status === "POSTED").toBe(false);
    const finalItem = await prisma!.receivableItem.findUniqueOrThrow({ where: { id: BigInt(reversalDetail.body.receivableItemId) } });
    expect({ status: finalItem.status, outstanding: finalItem.outstandingAmount.toFixed(4) }).toEqual(
      finalInvoice.accountingDocument.status === "REVERSED"
        ? { status: "REVERSED", outstanding: "0.0000" }
        : { status: "SETTLED", outstanding: "0.0000" },
    );
  }, 30_000);
});
