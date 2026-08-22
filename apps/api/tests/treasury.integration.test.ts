import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { TreasuryService } from "../src/treasury/treasury-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)("Treasury ownership, concurrency and company isolation", () => {
  let app: ReturnType<typeof createApp>;
  let agent: ReturnType<typeof request.agent>;
  let csrf = "";
  let companyId: bigint;
  let userId: bigint;
  let ledgerAccountId: bigint;
  const cashIds: bigint[] = [];
  const methodIds: bigint[] = [];

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" },
    });
    userId = user.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({
      where: { userId, isActive: true },
    })).companyId;
    const assetType = await prisma!.accountType.findFirstOrThrow({ where: { code: "ASSET" } });
    ledgerAccountId = (await prisma!.account.upsert({
      where: { companyId_code: { companyId, code: "IT-TREASURY-LEDGER" } },
      update: { isActive: true, allowsPosting: true },
      create: {
        companyId,
        accountTypeId: assetType.id,
        code: "IT-TREASURY-LEDGER",
        nameAr: "حساب خزينة تكاملي",
        level: 1,
        allowsPosting: true,
      },
    })).id;

    const auth = new AuthService(
      new PrismaAuthStore(prisma!),
      { verify },
      { preAuthTtlMinutes: 10, sessionTtlHours: 12 },
    );
    const treasury = new TreasuryService(prisma!);
    app = createApp({
      NODE_ENV: "test",
      PORT: 3000,
      WEB_ORIGIN: "http://localhost:5173",
      SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10,
      SESSION_TTL_HOURS: 12,
      DATABASE_URL: databaseUrl,
    }, { auth, treasury });
    agent = request.agent(app);
    csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken;
    csrf = (await agent.post("/api/v1/auth/login")
      .set("X-CSRF-Token", csrf)
      .send({ email: "admin@mcap.local", password })
      .expect(200)).body.csrfToken;
    const companies = await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context")
      .set("X-CSRF-Token", csrf)
      .send({ companyId: companies.body.data[0].id })
      .expect(204);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditLog.deleteMany({
      where: {
        companyId,
        entityType: { in: ["CASH_BANK_ACCOUNT", "PAYMENT_METHOD"] },
        entityId: { in: [...cashIds, ...methodIds].map(String) },
      },
    });
    if (cashIds.length) await prisma.cashBankAccount.deleteMany({ where: { id: { in: cashIds } } });
    if (methodIds.length) await prisma.paymentMethod.deleteMany({ where: { id: { in: methodIds } } });
    if (ledgerAccountId) await prisma.account.deleteMany({ where: { id: ledgerAccountId } });
    await prisma.$disconnect();
  });

  async function createCash(nameAr: string) {
    const response = await agent.post("/api/v1/cash-bank-accounts")
      .set("X-CSRF-Token", csrf)
      .send({
        ledgerAccountId: ledgerAccountId.toString(),
        accountType: "CASH",
        nameAr,
      })
      .expect(201);
    cashIds.push(BigInt(response.body.id));
    return response.body as { id: string; code: string; version: number; nameAr: string };
  }

  async function createMethod(nameAr: string) {
    const response = await agent.post("/api/v1/payment-methods")
      .set("X-CSRF-Token", csrf)
      .send({ nameAr, requiresReference: false })
      .expect(201);
    methodIds.push(BigInt(response.body.id));
    return response.body as { id: string; code: string; version: number; nameAr: string };
  }

  it("owns creation, masked serialization and versioned deactivation", async () => {
    const created = await agent.post("/api/v1/cash-bank-accounts")
      .set("X-CSRF-Token", csrf)
      .send({
        ledgerAccountId: ledgerAccountId.toString(),
        accountType: "BANK",
        nameAr: "بنك خزينة تكاملي",
        bankName: "مصرف الاختبار",
        accountNumber: "1234567890",
        iban: "SA001234567890",
      })
      .expect(201);
    cashIds.push(BigInt(created.body.id));
    expect(created.body).toMatchObject({
      version: 0,
      accountNumberMasked: "****7890",
      ibanMasked: "****7890",
    });
    expect(created.body).not.toHaveProperty("accountNumber");
    const deactivated = await agent.post(`/api/v1/cash-bank-accounts/${created.body.id}/deactivate`)
      .set("X-CSRF-Token", csrf)
      .send({ version: 0, reason: "تعطيل مرجع تكاملي" })
      .expect(200);
    expect(deactivated.body).toMatchObject({ isActive: false, version: 1 });
    await agent.post(`/api/v1/cash-bank-accounts/${created.body.id}/deactivate`)
      .set("X-CSRF-Token", csrf)
      .send({ version: 0, reason: "نسخة قديمة" })
      .expect(409);
  });

  it("allows only one of two concurrent cash-account updates", async () => {
    const created = await createCash("صندوق سباق تكاملي");
    const responses = await Promise.all([
      agent.patch(`/api/v1/cash-bank-accounts/${created.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "الفائز الأول" }),
      agent.patch(`/api/v1/cash-bank-accounts/${created.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "الفائز الثاني" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const persisted = await agent.get(`/api/v1/cash-bank-accounts/${created.id}`).expect(200);
    expect(persisted.body.version).toBe(1);
    expect(["الفائز الأول", "الفائز الثاني"]).toContain(persisted.body.nameAr);
  });

  it("allows only one of two concurrent company payment-method updates", async () => {
    const created = await createMethod("طريقة سباق تكاملية");
    const responses = await Promise.all([
      agent.patch(`/api/v1/payment-methods/${created.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "طريقة أولى" }),
      agent.patch(`/api/v1/payment-methods/${created.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "طريقة ثانية" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const persisted = await prisma!.paymentMethod.findUniqueOrThrow({
      where: { id: BigInt(created.id) },
    });
    expect(persisted.version).toBe(1);
    expect(["طريقة أولى", "طريقة ثانية"]).toContain(persisted.nameAr);
  });

  it("does not expose or mutate Treasury references owned by another company", async () => {
    const base = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    const accountType = await prisma!.accountType.findFirstOrThrow({ where: { code: "ASSET" } });
    const foreignCompany = await prisma!.company.create({
      data: {
        organizationId: base.organizationId,
        baseCurrencyId: base.baseCurrencyId,
        name: "شركة خزينة أجنبية",
        timezone: "Asia/Riyadh",
      },
    });
    const foreignLedger = await prisma!.account.create({
      data: {
        companyId: foreignCompany.id,
        accountTypeId: accountType.id,
        code: "IT-FOREIGN-TREASURY",
        nameAr: "حساب أجنبي",
        level: 1,
        allowsPosting: true,
      },
    });
    const foreignCash = await prisma!.cashBankAccount.create({
      data: {
        companyId: foreignCompany.id,
        ledgerAccountId: foreignLedger.id,
        accountType: "CASH",
        code: "IT-FOREIGN-CASH",
        nameAr: "صندوق أجنبي",
      },
    });
    const foreignMethod = await prisma!.paymentMethod.create({
      data: {
        companyId: foreignCompany.id,
        scope: "COMPANY",
        code: `IT-FOREIGN-METHOD-${foreignCompany.id}`,
        nameAr: "طريقة أجنبية",
      },
    });
    try {
      await agent.get(`/api/v1/cash-bank-accounts/${foreignCash.id}`).expect(404);
      await agent.patch(`/api/v1/cash-bank-accounts/${foreignCash.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "محاولة عابرة" })
        .expect(404);
      await agent.patch(`/api/v1/payment-methods/${foreignMethod.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "محاولة عابرة" })
        .expect(404);
      await agent.post("/api/v1/cash-bank-accounts")
        .set("X-CSRF-Token", csrf)
        .send({
          ledgerAccountId: foreignLedger.id.toString(),
          accountType: "CASH",
          nameAr: "ربط غير صالح",
        })
        .expect(422);
    } finally {
      await prisma!.paymentMethod.delete({ where: { id: foreignMethod.id } });
      await prisma!.cashBankAccount.delete({ where: { id: foreignCash.id } });
      await prisma!.account.delete({ where: { id: foreignLedger.id } });
      await prisma!.company.delete({ where: { id: foreignCompany.id } });
    }
  });
});
