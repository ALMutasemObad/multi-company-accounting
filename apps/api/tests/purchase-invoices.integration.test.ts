import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { PaymentService } from "../src/payments/payment-service.js";
import { PurchaseInvoiceService } from "../src/purchases/purchase-invoice-service.js";
import { TaxService } from "../src/tax/tax-service.js";
import { PrintService } from "../src/printing/print-service.js";
import { TreasuryService } from "../src/treasury/treasury-service.js";

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
    await prisma!.payableItem.deleteMany({ where: { companyId, purchaseInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } } });
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
    const taxes = new TaxService(prisma!);
    const treasury = new TreasuryService(prisma!);
    app = createApp({ NODE_ENV: "test", PORT: 3000, WEB_ORIGIN: "http://localhost:5173", SESSION_COOKIE_SECURE: false, PRE_AUTH_TTL_MINUTES: 10, SESSION_TTL_HOURS: 12, DATABASE_URL: databaseUrl }, { auth, taxes, purchaseInvoices: new PurchaseInvoiceService(prisma!, taxes), payments: new PaymentService(prisma!, treasury), printing: new PrintService(prisma!) });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.idempotencyRecord.deleteMany({ where: { companyId, operation: { in: ["POST_PURCHASE_INVOICE", "REVERSE_PURCHASE_INVOICE", "POST_PAYMENT"] } } });
    await prisma.auditLog.deleteMany({ where: { companyId, entityType: { in: ["PURCHASE_INVOICE", "PAYMENT", "TAX_RATE"] } } });
    if (yearId) await removeYear(yearId);
    if (inputTaxId) await prisma.taxRate.deleteMany({ where: { companyId, inputTaxAccountId: inputTaxId } });
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
    const managedTax = await agent.post("/api/v1/purchase-tax-rates").set(headers).send({
      nameAr: "ضريبة مدخلات اختبارية 5%",
      rate: "5.0000",
      inputTaxAccountId: inputTaxId.toString(),
    }).expect(201);
    expect(managedTax.body.version).toBe(0);
    const changedManagedTax = await agent.patch(`/api/v1/purchase-tax-rates/${managedTax.body.id}`).set(headers).send({
      version: 0,
      nameAr: "ضريبة مدخلات معدلة",
    }).expect(200);
    expect(changedManagedTax.body.version).toBe(1);
    await agent.post("/api/v1/purchase-tax-rates").set(headers).send({
      nameAr: "حساب مدخلات غير صالح",
      rate: "5.0000",
      inputTaxAccountId: expenseId.toString(),
    }).expect(422);
    await prisma!.taxRate.delete({ where: { id: BigInt(managedTax.body.id) } });
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
    expect(entry.lines.find((line) => line.supplierId === supplierId)?.creditAmount.toFixed(4)).toBe("2185.0000");
    expect(detail.body.payableItemId).toMatch(/^[1-9][0-9]*$/);
    expect(detail.body.settlementVersion).toBe(0);

    const payment = await agent.post("/api/v1/payments").set(headers).send({ fiscalPeriodId: periodId.toString(), documentDate: "2045-02-01", description: "سداد جزئي لفاتورة المورد", supplierId: supplierId.toString(), counterAccountId: null, cashBankAccountId: cashBankId.toString(), paymentMethodId: paymentMethodId.toString(), currencyId: currencyId.toString(), exchangeRate: "1.00000000", amount: "1000.0000", counterpartyName: "مورد دورة المشتريات", allocations: [{ payableItemId: detail.body.payableItemId, allocatedAmount: "1000.0000" }] }).expect(201);
    await agent.post(`/api/v1/payments/${payment.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-purchase-payment").send({ version: 0 }).expect(200);
    const debit = await agent.post("/api/v1/purchase-invoices").set(headers).send({ documentType: "PURCHASE_DEBIT_NOTE", fiscalPeriodId: periodId.toString(), documentDate: "2045-02-05", dueDate: "2045-02-05", description: "إشعار مدين جزئي", supplierId: supplierId.toString(), sourceInvoiceId: invoice.body.id, currencyId: currencyId.toString(), exchangeRate: "1.00000000", lines: [{ description: "تخفيض خدمة", quantity: "1.0000", unitPrice: "100.0000", discountAmount: "0.0000", debitAccountId: expenseId.toString(), taxRateId: taxRateId.toString() }] }).expect(201);
    await agent.post(`/api/v1/purchase-invoices/${debit.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-purchase-debit").send({ version: 0 }).expect(200);
    const settled = await agent.get(`/api/v1/purchase-invoices/${invoice.body.id}`).expect(200);
    expect(settled.body.paidAmount).toBe("1000.0000");
    expect(settled.body.debitedAmount).toBe("115.0000");
    expect(settled.body.outstandingAmount).toBe("1070.0000");
    expect(settled.body.settlementStatus).toBe("PARTIAL");
    expect(settled.body.settlementVersion).toBe(2);
    const aging = await agent.get("/api/v1/reports/payables-aging").query({ asOf: "2045-02-20", supplierId: supplierId.toString() }).expect(200);
    expect(aging.body.totals.days1To30).toBe("1070.0000");
    await agent.post(`/api/v1/purchase-invoices/${invoice.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-paid-purchase-invoice").send({ version: 1, reversalDate: "2045-02-20", reason: "يجب منع عكس فاتورة مسددة جزئيًا" }).expect(422);
    await agent.post(`/api/v1/purchase-invoices/${debit.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-purchase-debit").send({ version: 1, reversalDate: "2045-02-21", reason: "عكس الإشعار المدين لاستعادة رصيد الذمة" }).expect(200);
    const restored = await prisma!.payableItem.findUniqueOrThrow({ where: { id: BigInt(detail.body.payableItemId) } });
    expect(restored.outstandingAmount.toFixed(4)).toBe("1185.0000");
    expect(restored.status).toBe("PARTIAL");
    expect(restored.version).toBe(3);
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

  it("serializes concurrent payment allocations and invoice reversal on the payable line", async () => {
    const agent = request.agent(app);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    const login = await agent.post("/api/v1/auth/login").set("X-CSRF-Token", csrf.body.csrfToken).send({ email: "admin@mcap.local", password }).expect(200);
    const companies = await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context").set("X-CSRF-Token", login.body.csrfToken).send({ companyId: companies.body.data[0].id }).expect(204);
    const headers = { "X-CSRF-Token": login.body.csrfToken };
    const invoicePayload = (description: string, documentDate: string, amount: string, supplierInvoiceNumber: string) => ({
      documentType: "PURCHASE_INVOICE",
      fiscalPeriodId: periodId.toString(),
      documentDate,
      dueDate: documentDate,
      description,
      supplierId: supplierId.toString(),
      supplierInvoiceNumber,
      currencyId: currencyId.toString(),
      exchangeRate: "1.00000000",
      lines: [{ description, quantity: "1.0000", unitPrice: amount, discountAmount: "0.0000", debitAccountId: expenseId.toString(), taxRateId: null }],
    });
    const paymentPayload = (description: string, documentDate: string, amount: string, payableItemId: string) => ({
      fiscalPeriodId: periodId.toString(),
      documentDate,
      description,
      supplierId: supplierId.toString(),
      counterAccountId: null,
      cashBankAccountId: cashBankId.toString(),
      paymentMethodId: paymentMethodId.toString(),
      currencyId: currencyId.toString(),
      exchangeRate: "1.00000000",
      amount,
      counterpartyName: "مورد اختبار التزامن",
      allocations: [{ payableItemId, allocatedAmount: amount }],
    });

    const allocationInvoice = await agent.post("/api/v1/purchase-invoices").set(headers).send(invoicePayload("فاتورة اختبار تجاوز السداد", "2045-05-01", "100.0000", "RACE-PAY-1")).expect(201);
    await agent.post(`/api/v1/purchase-invoices/${allocationInvoice.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-payment-allocation-race-invoice").send({ version: 0 }).expect(200);
    const allocationDetail = await agent.get(`/api/v1/purchase-invoices/${allocationInvoice.body.id}`).expect(200);
    const firstPayment = await agent.post("/api/v1/payments").set(headers).send(paymentPayload("سداد متزامن أول", "2045-05-02", "70.0000", allocationDetail.body.payableItemId)).expect(201);
    const secondPayment = await agent.post("/api/v1/payments").set(headers).send(paymentPayload("سداد متزامن ثان", "2045-05-02", "70.0000", allocationDetail.body.payableItemId)).expect(201);
    const allocationResponses = await Promise.all([
      agent.post(`/api/v1/payments/${firstPayment.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-payment-allocation-race-1").send({ version: 0 }),
      agent.post(`/api/v1/payments/${secondPayment.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-payment-allocation-race-2").send({ version: 0 }),
    ]);
    expect(allocationResponses.map((response) => response.status).sort()).toEqual([200, 422]);
    const allocated = await prisma!.paymentAllocation.aggregate({
      where: { companyId, payableItemId: BigInt(allocationDetail.body.payableItemId), payment: { accountingDocument: { status: "POSTED" } } },
      _sum: { allocatedAmount: true },
    });
    expect(allocated._sum.allocatedAmount?.toFixed(4)).toBe("70.0000");
    const partiallySettledItem = await prisma!.payableItem.findUniqueOrThrow({ where: { id: BigInt(allocationDetail.body.payableItemId) } });
    expect(partiallySettledItem.outstandingAmount.toFixed(4)).toBe("30.0000");
    expect(partiallySettledItem.status).toBe("PARTIAL");
    expect(partiallySettledItem.version).toBe(1);

    const reversalInvoice = await agent.post("/api/v1/purchase-invoices").set(headers).send(invoicePayload("فاتورة اختبار العكس مقابل السداد", "2045-06-01", "90.0000", "RACE-PAY-2")).expect(201);
    await agent.post(`/api/v1/purchase-invoices/${reversalInvoice.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-payment-reversal-race-invoice").send({ version: 0 }).expect(200);
    const reversalDetail = await agent.get(`/api/v1/purchase-invoices/${reversalInvoice.body.id}`).expect(200);
    const racingPayment = await agent.post("/api/v1/payments").set(headers).send(paymentPayload("سداد ينافس العكس", "2045-06-02", "90.0000", reversalDetail.body.payableItemId)).expect(201);
    const [reverseResponse, paymentResponse] = await Promise.all([
      agent.post(`/api/v1/purchase-invoices/${reversalInvoice.body.id}/reverse`).set(headers).set("Idempotency-Key", "it-reverse-race-purchase-invoice").send({ version: 1, reversalDate: "2045-06-03", reason: "اختبار عكس متزامن مع السداد" }),
      agent.post(`/api/v1/payments/${racingPayment.body.id}/post`).set(headers).set("Idempotency-Key", "it-post-reversal-race-payment").send({ version: 0 }),
    ]);
    expect([reverseResponse.status, paymentResponse.status].sort()).toEqual([200, 422]);
    const finalInvoice = await prisma!.purchaseInvoice.findUniqueOrThrow({ where: { id: BigInt(reversalInvoice.body.id) }, include: { accountingDocument: true } });
    const finalPayment = await prisma!.payment.findUniqueOrThrow({ where: { id: BigInt(racingPayment.body.id) }, include: { accountingDocument: true } });
    expect(finalInvoice.accountingDocument.status === "REVERSED" && finalPayment.accountingDocument.status === "POSTED").toBe(false);
    const finalItem = await prisma!.payableItem.findUniqueOrThrow({ where: { id: BigInt(reversalDetail.body.payableItemId) } });
    expect({ status: finalItem.status, outstanding: finalItem.outstandingAmount.toFixed(4) }).toEqual(
      finalInvoice.accountingDocument.status === "REVERSED"
        ? { status: "REVERSED", outstanding: "0.0000" }
        : { status: "SETTLED", outstanding: "0.0000" },
    );
  }, 30_000);
});
