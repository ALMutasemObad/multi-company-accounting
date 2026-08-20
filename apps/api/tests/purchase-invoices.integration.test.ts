import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { PaymentService } from "../src/payments/payment-service.js";
import { PurchaseInvoiceService } from "../src/purchases/purchase-invoice-service.js";
import { PrintService } from "../src/printing/print-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)("purchase invoices and payables with MariaDB", () => {
  let app: ReturnType<typeof createApp>;
  let companyId: bigint, userId: bigint, yearId: bigint, periodId: bigint, currencyId: bigint;
  let apId: bigint, expenseId: bigint, inputTaxId: bigint, cashLedgerId: bigint;
  let supplierId: bigint, cashBankId: bigint, paymentMethodId: bigint, taxRateId: bigint;

  async function removeYear(id: bigint) {
    const inYear = { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } };
    await prisma!.paymentAllocation.deleteMany({ where: { companyId, payment: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.payment.deleteMany({ where: inYear });
    await prisma!.purchaseInvoice.updateMany({ where: inYear, data: { apJournalLineId: null } });
    await prisma!.journalLine.deleteMany({ where: { companyId, journalEntry: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.journalEntry.updateMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } }, data: { reversalOfJournalEntryId: null } });
    await prisma!.journalEntry.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
    await prisma!.purchaseInvoiceLine.deleteMany({ where: { companyId, purchaseInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
    await prisma!.purchaseInvoice.deleteMany({ where: { ...inYear, sourceInvoiceId: { not: null } } });
    await prisma!.purchaseInvoice.deleteMany({ where: inYear });
    await prisma!.documentPrintArchive.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
    await prisma!.accountingDocument.deleteMany({ where: { companyId, fiscalPeriod: { fiscalYearId: id } } });
    await prisma!.documentSequence.deleteMany({ where: { companyId, fiscalYearId: id } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId, fiscalYearId: id } });
    await prisma!.fiscalYear.deleteMany({ where: { id, companyId } });
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = user.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true } })).companyId;
    currencyId = (await prisma!.company.findUniqueOrThrow({ where: { id: companyId } })).baseCurrencyId;
    const abandoned = await prisma!.fiscalYear.findFirst({ where: { companyId, name: "IT-PURCHASE-2045" } });
    if (abandoned) await removeYear(abandoned.id);
    await prisma!.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ["POST_PURCHASE_INVOICE", "REVERSE_PURCHASE_INVOICE", "POST_PAYMENT"] } } });
    await prisma!.taxRate.deleteMany({ where: { companyId, code: "IT-PURCHASE-VAT15" } });
    await prisma!.supplierAddress.deleteMany({ where: { companyId, supplier: { code: "IT-PURCHASE-SUP" } } });
    await prisma!.supplier.deleteMany({ where: { companyId, code: "IT-PURCHASE-SUP" } });
    await prisma!.cashBankAccount.deleteMany({ where: { companyId, code: "IT-PURCHASE-CASH" } });
    await prisma!.account.deleteMany({ where: { companyId, code: { startsWith: "IT-PURCHASE-" } } });

    const types = Object.fromEntries((await prisma!.accountType.findMany()).map((type) => [type.code, type.id]));
    apId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.LIABILITY!, code: "IT-PURCHASE-AP", nameAr: "ذمم موردين اختبارية", level: 1, allowsPosting: true } })).id;
    expenseId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.EXPENSE!, code: "IT-PURCHASE-EXP", nameAr: "مصروف مشتريات اختباري", level: 1, allowsPosting: true } })).id;
    inputTaxId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.ASSET!, code: "IT-PURCHASE-TAX", nameAr: "ضريبة مدخلات اختبارية", level: 1, allowsPosting: true } })).id;
    cashLedgerId = (await prisma!.account.create({ data: { companyId, accountTypeId: types.ASSET!, code: "IT-PURCHASE-CASH", nameAr: "نقدية مشتريات اختبارية", level: 1, allowsPosting: true } })).id;
    supplierId = (await prisma!.supplier.create({ data: { companyId, payableAccountId: apId, code: "IT-PURCHASE-SUP", nameAr: "مورد دورة المشتريات", taxNumberLast4: "4321", addresses: { create: { addressType: "PAYMENT", line1: "الرياض، حي الاختبار", isPrimary: true } } } })).id;
    cashBankId = (await prisma!.cashBankAccount.create({ data: { companyId, ledgerAccountId: cashLedgerId, accountType: "CASH", code: "IT-PURCHASE-CASH", nameAr: "صندوق مشتريات اختباري" } })).id;
    paymentMethodId = (await prisma!.paymentMethod.findFirstOrThrow({ where: { code: "CASH" } })).id;
    taxRateId = (await prisma!.taxRate.create({ data: { companyId, inputTaxAccountId: inputTaxId, code: "IT-PURCHASE-VAT15", nameAr: "ضريبة مدخلات 15% اختبارية", rate: "15.0000" } })).id;
    const year = await prisma!.fiscalYear.create({ data: { companyId, name: "IT-PURCHASE-2045", startDate: new Date("2045-01-01T00:00:00.000Z"), endDate: new Date("2045-12-31T00:00:00.000Z"), periods: { create: { periodNumber: 1, name: "السنة الاختبارية", startDate: new Date("2045-01-01T00:00:00.000Z"), endDate: new Date("2045-12-31T00:00:00.000Z") } } }, include: { periods: true } });
    yearId = year.id; periodId = year.periods[0]!.id;
    const auth = new AuthService(new PrismaAuthStore(prisma!), { verify }, { preAuthTtlMinutes: 10, sessionTtlHours: 12 });
    app = createApp({ NODE_ENV: "test", PORT: 3000, WEB_ORIGIN: "http://localhost:5173", SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, purchaseInvoices: new PurchaseInvoiceService(prisma!), payments: new PaymentService(prisma!), printing: new PrintService(prisma!) });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ["POST_PURCHASE_INVOICE", "REVERSE_PURCHASE_INVOICE", "POST_PAYMENT"] } } });
    await prisma.auditLog.deleteMany({ where: { companyId, entityType: { in: ["PURCHASE_INVOICE", "PAYMENT", "TAX_RATE"] } } });
    if (yearId) await removeYear(yearId);
    if (taxRateId) await prisma.taxRate.deleteMany({ where: { id: taxRateId } });
    if (supplierId) { await prisma.supplierAddress.deleteMany({ where: { companyId, supplierId } }); await prisma.supplier.deleteMany({ where: { id: supplierId } }); }
    if (cashBankId) await prisma.cashBankAccount.deleteMany({ where: { id: cashBankId } });
    const accountIds = [apId, expenseId, inputTaxId, cashLedgerId].filter(Boolean);
    if (accountIds.length) await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it("posts, pays and debits a supplier invoice and reports its aging", async () => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const login = await agent.post("/api/v1/auth/login").set("X-CSRF-Token", csrf.body.csrfToken).send({ email: "admin@mcap.local", password }).expect(200);
    const companies = await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context").set("X-CSRF-Token", login.body.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const headers = { "X-CSRF-Token": login.body.csrfToken };
    const invoice = await agent.post("/api/v1/purchase-invoices").set(headers).send({ documentType: "PURCHASE_INVOICE", fiscalPeriodId: periodId.toString(), documentDate: "2045-01-10", dueDate: "2045-02-10", description: "فاتورة خدمات تشغيلية", supplierId: supplierId.toString(), supplierInvoiceNumber: "SUP-INV-2045-10", currencyId: currencyId.toString(), exchangeRate: "1.00000000", lines: [{ description: "خدمات تشغيل", quantity: "2.0000", unitPrice: "1000.0000", discountAmount: "100.0000", debitAccountId: expenseId.toString(), taxRateId: taxRateId.toString() }] }).expect(201);
    expect(invoice.body.total).toBe("2185.0000");
    expect(invoice.body.supplierInvoiceNumber).toBe("SUP-INV-2045-10");
    const posted = await agent.post(`/api/v1/purchase-invoices/${invoice.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-purchase-invoice").send({ version: 0 }).expect(200);
    const detail = await agent.get(`/api/v1/purchase-invoices/${invoice.body.id}`).expect(200);
    const archivedBeforePrint = await prisma!.documentPrintArchive.findUniqueOrThrow({ where: { accountingDocumentId: BigInt(posted.body.document.id) } });
    expect(archivedBeforePrint.printCount).toBe(0);
    expect((archivedBeforePrint.snapshot as { invoice?: { supplierInvoiceNumber?: string } }).invoice?.supplierInvoiceNumber).toBe("SUP-INV-2045-10");
    const firstPdf = await agent.get(`/api/v1/purchase-invoices/${invoice.body.id}/pdf`).expect("Content-Type", /application\/pdf/).expect(200);
    const secondPdf = await agent.get(`/api/v1/purchase-invoices/${invoice.body.id}/pdf`).expect(200);
    expect(Buffer.from(firstPdf.body).subarray(0, 4).toString()).toBe("%PDF");
    expect(firstPdf.headers["x-print-archive-hash"]).toBe(secondPdf.headers["x-print-archive-hash"]);
    expect((await prisma!.documentPrintArchive.findUniqueOrThrow({ where: { accountingDocumentId: BigInt(posted.body.document.id) } })).printCount).toBe(2);
    const entry = await prisma!.journalEntry.findUniqueOrThrow({ where: { id: BigInt(posted.body.generatedJournalEntryIds[0]) }, include: { lines: true } });
    expect(entry.lines.reduce((sum, line) => sum + Number(line.baseDebitAmount), 0)).toBe(2185);
    expect(entry.lines.reduce((sum, line) => sum + Number(line.baseCreditAmount), 0)).toBe(2185);
    expect(entry.lines.find((line) => line.id === BigInt(detail.body.apJournalLineId))?.creditAmount.toFixed(4)).toBe("2185.0000");

    const payment = await agent.post("/api/v1/payments").set(headers).send({ fiscalPeriodId: periodId.toString(), documentDate: "2045-02-01", description: "سداد جزئي لفاتورة المورد", supplierId: supplierId.toString(), counterAccountId: null, cashBankAccountId: cashBankId.toString(), paymentMethodId: paymentMethodId.toString(), currencyId: currencyId.toString(), exchangeRate: "1.00000000", amount: "1000.0000", counterpartyName: "مورد دورة المشتريات", allocations: [{ targetJournalLineId: detail.body.apJournalLineId, allocatedAmount: "1000.0000" }] }).expect(201);
    await agent.post(`/api/v1/payments/${payment.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-purchase-payment").send({ version: 0 }).expect(200);
    const debit = await agent.post("/api/v1/purchase-invoices").set(headers).send({ documentType: "PURCHASE_DEBIT_NOTE", fiscalPeriodId: periodId.toString(), documentDate: "2045-02-05", dueDate: "2045-02-05", description: "إشعار مدين جزئي", supplierId: supplierId.toString(), sourceInvoiceId: invoice.body.id, currencyId: currencyId.toString(), exchangeRate: "1.00000000", lines: [{ description: "تخفيض خدمة", quantity: "1.0000", unitPrice: "100.0000", discountAmount: "0.0000", debitAccountId: expenseId.toString(), taxRateId: taxRateId.toString() }] }).expect(201);
    await agent.post(`/api/v1/purchase-invoices/${debit.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-purchase-debit").send({ version: 0 }).expect(200);
    const settled = await agent.get(`/api/v1/purchase-invoices/${invoice.body.id}`).expect(200);
    expect(settled.body.paidAmount).toBe("1000.0000");
    expect(settled.body.debitedAmount).toBe("115.0000");
    expect(settled.body.outstandingAmount).toBe("1070.0000");
    const aging = await agent.get("/api/v1/reports/payables-aging").query({ asOf: "2045-02-20", supplierId: supplierId.toString() }).expect(200);
    expect(aging.body.totals.days1To30).toBe("1070.0000");
    await agent.post(`/api/v1/purchase-invoices/${invoice.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-paid-purchase-invoice").send({ version: 1, reversalDate: "2045-02-20", reason: "يجب منع عكس فاتورة مسددة جزئيًا" }).expect(422);
  }, 25_000);

  it("prevents reversing a supplier invoice that has a posted debit note", async () => {
    const service = new PurchaseInvoiceService(prisma!);
    const context = { userId, companyId };
    const source = await service.create(context, { documentType: "PURCHASE_INVOICE", fiscalPeriodId: periodId, documentDate: "2045-03-01", dueDate: "2045-03-31", description: "فاتورة مرجعية لاختبار الإشعار", supplierId, currencyId, exchangeRate: "1.00000000", lines: [{ description: "خدمة أصلية", quantity: "1.0000", unitPrice: "500.0000", discountAmount: "0.0000", debitAccountId: expenseId, taxRateId: null }] });
    await service.post(context, source.id, 0, "it-post-source-with-debit-note");
    const debit = await service.create(context, { documentType: "PURCHASE_DEBIT_NOTE", fiscalPeriodId: periodId, documentDate: "2045-03-05", dueDate: "2045-03-05", description: "إشعار مرتبط يمنع العكس", supplierId, sourceInvoiceId: source.id, currencyId, exchangeRate: "1.00000000", lines: [{ description: "تخفيض", quantity: "1.0000", unitPrice: "100.0000", discountAmount: "0.0000", debitAccountId: expenseId, taxRateId: null }] });
    await service.post(context, debit.id, 0, "it-post-blocking-debit-note");
    await expect(service.reverse(context, source.id, { version: 1, reversalDate: "2045-03-06", reason: "يجب منع العكس مع إشعار مرحل" }, "it-reverse-source-with-debit-note")).rejects.toMatchObject({ reason: "HAS_SETTLEMENTS" });
  }, 15_000);
});
