import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { InventoryService } from "../src/inventory/inventory-service.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)("Inventory warehouse ownership, concurrency and company isolation", () => {
  let agent: ReturnType<typeof request.agent>;
  let csrf = "";
  let companyId: bigint;
  let userId: bigint;
  let foreignCompanyId: bigint | undefined;
  const warehouseIds: bigint[] = [];

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" },
    });
    userId = user.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({
      where: { userId, isActive: true },
    })).companyId;

    const auth = new AuthService(
      new PrismaAuthStore(prisma!),
      { verify },
      { preAuthTtlMinutes: 10, sessionTtlHours: 12 },
    );
    const app = createApp({
      NODE_ENV: "test",
      PORT: 3000,
      WEB_ORIGIN: "http://localhost:5173",
      SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10,
      SESSION_TTL_HOURS: 12,
      DATABASE_URL: databaseUrl,
    }, { auth, inventory: new InventoryService(prisma!) });
    agent = request.agent(app);
    csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken;
    csrf = (await agent.post("/api/v1/auth/login")
      .set("X-CSRF-Token", csrf)
      .send({ email: "admin@mcap.local", password })
      .expect(200)).body.csrfToken;
    await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context")
      .set("X-CSRF-Token", csrf)
      .send({ companyId: companyId.toString() })
      .expect(204);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditLog.deleteMany({
      where: {
        entityType: "WAREHOUSE",
        OR: [
          { companyId, entityId: { in: warehouseIds.map(String) } },
          ...(foreignCompanyId ? [{ companyId: foreignCompanyId }] : []),
        ],
      },
    });
    if (warehouseIds.length) {
      await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds }, companyId } });
    }
    if (foreignCompanyId) {
      await prisma.warehouse.deleteMany({ where: { companyId: foreignCompanyId } });
      await prisma.masterDataCodeSequence.deleteMany({ where: { companyId: foreignCompanyId } });
      await prisma.company.delete({ where: { id: foreignCompanyId } });
    }
    await prisma.$disconnect();
  });

  async function createWarehouse(nameAr: string) {
    const response = await agent.post("/api/v1/warehouses")
      .set("X-CSRF-Token", csrf)
      .send({ nameAr })
      .expect(201);
    warehouseIds.push(BigInt(response.body.id));
    return response.body as { id: string; code: string; nameAr: string; version: number };
  }

  it("creates server-coded warehouses, audits them and rejects client codes", async () => {
    const created = await agent.post("/api/v1/warehouses")
      .set("X-CSRF-Token", csrf)
      .send({ nameAr: "المستودع الرئيسي", nameEn: "Main warehouse", address: "الرياض" })
      .expect(201);
    warehouseIds.push(BigInt(created.body.id));
    expect(created.body).toMatchObject({
      code: expect.stringMatching(/^WH-[0-9]{6,}$/u),
      nameAr: "المستودع الرئيسي",
      nameEn: "Main warehouse",
      address: "الرياض",
      isActive: true,
      version: 0,
    });
    await agent.post("/api/v1/warehouses")
      .set("X-CSRF-Token", csrf)
      .send({ code: "MANUAL", nameAr: "رمز يدوي مرفوض" })
      .expect(400);
    expect(await prisma!.auditLog.count({
      where: { companyId, action: "WAREHOUSE_CREATED", entityId: created.body.id },
    })).toBe(1);
  });

  it("reserves unique codes under concurrent creation", async () => {
    const service = new InventoryService(prisma!);
    const created = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      service.createWarehouse({ userId, companyId }, { nameAr: `مستودع تزامن ${index + 1}` }),
    ));
    warehouseIds.push(...created.map(({ id }) => id));
    expect(new Set(created.map(({ code }) => code)).size).toBe(created.length);
    expect(created.every(({ code }) => /^WH-[0-9]{6,}$/u.test(code))).toBe(true);
  });

  it("allows only one concurrent update and deactivates with an audited reason", async () => {
    const created = await createWarehouse("مستودع سباق التعديل");
    const responses = await Promise.all([
      agent.patch(`/api/v1/warehouses/${created.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "التحديث الأول" }),
      agent.patch(`/api/v1/warehouses/${created.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "التحديث الثاني" }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const current = await agent.get(`/api/v1/warehouses/${created.id}`).expect(200);
    expect(current.body.version).toBe(1);
    const deactivated = await agent.post(`/api/v1/warehouses/${created.id}/deactivate`)
      .set("X-CSRF-Token", csrf)
      .send({ version: 1, reason: "إيقاف موقع الاختبار" })
      .expect(200);
    expect(deactivated.body).toMatchObject({ isActive: false, version: 2 });
    const audit = await prisma!.auditLog.findFirstOrThrow({
      where: { companyId, action: "WAREHOUSE_DEACTIVATED", entityId: created.id },
    });
    expect(audit.details).toMatchObject({ reason: "إيقاف موقع الاختبار", fromVersion: 1, toVersion: 2 });
  });

  it("does not expose or mutate a warehouse owned by another company", async () => {
    const base = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    const foreign = await prisma!.company.create({
      data: {
        organizationId: base.organizationId,
        baseCurrencyId: base.baseCurrencyId,
        name: "شركة مستودعات أجنبية",
        timezone: "Asia/Riyadh",
      },
    });
    foreignCompanyId = foreign.id;
    const service = new InventoryService(prisma!);
    const foreignWarehouse = await service.createWarehouse(
      { userId, companyId: foreign.id },
      { nameAr: "مستودع الشركة الأخرى" },
    );
    expect(foreignWarehouse.code).toBe("WH-000001");
    await agent.get(`/api/v1/warehouses/${foreignWarehouse.id}`).expect(404);
    await agent.patch(`/api/v1/warehouses/${foreignWarehouse.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ version: 0, nameAr: "محاولة عابرة" })
      .expect(404);
    const list = await agent.get("/api/v1/warehouses?page=1&pageSize=100").expect(200);
    expect(list.body.data.some(({ id }: { id: string }) => id === foreignWarehouse.id.toString())).toBe(false);
  });
});
