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
    let targetLineId: bigint;
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
          targetJournalLineId: targetLineId.toString(),
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
        { targetJournalLineId: targetLineId, allocatedAmount: "200.0000" },
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
      receiptService = new ReceiptService(prisma!);
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
        { auth, receiptReferences: references, receipts: receiptService, printing: new PrintService(prisma!) },
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
          code: "IT-RCP-CUST",
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
      expect(customer.body.taxNumberMasked).toBe("****7890");
      const cashBank = await agent
        .post("/api/v1/cash-bank-accounts")
        .set("X-CSRF-Token", csrf)
        .send({
          ledgerAccountId: cashLedgerId.toString(),
          accountType: "CASH",
          code: "IT-RCP-CASH",
          nameAr: "صندوق القبض",
          accountNumber: "99887766",
        })
        .expect(201);
      expect(cashBank.body.accountNumberMasked).toBe("****7766");
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
          documentType: "MANUAL_JOURNAL",
          documentNumber: "IT-RCP-INVOICE",
          documentDate: new Date("2043-02-01"),
          description: "فاتورة مستهدفة",
          status: "POSTED",
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
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
        include: { journalEntries: { include: { lines: true } } },
      });
      targetLineId = invoice.journalEntries[0]!.lines[0]!.id;
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
    it("manages company payment methods without allowing global reference edits", async () => {
      await prisma!.paymentMethod.deleteMany({ where: { companyId, code: "IT_RCP_WIRE" } });
      const created = await agent.post("/api/v1/payment-methods").set("X-CSRF-Token", csrf).send({ code: "IT_RCP_WIRE", nameAr: "تحويل اختبار", requiresReference: true }).expect(201);
      expect(created.body.scope).toBe("COMPANY");
      await agent.patch(`/api/v1/payment-methods/${created.body.id}`).set("X-CSRF-Token", csrf).send({ nameAr: "تحويل اختبار محدث" }).expect(200).then((result) => expect(result.body.nameAr).toContain("محدث"));
      const global = await prisma!.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
      await agent.patch(`/api/v1/payment-methods/${global.id}`).set("X-CSRF-Token", csrf).send({ nameAr: "ممنوع" }).expect(422);
      await agent.post(`/api/v1/payment-methods/${created.body.id}/deactivate`).set("X-CSRF-Token", csrf).send({ reason: "تعطيل اختباري" }).expect(200).then((result) => expect(result.body.isActive).toBe(false));
      const all = await agent.get("/api/v1/payment-methods?includeInactive=true").expect(200);
      expect(all.body.data.some((method: any) => method.id === created.body.id && !method.isActive)).toBe(true);
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
      const created = await agent
        .post("/api/v1/receipts")
        .set("X-CSRF-Token", csrf)
        .send(apiPayload("IT-RCP مسودة"))
        .expect(201);
      expect(created.body.baseAmount).toBe("200.0000");
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
    });
  },
);
