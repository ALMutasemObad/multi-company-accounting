import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { SupplierReferenceService } from "../src/suppliers/supplier-service.js";
import {
  PaymentService,
  type PaymentInput,
} from "../src/payments/payment-service.js";
import { ReportService } from "../src/reports/report-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;
describe.runIf(enabled)(
  "payment lifecycle and reference data with MariaDB",
  () => {
    let app: ReturnType<typeof createApp>;
    let companyId: bigint;
    let userId: bigint;
    let yearId: bigint;
    let periodId: bigint;
    let currencyId: bigint;
    let apId: bigint;
    let expenseId: bigint;
    let cashLedgerId: bigint;
    let supplierId: bigint;
    let cashBankId: bigint;
    let paymentMethodId: bigint;
    let targetLineId: bigint;
    let agent: ReturnType<typeof request.agent>;
    let csrf = "";
    let paymentService: PaymentService;
    async function removeYear(id: bigint) {
      await prisma!.paymentAllocation.deleteMany({
        where: {
          companyId,
          payment: {
            accountingDocument: { fiscalPeriod: { fiscalYearId: id } },
          },
        },
      });
      await prisma!.payment.deleteMany({
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
    const apiPayload = (description = "Test text") => ({
      fiscalPeriodId: periodId.toString(),
      documentDate: "2043-03-10",
      description,
      supplierId: supplierId.toString(),
      cashBankAccountId: cashBankId.toString(),
      paymentMethodId: paymentMethodId.toString(),
      currencyId: currencyId.toString(),
      exchangeRate: "1.00000000",
      amount: "200.0000",
      counterpartyName: "Test text",
      counterpartyTaxNumber: "9876543210",
      allocations: [
        {
          targetJournalLineId: targetLineId.toString(),
          allocatedAmount: "200.0000",
        },
      ],
    });
    const servicePayload = (description: string): PaymentInput => ({
      fiscalPeriodId: periodId,
      documentDate: "2043-03-10",
      description,
      supplierId,
      cashBankAccountId: cashBankId,
      paymentMethodId,
      currencyId,
      exchangeRate: "1.00000000",
      amount: "200.0000",
      counterpartyName: "Test text",
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
      currencyId = (
        await prisma!.company.findUniqueOrThrow({ where: { id: companyId } })
      ).baseCurrencyId;
      const abandoned = await prisma!.fiscalYear.findFirst({
        where: { companyId, name: "IT-PAY-2043" },
      });
      if (abandoned) await removeYear(abandoned.id);
      await prisma!.supplierAddress.deleteMany({
        where: { companyId, supplier: { code: "IT-PAY-CUST" } },
      });
      await prisma!.supplier.deleteMany({
        where: { companyId, code: "IT-PAY-CUST" },
      });
      await prisma!.cashBankAccount.deleteMany({
        where: { companyId, code: "IT-PAY-CASH" },
      });
      const type = await prisma!.accountType.findFirstOrThrow();
      apId = (
        await prisma!.account.upsert({
          where: { companyId_code: { companyId, code: "IT-PAY-AR" } },
          update: { isActive: true, allowsPosting: true },
          create: {
            companyId,
            accountTypeId: type.id,
            code: "IT-PAY-AR",
            nameAr: "Test text",
            level: 1,
            allowsPosting: true,
          },
        })
      ).id;
      expenseId = (
        await prisma!.account.upsert({
          where: { companyId_code: { companyId, code: "IT-PAY-REV" } },
          update: { isActive: true, allowsPosting: true },
          create: {
            companyId,
            accountTypeId: type.id,
            code: "IT-PAY-REV",
            nameAr: "Test text",
            level: 1,
            allowsPosting: true,
          },
        })
      ).id;
      cashLedgerId = (
        await prisma!.account.upsert({
          where: { companyId_code: { companyId, code: "IT-PAY-CASH-GL" } },
          update: { isActive: true, allowsPosting: true },
          create: {
            companyId,
            accountTypeId: type.id,
            code: "IT-PAY-CASH-GL",
            nameAr: "Test text",
            level: 1,
            allowsPosting: true,
          },
        })
      ).id;
      const year = await prisma!.fiscalYear.create({
        data: {
          companyId,
          name: "IT-PAY-2043",
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
      paymentService = new PaymentService(prisma!);
      const references = new SupplierReferenceService(prisma!);
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
        { auth, suppliers: references, payments: paymentService, reports: new ReportService(prisma!) },
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
      const supplier = await agent
        .post("/api/v1/suppliers")
        .set("X-CSRF-Token", csrf)
        .send({
          payableAccountId: apId.toString(),
          nameAr: "Test text",
          taxNumber: "1234567890",
          addresses: [
            {
              addressType: "PAYMENT",
              line1: "Test text",
              countryCode: "SA",
              isPrimary: true,
            },
          ],
        })
        .expect(201);
      supplierId = BigInt(supplier.body.id);
      expect(supplier.body.code).toMatch(/^SUP-[0-9]{6,}$/);
      expect(supplier.body.taxNumberMasked).toBe("****7890");
      cashBankId = (
        await prisma!.cashBankAccount.create({
          data: {
            companyId,
            ledgerAccountId: cashLedgerId,
            accountType: "CASH",
            code: "IT-PAY-CASH",
            nameAr: "Test cash account",
          },
        })
      ).id;
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
          documentNumber: "IT-PAY-INVOICE",
          documentDate: new Date("2043-02-01"),
          description: "Test text",
          status: "POSTED",
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
          journalEntries: {
            create: [
              {
                entryNumber: 1,
                entryDate: new Date("2043-02-01"),
                description: "Test text",
                lines: {
                  create: [
                    {
                      lineNumber: 1,
                      accountId: apId,
                      supplierId,
                      currencyId,
                      exchangeRate: "1.00000000",
                      debitAmount: "0.0000",
                      creditAmount: "200.0000",
                      baseDebitAmount: "0.0000",
                      baseCreditAmount: "200.0000",
                    },
                    {
                      lineNumber: 2,
                      accountId: expenseId,
                      currencyId,
                      exchangeRate: "1.00000000",
                      debitAmount: "200.0000",
                      creditAmount: "0.0000",
                      baseDebitAmount: "200.0000",
                      baseCreditAmount: "0.0000",
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
          operation: { in: ["POST_PAYMENT", "REVERSE_PAYMENT"] },
        },
      });
      await prisma.auditLog.deleteMany({
        where: {
          companyId,
          entityType: {
            in: [
              "PAYMENT",
              "SUPPLIER",
              "SUPPLIER_ADDRESS",
              "CASH_BANK_ACCOUNT",
            ],
          },
        },
      });
      if (yearId) await removeYear(yearId);
      await prisma.supplierAddress.deleteMany({
        where: { companyId, supplierId },
      });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.cashBankAccount.deleteMany({ where: { id: cashBankId } });
      await prisma.account.deleteMany({
        where: { id: { in: [apId, expenseId, cashLedgerId] } },
      });
      await prisma.$disconnect();
    });
    it("manages supplier and treasury reference data with company isolation", async () => {
      const supplier = await agent
        .get(`/api/v1/suppliers/${supplierId}`)
        .expect(200);
      expect(supplier.body.addresses).toHaveLength(1);
      const updated = await agent
        .patch(`/api/v1/suppliers/${supplierId}`)
        .set("X-CSRF-Token", csrf)
        .send({ phone: "0500000000" })
        .expect(200);
      expect(updated.body.phone).toBe("0500000000");
      const address = await agent
        .post(`/api/v1/suppliers/${supplierId}/addresses`)
        .set("X-CSRF-Token", csrf)
        .send({
          addressType: "OTHER",
          line1: "Secondary address",
          countryCode: "SA",
        })
        .expect(201);
      await agent
        .patch(
          `/api/v1/suppliers/${supplierId}/addresses/${address.body.id}`,
        )
        .set("X-CSRF-Token", csrf)
        .send({ city: "Riyadh" })
        .expect(200)
        .then((result) => expect(result.body.city).toBe("Riyadh"));
      await agent
        .delete(
          `/api/v1/suppliers/${supplierId}/addresses/${address.body.id}`,
        )
        .set("X-CSRF-Token", csrf)
        .expect(204);
      expect(
        await prisma!.paymentMethod.findUnique({ where: { code: "CASH" } }),
      ).not.toBeNull();
      const base = await prisma!.company.findUniqueOrThrow({
        where: { id: companyId },
      });
      const foreign = await prisma!.company.create({
        data: {
          organizationId: base.organizationId,
          baseCurrencyId: base.baseCurrencyId,
          name: "Test text",
          timezone: "Asia/Riyadh",
        },
      });
      const foreignSupplier = await prisma!.supplier
        .create({
          data: {
            companyId: foreign.id,
            payableAccountId: apId,
            code: "FOREIGN",
            nameAr: "Test text",
          },
        })
        .catch(() => null);
      try {
        expect(foreignSupplier).toBeNull();
        await agent
          .get("/api/v1/suppliers")
          .query({ search: "FOREIGN" })
          .expect(200)
          .then((result) => expect(result.body.data).toHaveLength(0));
      } finally {
        await prisma!.company.delete({ where: { id: foreign.id } });
      }
    });
    it("generates immutable unique supplier codes under concurrent creation", async () => {
      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          agent
            .post("/api/v1/suppliers")
            .set("X-CSRF-Token", csrf)
            .send({
              payableAccountId: apId.toString(),
              nameAr: `Concurrent supplier ${index + 1}`,
            }),
        ),
      );
      expect(responses.every((response) => response.status === 201)).toBe(true);
      const codes = responses.map((response) => response.body.code as string);
      const ids = responses.map((response) => response.body.id as string);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes.every((code) => /^SUP-[0-9]{6,}$/.test(code))).toBe(true);

      try {
        await agent
          .patch(`/api/v1/suppliers/${ids[0]}`)
          .set("X-CSRF-Token", csrf)
          .send({ code: "MANUAL-CODE" })
          .expect(400);
        const persisted = await agent
          .get(`/api/v1/suppliers/${ids[0]}`)
          .expect(200);
        expect(persisted.body.code).toBe(codes[0]);
      } finally {
        await prisma!.auditLog.deleteMany({
          where: { companyId, entityType: "SUPPLIER", entityId: { in: ids } },
        });
        await prisma!.supplier.deleteMany({
          where: { companyId, id: { in: ids.map(BigInt) } },
        });
      }
    });
    it("validates allocation totals, updates a draft and cancels it", async () => {
      const invalid = apiPayload("Test text");
      invalid.allocations[0]!.allocatedAmount = "199.0000";
      await agent
        .post("/api/v1/payments")
        .set("X-CSRF-Token", csrf)
        .send(invalid)
        .expect(422);
      const invalidRate = apiPayload("IT-PAY invalid exchange rate");
      invalidRate.exchangeRate = "2.00000000";
      await agent.post("/api/v1/payments").set("X-CSRF-Token", csrf).send(invalidRate).expect(422);
      await agent.post("/api/v1/payments").set("X-CSRF-Token", csrf).send({ ...apiPayload("IT-PAY duplicate counterparty"), counterAccountId: expenseId.toString() }).expect(400);
      const created = await agent
        .post("/api/v1/payments")
        .set("X-CSRF-Token", csrf)
        .send(apiPayload("Test text"))
        .expect(201);
      expect(created.body.baseAmount).toBe("200.0000");
      expect(created.body.counterpartyTaxMasked).toBe("****3210");
      const updated = await agent
        .patch(`/api/v1/payments/${created.body.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, notes: "Test text" })
        .expect(200);
      expect(updated.body.document.version).toBe(1);
      await agent
        .post(`/api/v1/payments/${created.body.id}/cancel`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 1, reason: "Test text" })
        .expect(200);
    });
    it("posts idempotently, generates a balanced entry, reverses, and reserves concurrent numbers", async () => {
      const created = await agent
        .post("/api/v1/payments")
        .set("X-CSRF-Token", csrf)
        .send(apiPayload("Test text"))
        .expect(201);
      const url = `/api/v1/payments/${created.body.id}/post`;
      const [posted, replay] = await Promise.all([
        agent
          .post(url)
          .set("X-CSRF-Token", csrf)
          .set("Idempotency-Key", "post-payment-concurrent")
          .send({ version: 0 })
          .expect(200),
        agent
          .post(url)
          .set("X-CSRF-Token", csrf)
          .set("Idempotency-Key", "post-payment-concurrent")
          .send({ version: 0 })
          .expect(200),
      ]);
      expect(replay.body).toEqual(posted.body);
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
      const excessive = await agent.post("/api/v1/payments").set("X-CSRF-Token", csrf).send(apiPayload("IT-PAY over allocation")).expect(201);
      await agent.post(`/api/v1/payments/${excessive.body.id}/post`).set("X-CSRF-Token", csrf).set("Idempotency-Key", "post-over-allocated-payment").send({ version: 0 }).expect(422);
      const reversed = await agent
        .post(`/api/v1/payments/${created.body.id}/reverse`)
        .set("X-CSRF-Token", csrf)
        .set("Idempotency-Key", "reverse-payment-once")
        .send({
          version: 1,
          reversalDate: "2043-04-01",
          reason: "Test text",
        })
        .expect(200);
      expect(reversed.body.document.status).toBe("REVERSED");
      const dashboard = await agent
        .get("/api/v1/reports/dashboard")
        .query({ dateFrom: "2043-01-01", dateTo: "2043-12-31" })
        .expect(200);
      expect(dashboard.body.metrics.payments).toBe("0.0000");
      expect(dashboard.body.cashFlow).toEqual(expect.arrayContaining([
        expect.objectContaining({ month: "2043-03", payments: "200.0000" }),
        expect.objectContaining({ month: "2043-04", payments: "-200.0000" }),
      ]));
      const concurrent = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          paymentService.create(
            { userId, companyId },
            servicePayload(`IT-PAY concurrent ${i}`),
          ),
        ),
      );
      expect(
        new Set(
          concurrent.map(
            (payment) => payment.accountingDocument.documentNumber,
          ),
        ).size,
      ).toBe(5);
    });
  },
);
