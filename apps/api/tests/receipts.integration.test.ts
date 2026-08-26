import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { ReceiptReferenceService } from "../src/receipts/reference-service.js";
import {
  ReceiptService,
  type ReceiptInput,
} from "../src/receipts/receipt-service.js";
import { PrintService } from "../src/printing/print-service.js";
import { TreasuryService } from "../src/treasury/treasury-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;
describe.runIf(enabled)(
  "receipt lifecycle and reference data with MariaDB",
  () => {
    let app: ReturnType<typeof createApp>;
    let companyId: bigint;
    let userId: bigint;
    let yearId: bigint;
    let periodId: bigint;
    let currencyId: bigint;
    let arId: bigint;
    let revenueId: bigint;
    let cashLedgerId: bigint;
    let customerId: bigint;
    let cashBankId: bigint;
    let paymentMethodId: bigint;
    let receivableItemId: bigint;
    let foreignCurrencyId: bigint | null = null;
    let agent: ReturnType<typeof request.agent>;
    let csrf = "";
    let receiptService: ReceiptService;
    async function removeYear(id: bigint) {
      await prisma!.receiptAllocation.deleteMany({
        where: {
          companyId,
          receipt: {
            accountingDocument: { fiscalPeriod: { fiscalYearId: id } },
          },
        },
      });
      await prisma!.receipt.deleteMany({
        where: {
          companyId,
          accountingDocument: { fiscalPeriod: { fiscalYearId: id } },
        },
      });
      await prisma!.receivableItem.deleteMany({
        where: { companyId, salesInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } },
      });
      await prisma!.salesInvoiceLine.deleteMany({
        where: { companyId, salesInvoice: { accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } },
      });
      await prisma!.salesInvoice.deleteMany({
        where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } },
      });
      await prisma!.journalLine.deleteMany({
        where: {
          companyId,
          journalEntry: {
            accountingDocument: { fiscalPeriod: { fiscalYearId: id } },
          },
        },
      });
      await prisma!.journalEntry.updateMany({
        where: {
          companyId,
          accountingDocument: { fiscalPeriod: { fiscalYearId: id } },
        },
        data: { reversalOfJournalEntryId: null },
      });
      await prisma!.journalEntry.deleteMany({
        where: {
          companyId,
          accountingDocument: { fiscalPeriod: { fiscalYearId: id } },
        },
      });
      await prisma!.accountingDocument.updateMany({
        where: {
          companyId,
          fiscalPeriod: { fiscalYearId: id },
          status: "REVERSED",
        },
        data: {
          status: "CANCELLED",
          postedBy: null,
          postedAt: null,
          reversedByDocumentId: null,
        },
      });
      await prisma!.documentPrintArchive.deleteMany({ where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } } });
      await prisma!.accountingDocument.deleteMany({
        where: { companyId, fiscalPeriod: { fiscalYearId: id } },
      });
      await prisma!.documentSequence.deleteMany({
        where: { fiscalYearId: id },
      });
      await prisma!.fiscalPeriod.deleteMany({ where: { fiscalYearId: id } });
      await prisma!.fiscalYear.delete({ where: { id } });
    }
    const apiPayload = (description = "IT-RCP سند قبض") => ({
      fiscalPeriodId: periodId.toString(),
      documentDate: "2043-03-10",
      description,
      customerId: customerId.toString(),
      cashBankAccountId: cashBankId.toString(),
      paymentMethodId: paymentMethodId.toString(),
      currencyId: currencyId.toString(),
      exchangeRate: "1.00000000",
      amount: "200.0000",
      counterpartyName: "عميل اختبار القبض",
      allocations: [
        {
          receivableItemId: receivableItemId.toString(),
          allocatedAmount: "200.0000",
        },
      ],
    });
    const servicePayload = (description: string): ReceiptInput => ({
      fiscalPeriodId: periodId,
      documentDate: "2043-03-10",
      description,
      customerId,
      cashBankAccountId: cashBankId,
      paymentMethodId,
      currencyId,
      exchangeRate: "1.00000000",
      amount: "200.0000",
      counterpartyName: "عميل اختبار القبض",
      allocations: [
        { receivableItemId, allocatedAmount: "200.0000" },
      ],
    });
    beforeAll(async () => {
      const user = await prisma!.user.findUniqueOrThrow({
        where: { emailNormalized: "admin@mcap.local" },
      });
      userId = user.id;
      companyId = (
        await prisma!.userCompany.findFirstOrThrow({
          where: { userId, isActive: true },
        })
      ).companyId;
      await prisma!.idempotencyRecord.deleteMany({
        where: {
          companyId,
          operation: { in: ["POST_RECEIPT", "REVERSE_RECEIPT"] },
        },
      });
      currencyId = (
        await prisma!.company.findUniqueOrThrow({ where: { id: companyId } })
      ).baseCurrencyId;
      const abandoned = await prisma!.fiscalYear.findFirst({
        where: { companyId, name: "IT-RCP-2043" },
      });
      if (abandoned) await removeYear(abandoned.id);
      const abandonedCurrency = await prisma!.currency.findFirst({
        where: { scopeKey: `COMPANY:${companyId}`, code: "FXR" },
      });
      if (abandonedCurrency) {
        await prisma!.companyCurrency.deleteMany({
          where: { companyId, currencyId: abandonedCurrency.id },
        });
        await prisma!.currency.delete({ where: { id: abandonedCurrency.id } });
      }
      await prisma!.customerAddress.deleteMany({
        where: { companyId, customer: { code: "IT-RCP-CUST" } },
      });
      await prisma!.customer.deleteMany({
        where: { companyId, code: "IT-RCP-CUST" },
      });
      await prisma!.cashBankAccount.deleteMany({
        where: { companyId, code: "IT-RCP-CASH" },
      });
      const type = await prisma!.accountType.findFirstOrThrow();
      arId = (
        await prisma!.account.upsert({
          where: { companyId_code: { companyId, code: "IT-RCP-AR" } },
          update: { isActive: true, allowsPosting: true },
          create: {
            companyId,
            accountTypeId: type.id,
            code: "IT-RCP-AR",
            nameAr: "ذمم عملاء اختبارية",
            level: 1,
            allowsPosting: true,
          },
        })
      ).id;
      revenueId = (
        await prisma!.account.upsert({
          where: { companyId_code: { companyId, code: "IT-RCP-REV" } },
          update: { isActive: true, allowsPosting: true },
          create: {
            companyId,
            accountTypeId: type.id,
            code: "IT-RCP-REV",
            nameAr: "إيراد اختباري",
            level: 1,
            allowsPosting: true,
          },
        })
      ).id;
      cashLedgerId = (
        await prisma!.account.upsert({
          where: { companyId_code: { companyId, code: "IT-RCP-CASH-GL" } },
          update: { isActive: true, allowsPosting: true },
          create: {
            companyId,
            accountTypeId: type.id,
            code: "IT-RCP-CASH-GL",
            nameAr: "صندوق اختباري",
            level: 1,
            allowsPosting: true,
          },
        })
      ).id;
      const year = await prisma!.fiscalYear.create({
        data: {
          companyId,
          name: "IT-RCP-2043",
          startDate: new Date("2043-01-01"),
          endDate: new Date("2043-12-31"),
          periods: {
            create: [
              {
                periodNumber: 1,
                name: "2043",
                startDate: new Date("2043-01-01"),
                endDate: new Date("2043-12-31"),
              },
            ],
          },
        },
        include: { periods: true },
      });
      yearId = year.id;
      periodId = year.periods[0]!.id;
      const treasury = new TreasuryService(prisma!);
      receiptService = new ReceiptService(prisma!, treasury);
      const references = new ReceiptReferenceService(prisma!);
      const auth = new AuthService(
        new PrismaAuthStore(prisma!),
        { verify },
        { preAuthTtlMinutes: 10, sessionTtlHours: 12 },
      );
      app = createApp(
        {
          NODE_ENV: "test",
          PORT: 3000,
          WEB_ORIGIN: "http://localhost:5173",
          SESSION_COOKIE_SECURE: false,
          PRE_AUTH_TTL_MINUTES: 10,
          SESSION_TTL_HOURS: 12,
          DATABASE_URL: databaseUrl,
        },
        { auth, receiptReferences: references, treasury, receipts: receiptService, printing: new PrintService(prisma!) },
      );
      agent = request.agent(app);
      csrf = (await agent.get("/api/v1/auth/csrf")).body.csrfToken;
      csrf = (
        await agent
          .post("/api/v1/auth/login")
          .set("X-CSRF-Token", csrf)
          .send({ email: "admin@mcap.local", password })
          .expect(200)
      ).body.csrfToken;
      const companies = await agent.get("/api/v1/auth/companies").expect(200);
      await agent
        .put("/api/v1/auth/context")
        .set("X-CSRF-Token", csrf)
        .send({ companyId: companies.body.data[0].id })
        .expect(204);
      const customer = await agent
        .post("/api/v1/customers")
        .set("X-CSRF-Token", csrf)
        .send({
          receivableAccountId: arId.toString(),
          nameAr: "عميل اختبار القبض",
          taxNumber: "1234567890",
          addresses: [
            {
              addressType: "BILLING",
              line1: "الرياض",
              countryCode: "SA",
              isPrimary: true,
            },
          ],
        })
        .expect(201);
      customerId = BigInt(customer.body.id);
      expect(customer.body.code).toMatch(/^CUS-[0-9]{6,}$/);
      expect(customer.body.taxNumberMasked).toBe("****7890");
      const cashBank = await agent
        .post("/api/v1/cash-bank-accounts")
        .set("X-CSRF-Token", csrf)
        .send({
          ledgerAccountId: cashLedgerId.toString(),
          accountType: "CASH",
          nameAr: "صندوق القبض",
          accountNumber: "99887766",
        })
        .expect(201);
      expect(cashBank.body.accountNumberMasked).toBe("****7766");
      expect(cashBank.body.code).toMatch(/^CB-[0-9]{6,}$/);
      expect(cashBank.body).not.toHaveProperty("accountNumber");
      cashBankId = BigInt(cashBank.body.id);
      paymentMethodId = (
        await prisma!.paymentMethod.findUniqueOrThrow({
          where: { code: "CASH" },
        })
      ).id;
      const invoice = await prisma!.accountingDocument.create({
        data: {
          companyId,
          fiscalPeriodId: periodId,
          documentType: "SALES_INVOICE",
          documentNumber: "IT-RCP-INVOICE",
          documentDate: new Date("2043-02-01"),
          description: "فاتورة مستهدفة",
          status: "POSTED",
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          salesInvoice: {
            create: {
              customerId,
              currencyId,
              exchangeRate: "1.00000000",
              dueDate: new Date("2043-03-01"),
              subtotal: "200.0000",
              discountTotal: "0.0000",
              taxableTotal: "200.0000",
              taxTotal: "0.0000",
              total: "200.0000",
              baseTotal: "200.0000",
              customerNameSnapshot: "عميل اختبار القبض",
            },
          },
          journalEntries: {
            create: [
              {
                entryNumber: 1,
                entryDate: new Date("2043-02-01"),
                description: "فاتورة مستهدفة",
                lines: {
                  create: [
                    {
                      lineNumber: 1,
                      accountId: arId,
                      customerId,
                      currencyId,
                      exchangeRate: "1.00000000",
                      debitAmount: "200.0000",
                      creditAmount: "0.0000",
                      baseDebitAmount: "200.0000",
                      baseCreditAmount: "0.0000",
                    },
                    {
                      lineNumber: 2,
                      accountId: revenueId,
                      currencyId,
                      exchangeRate: "1.00000000",
                      debitAmount: "0.0000",
                      creditAmount: "200.0000",
                      baseDebitAmount: "0.0000",
                      baseCreditAmount: "200.0000",
                    },
                  ],
                },
              },
            ],
          },
        },
        include: { salesInvoice: true, journalEntries: { include: { lines: true } } },
      });
      const targetLineId = invoice.journalEntries[0]!.lines[0]!.id;
      await prisma!.salesInvoice.update({
        where: { id: invoice.salesInvoice!.id },
        data: { arJournalLineId: targetLineId },
      });
      receivableItemId = (await prisma!.receivableItem.create({
        data: {
          companyId,
          salesInvoiceId: invoice.salesInvoice!.id,
          customerId,
          currencyId,
          dueDate: new Date("2043-03-01"),
          originalAmount: "200.0000",
          outstandingAmount: "200.0000",
          originalBaseAmount: "200.0000",
          outstandingBaseAmount: "200.0000",
        },
      })).id;
    });
    afterAll(async () => {
      if (!prisma) return;
      await prisma.idempotencyRecord.deleteMany({
        where: {
          companyId,
          operation: { in: ["POST_RECEIPT", "REVERSE_RECEIPT"] },
        },
      });
      await prisma.auditLog.deleteMany({
        where: {
          companyId,
          entityType: {
            in: [
              "RECEIPT",
              "CUSTOMER",
              "CUSTOMER_ADDRESS",
              "CASH_BANK_ACCOUNT",
              "PAYMENT_METHOD",
            ],
          },
        },
      });
      if (yearId) await removeYear(yearId);
      if (foreignCurrencyId) {
        await prisma.companyCurrency.deleteMany({
          where: { companyId, currencyId: foreignCurrencyId },
        });
        await prisma.currency.delete({ where: { id: foreignCurrencyId } });
      }
      await prisma.customerAddress.deleteMany({
        where: { companyId, customerId },
      });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.cashBankAccount.deleteMany({ where: { id: cashBankId } });
      await prisma.paymentMethod.deleteMany({ where: { companyId, scope: "COMPANY", code: "IT_RCP_WIRE" } });
      await prisma.account.deleteMany({
        where: { id: { in: [arId, revenueId, cashLedgerId] } },
      });
      await prisma.$disconnect();
    });
    it("manages customer and treasury reference data with company isolation", async () => {
      const customer = await agent
        .get(`/api/v1/customers/${customerId}`)
        .expect(200);
      expect(customer.body.addresses).toHaveLength(1);
      const updated = await agent
        .patch(`/api/v1/customers/${customerId}`)
        .set("X-CSRF-Token", csrf)
        .send({ phone: "0500000000" })
        .expect(200);
      expect(updated.body.phone).toBe("0500000000");
      const address = await agent
        .post(`/api/v1/customers/${customerId}/addresses`)
        .set("X-CSRF-Token", csrf)
        .send({ addressType: "OTHER", line1: "عنوان إضافي", countryCode: "SA" })
        .expect(201);
      await agent
        .patch(`/api/v1/customers/${customerId}/addresses/${address.body.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ city: "الرياض" })
        .expect(200)
        .then((result) => expect(result.body.city).toBe("الرياض"));
      await agent
        .delete(`/api/v1/customers/${customerId}/addresses/${address.body.id}`)
        .set("X-CSRF-Token", csrf)
        .expect(204);
      const methods = await agent.get("/api/v1/payment-methods").expect(200);
      expect(
        methods.body.data.some((method: any) => method.code === "CASH"),
      ).toBe(true);
      const currencies = await agent.get("/api/v1/currencies").expect(200);
      expect(
        currencies.body.data.some((currency: any) => currency.code === "SAR"),
      ).toBe(true);
      const base = await prisma!.company.findUniqueOrThrow({
        where: { id: companyId },
      });
      const foreign = await prisma!.company.create({
        data: {
          organizationId: base.organizationId,
          baseCurrencyId: base.baseCurrencyId,
          name: "IT-RCP شركة أخرى",
          timezone: "Asia/Riyadh",
        },
      });
      const foreignCustomer = await prisma!.customer
        .create({
          data: {
            companyId: foreign.id,
            receivableAccountId: arId,
            code: "FOREIGN",
            nameAr: "أجنبي",
          },
        })
        .catch(() => null);
      try {
        expect(foreignCustomer).toBeNull();
        await agent
          .get("/api/v1/customers")
          .query({ search: "FOREIGN" })
          .expect(200)
          .then((result) => expect(result.body.data).toHaveLength(0));
      } finally {
        await prisma!.company.delete({ where: { id: foreign.id } });
      }
    });
    it("generates immutable unique customer codes under concurrent creation", async () => {
      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          agent
            .post("/api/v1/customers")
            .set("X-CSRF-Token", csrf)
            .send({
              receivableAccountId: arId.toString(),
              nameAr: `عميل تزامن ${index + 1}`,
            }),
        ),
      );
      expect(responses.every((response) => response.status === 201)).toBe(true);
      const codes = responses.map((response) => response.body.code as string);
      const ids = responses.map((response) => response.body.id as string);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes.every((code) => /^CUS-[0-9]{6,}$/.test(code))).toBe(true);

      try {
        await agent
          .patch(`/api/v1/customers/${ids[0]}`)
          .set("X-CSRF-Token", csrf)
          .send({ code: "MANUAL-CODE" })
          .expect(400);
        const persisted = await agent
          .get(`/api/v1/customers/${ids[0]}`)
          .expect(200);
        expect(persisted.body.code).toBe(codes[0]);
      } finally {
        await prisma!.auditLog.deleteMany({
          where: { companyId, entityType: "CUSTOMER", entityId: { in: ids } },
        });
        await prisma!.customer.deleteMany({
          where: { companyId, id: { in: ids.map(BigInt) } },
        });
      }
    });
    it("manages company payment methods without allowing global reference edits", async () => {
      const created = await agent.post("/api/v1/payment-methods").set("X-CSRF-Token", csrf).send({ nameAr: "تحويل اختبار", requiresReference: true }).expect(201);
      try {
        expect(created.body.scope).toBe("COMPANY");
        expect(created.body.version).toBe(0);
        expect(created.body.code).toMatch(new RegExp(`^PM-${companyId}-[0-9]{6,}$`));
        const updated = await agent.patch(`/api/v1/payment-methods/${created.body.id}`).set("X-CSRF-Token", csrf).send({ version: 0, nameAr: "تحويل اختبار محدث" }).expect(200);
        expect(updated.body.nameAr).toContain("محدث");
        expect(updated.body.version).toBe(1);
        const global = await prisma!.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
        await agent.patch(`/api/v1/payment-methods/${global.id}`).set("X-CSRF-Token", csrf).send({ version: global.version, nameAr: "ممنوع" }).expect(422);
        await agent.post(`/api/v1/payment-methods/${created.body.id}/deactivate`).set("X-CSRF-Token", csrf).send({ version: 1, reason: "تعطيل اختباري" }).expect(200).then((result) => {
          expect(result.body.isActive).toBe(false);
          expect(result.body.version).toBe(2);
        });
        const all = await agent.get("/api/v1/payment-methods?includeInactive=true").expect(200);
        expect(all.body.data.some((method: any) => method.id === created.body.id && !method.isActive)).toBe(true);
      } finally {
        await prisma!.auditLog.deleteMany({ where: { companyId, entityType: "PAYMENT_METHOD", entityId: created.body.id } });
        await prisma!.paymentMethod.deleteMany({ where: { id: BigInt(created.body.id) } });
      }
    });
    it("validates allocation totals, updates a draft and cancels it", async () => {
      const invalid = apiPayload("IT-RCP توزيع خاطئ");
      invalid.allocations[0]!.allocatedAmount = "199.0000";
      await agent
        .post("/api/v1/receipts")
        .set("X-CSRF-Token", csrf)
        .send(invalid)
        .expect(422);
      const invalidRate = apiPayload("IT-RCP invalid exchange rate");
      invalidRate.exchangeRate = "2.00000000";
      await agent.post("/api/v1/receipts").set("X-CSRF-Token", csrf).send(invalidRate).expect(422);
      await agent.post("/api/v1/receipts").set("X-CSRF-Token", csrf).send({ ...apiPayload("IT-RCP duplicate counterparty"), counterAccountId: revenueId.toString() }).expect(400);
      await agent
        .post("/api/v1/receipts")
        .set("X-CSRF-Token", csrf)
        .send({ ...apiPayload("IT-RCP missing allocation"), allocations: [] })
        .expect(422)
        .expect(({ body }) => expect(body.reason).toBe("ALLOCATION_REQUIRED"));
      const direct = await agent
        .post("/api/v1/receipts")
        .set("X-CSRF-Token", csrf)
        .send({
          ...apiPayload("IT-RCP direct account"),
          customerId: null,
          counterAccountId: revenueId.toString(),
          allocations: [],
        })
        .expect(201);
      await agent
        .post(`/api/v1/receipts/${direct.body.id}/cancel`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, reason: "IT-RCP direct account cleanup" })
        .expect(200);
      const created = await agent
        .post("/api/v1/receipts")
        .set("X-CSRF-Token", csrf)
        .send(apiPayload("IT-RCP مسودة"))
        .expect(201);
      expect(created.body.baseAmount).toBe("200.0000");
      expect(created.body.allocations[0]).toMatchObject({ invoiceNumber: "IT-RCP-INVOICE", customerName: "عميل اختبار القبض", dueDate: "2043-03-01" });
      const updated = await agent
        .patch(`/api/v1/receipts/${created.body.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, notes: "ملاحظة معدلة" })
        .expect(200);
      expect(updated.body.document.version).toBe(1);
      await agent
        .post(`/api/v1/receipts/${created.body.id}/cancel`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 1, reason: "إلغاء سند تجريبي" })
        .expect(200);
    });
    it("posts idempotently, generates a balanced entry, reverses, and reserves concurrent numbers", async () => {
      const created = await agent
        .post("/api/v1/receipts")
        .set("X-CSRF-Token", csrf)
        .send(apiPayload("IT-RCP للترحيل"))
        .expect(201);
      const url = `/api/v1/receipts/${created.body.id}/post`;
      const [posted, replay] = await Promise.all([
        agent
          .post(url)
          .set("X-CSRF-Token", csrf)
          .set("Idempotency-Key", "post-receipt-concurrent")
          .send({ version: 0 })
          .expect(200),
        agent
          .post(url)
          .set("X-CSRF-Token", csrf)
          .set("Idempotency-Key", "post-receipt-concurrent")
          .send({ version: 0 })
          .expect(200),
      ]);
      expect(replay.body).toEqual(posted.body);
      const archivedBeforePrint = await prisma!.documentPrintArchive.findUniqueOrThrow({ where: { accountingDocumentId: BigInt(posted.body.document.id) } });
      expect(archivedBeforePrint.printCount).toBe(0);
      const company = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
      let firstPdf;
      try {
        await prisma!.company.update({ where: { id: companyId }, data: { name: `${company.name} (changed after posting)` } });
        firstPdf = await agent.get(`/api/v1/receipts/${created.body.id}/pdf`).expect("Content-Type", /application\/pdf/).expect(200);
      } finally {
        await prisma!.company.update({ where: { id: companyId }, data: { name: company.name } });
      }
      const secondPdf = await agent.get(`/api/v1/receipts/${created.body.id}/pdf`).expect(200);
      expect(Buffer.from(firstPdf.body).subarray(0, 4).toString()).toBe("%PDF");
      expect(firstPdf.headers["x-print-archive-hash"]).toBe(secondPdf.headers["x-print-archive-hash"]);
      const archivedAfterPrint = await prisma!.documentPrintArchive.findUniqueOrThrow({ where: { accountingDocumentId: BigInt(posted.body.document.id) } });
      expect(archivedAfterPrint.printCount).toBe(2);
      expect(archivedAfterPrint.snapshotHash).toBe(archivedBeforePrint.snapshotHash);
      expect((archivedAfterPrint.snapshot as { company: { name: string } }).company.name).toBe(company.name);
      const entry = await prisma!.journalEntry.findFirstOrThrow({
        where: { accountingDocumentId: BigInt(posted.body.document.id) },
        include: { lines: true },
      });
      expect(
        entry.lines.reduce(
          (sum, line) => sum + Number(line.baseDebitAmount),
          0,
        ),
      ).toBe(200);
      expect(
        entry.lines.reduce(
          (sum, line) => sum + Number(line.baseCreditAmount),
          0,
        ),
      ).toBe(200);
      const excessive = await agent.post("/api/v1/receipts").set("X-CSRF-Token", csrf).send(apiPayload("IT-RCP over allocation")).expect(201);
      await agent.post(`/api/v1/receipts/${excessive.body.id}/post`).set("X-CSRF-Token", csrf).set("Idempotency-Key", "post-over-allocated-receipt").send({ version: 0 }).expect(422);
      const reversed = await agent
        .post(`/api/v1/receipts/${created.body.id}/reverse`)
        .set("X-CSRF-Token", csrf)
        .set("Idempotency-Key", "reverse-receipt-once")
        .send({
          version: 1,
          reversalDate: "2043-04-01",
          reason: "عكس اختبار سند القبض",
        });
      expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
      expect(reversed.body.document.status).toBe("REVERSED");
      const restoredItem = await prisma!.receivableItem.findUniqueOrThrow({ where: { id: receivableItemId } });
      expect(restoredItem.outstandingAmount.toFixed(4)).toBe(restoredItem.originalAmount.toFixed(4));
      expect(restoredItem.status).toBe("OPEN");
      expect(restoredItem.version).toBe(2);
      const concurrent = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          receiptService.create(
            { userId, companyId },
            servicePayload(`IT-RCP متزامن ${i}`),
          ),
        ),
      );
      expect(
        new Set(
          concurrent.map(
            (receipt) => receipt.accountingDocument.documentNumber,
          ),
      ).size,
      ).toBe(5);
    }, 20_000);
    it("records and exactly reverses a realized foreign-exchange loss", async () => {
      await Promise.all([
        prisma!.account.findFirstOrThrow({ where: { companyId, sourceTemplateCode: "SMALL_BUSINESS_GENERAL", sourceTemplateKey: "realized-fx-gain" } }),
        prisma!.account.findFirstOrThrow({ where: { companyId, sourceTemplateCode: "SMALL_BUSINESS_GENERAL", sourceTemplateKey: "realized-fx-loss" } }),
      ]);
      const foreignCurrency = await prisma!.currency.create({
        data: {
          code: "FXR",
          nameAr: "عملة فرق قبض اختبارية",
          decimals: 2,
          scope: "COMPANY",
          scopeKey: `COMPANY:${companyId}`,
          ownerCompanyId: companyId,
        },
      });
      foreignCurrencyId = foreignCurrency.id;
      await prisma!.companyCurrency.create({
        data: { companyId, currencyId: foreignCurrency.id },
      });
      const invoice = await prisma!.accountingDocument.create({
        data: {
          companyId,
          fiscalPeriodId: periodId,
          documentType: "SALES_INVOICE",
          documentNumber: "IT-RCP-FX-INVOICE",
          documentDate: new Date("2043-05-01"),
          description: "فاتورة عملة أجنبية مستهدفة",
          status: "POSTED",
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          salesInvoice: {
            create: {
              customerId,
              currencyId: foreignCurrency.id,
              exchangeRate: "1.30000000",
              dueDate: new Date("2043-05-31"),
              subtotal: "100.0000",
              discountTotal: "0.0000",
              taxableTotal: "100.0000",
              taxTotal: "0.0000",
              total: "100.0000",
              baseTotal: "130.0000",
              customerNameSnapshot: "عميل اختبار القبض",
            },
          },
          journalEntries: {
            create: [{
              entryNumber: 1,
              entryDate: new Date("2043-05-01"),
              description: "فاتورة عملة أجنبية مستهدفة",
              lines: {
                create: [{
                  lineNumber: 1,
                  accountId: arId,
                  customerId,
                  currencyId: foreignCurrency.id,
                  exchangeRate: "1.30000000",
                  debitAmount: "100.0000",
                  creditAmount: "0.0000",
                  baseDebitAmount: "130.0000",
                  baseCreditAmount: "0.0000",
                }, {
                  lineNumber: 2,
                  accountId: revenueId,
                  currencyId: foreignCurrency.id,
                  exchangeRate: "1.30000000",
                  debitAmount: "0.0000",
                  creditAmount: "100.0000",
                  baseDebitAmount: "0.0000",
                  baseCreditAmount: "130.0000",
                }],
              },
            }],
          },
        },
        include: { salesInvoice: true },
      });
      const item = await prisma!.receivableItem.create({
        data: {
          companyId,
          salesInvoiceId: invoice.salesInvoice!.id,
          customerId,
          currencyId: foreignCurrency.id,
          dueDate: new Date("2043-05-31"),
          originalAmount: "100.0000",
          outstandingAmount: "100.0000",
          originalBaseAmount: "130.0000",
          outstandingBaseAmount: "130.0000",
        },
      });
      const created = await agent
        .post("/api/v1/receipts")
        .set("X-CSRF-Token", csrf)
        .send({
          fiscalPeriodId: periodId.toString(),
          documentDate: "2043-06-01",
          description: "تحصيل بسعر صرف مختلف",
          customerId: customerId.toString(),
          cashBankAccountId: cashBankId.toString(),
          paymentMethodId: paymentMethodId.toString(),
          currencyId: foreignCurrency.id.toString(),
          exchangeRate: "1.25000000",
          amount: "100.0000",
          counterpartyName: "عميل اختبار القبض",
          allocations: [{
            receivableItemId: item.id.toString(),
            allocatedAmount: "100.0000",
          }],
        })
        .expect(201);
      await agent
        .post(`/api/v1/receipts/${created.body.id}/post`)
        .set("X-CSRF-Token", csrf)
        .set("Idempotency-Key", "post-realized-fx-receipt")
        .send({ version: 0 })
        .expect(200);
      const detail = await agent
        .get(`/api/v1/receipts/${created.body.id}`)
        .expect(200);
      expect(detail.body.realizedFxBaseAmount).toBe("-5.0000");
      expect(detail.body.allocations[0]).toMatchObject({
        carryingBaseAmount: "130.0000",
        settlementBaseAmount: "125.0000",
        realizedFxBaseAmount: "-5.0000",
      });
      const entry = await prisma!.journalEntry.findFirstOrThrow({
        where: { accountingDocumentId: BigInt(detail.body.document.id) },
        include: { lines: { include: { account: true } } },
      });
      const arLine = entry.lines.find((line) => line.accountId === arId)!;
      const lossLine = entry.lines.find((line) => line.account.sourceTemplateKey === "realized-fx-loss")!;
      expect(arLine.exchangeRate.toFixed(8)).toBe("1.30000000");
      expect(arLine.baseCreditAmount.toFixed(4)).toBe("130.0000");
      expect(lossLine.baseDebitAmount.toFixed(4)).toBe("5.0000");
      expect(entry.lines.reduce((sum, line) => sum + Number(line.baseDebitAmount), 0)).toBe(130);
      expect(entry.lines.reduce((sum, line) => sum + Number(line.baseCreditAmount), 0)).toBe(130);
      await agent
        .post(`/api/v1/receipts/${created.body.id}/reverse`)
        .set("X-CSRF-Token", csrf)
        .set("Idempotency-Key", "reverse-realized-fx-receipt")
        .send({ version: 1, reversalDate: "2043-06-02", reason: "عكس فرق العملة الاختباري" })
        .expect(200);
      const restored = await prisma!.receivableItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(restored.outstandingAmount.toFixed(4)).toBe("100.0000");
      expect(restored.outstandingBaseAmount.toFixed(4)).toBe("130.0000");
      expect(restored.status).toBe("OPEN");
    });
  },
);
