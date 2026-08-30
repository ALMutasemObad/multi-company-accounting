import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import {
  InventoryCatalogError,
  InventoryCatalogService,
} from "../src/inventory/inventory-catalog-service.js";
import { testAuthOptions } from "./helpers/test-auth-options.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const prisma = enabled ? createDatabase(databaseUrl) : null;

describe.runIf(enabled)("Inventory catalog ownership, concurrency and company isolation", () => {
  let agent: ReturnType<typeof request.agent>;
  let csrf = "";
  let companyId: bigint;
  let userId: bigint;
  let foreignCompanyId: bigint | undefined;
  const unitIds: bigint[] = [];
  const itemIds: bigint[] = [];

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
      testAuthOptions(prisma!),
    );
    const app = createApp({
      NODE_ENV: "test",
      PORT: 3000,
      WEB_ORIGIN: "http://localhost:5173",
      SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10,
      SESSION_TTL_HOURS: 12,
      DATABASE_URL: databaseUrl,
    }, { auth, inventoryCatalog: new InventoryCatalogService(prisma!) });
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
        entityType: { in: ["UNIT_OF_MEASURE", "INVENTORY_ITEM"] },
        OR: [
          { companyId, entityId: { in: [...unitIds, ...itemIds].map(String) } },
          ...(foreignCompanyId ? [{ companyId: foreignCompanyId }] : []),
        ],
      },
    });
    if (itemIds.length) {
      await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds }, companyId } });
    }
    if (unitIds.length) {
      await prisma.unitOfMeasure.deleteMany({ where: { id: { in: unitIds }, companyId } });
    }
    if (foreignCompanyId) {
      await prisma.inventoryItem.deleteMany({ where: { companyId: foreignCompanyId } });
      await prisma.unitOfMeasure.deleteMany({ where: { companyId: foreignCompanyId } });
      await prisma.masterDataCodeSequence.deleteMany({ where: { companyId: foreignCompanyId } });
      await prisma.company.delete({ where: { id: foreignCompanyId } });
    }
    await prisma.$disconnect();
  });

  async function createUnit(code: string, nameAr = `وحدة ${code}`) {
    const response = await agent.post("/api/v1/units-of-measure")
      .set("X-CSRF-Token", csrf)
      .send({ code, nameAr, decimalPlaces: 2 })
      .expect(201);
    unitIds.push(BigInt(response.body.id));
    return response.body as {
      id: string;
      code: string;
      nameAr: string;
      decimalPlaces: number;
      version: number;
      isActive: boolean;
    };
  }

  async function createItem(unitOfMeasureId: string, nameAr: string) {
    const response = await agent.post("/api/v1/inventory-items")
      .set("X-CSRF-Token", csrf)
      .send({ unitOfMeasureId, nameAr })
      .expect(201);
    itemIds.push(BigInt(response.body.id));
    return response.body as {
      id: string;
      code: string;
      nameAr: string;
      version: number;
      isActive: boolean;
      unitOfMeasure: { id: string; code: string };
    };
  }

  it("creates semantic units and server-coded items with immutable request codes", async () => {
    const unit = await createUnit("ea", "حبة");
    expect(unit).toMatchObject({ code: "EA", nameAr: "حبة", decimalPlaces: 2, version: 0 });
    const item = await agent.post("/api/v1/inventory-items")
      .set("X-CSRF-Token", csrf)
      .send({ unitOfMeasureId: unit.id, nameAr: "قلم", nameEn: "Pen", description: "قلم أزرق" })
      .expect(201);
    itemIds.push(BigInt(item.body.id));
    expect(item.body).toMatchObject({
      code: expect.stringMatching(/^ITM-[0-9]{6,}$/u),
      nameAr: "قلم",
      nameEn: "Pen",
      description: "قلم أزرق",
      isActive: true,
      version: 0,
      unitOfMeasure: { id: unit.id, code: "EA" },
    });
    await agent.post("/api/v1/inventory-items")
      .set("X-CSRF-Token", csrf)
      .send({ code: "MANUAL", unitOfMeasureId: unit.id, nameAr: "رمز مرفوض" })
      .expect(400);
    expect(await prisma!.auditLog.count({
      where: { companyId, action: "INVENTORY_ITEM_CREATED", entityId: item.body.id },
    })).toBe(1);
  });

  it("enforces unique unit codes and reserves unique item codes under concurrency", async () => {
    const unit = await createUnit("box", "صندوق");
    await agent.post("/api/v1/units-of-measure")
      .set("X-CSRF-Token", csrf)
      .send({ code: "BOX", nameAr: "صندوق مكرر", decimalPlaces: 0 })
      .expect(409);
    const service = new InventoryCatalogService(prisma!);
    const created = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      service.createItem(
        { userId, companyId },
        { unitOfMeasureId: BigInt(unit.id), nameAr: `صنف تزامن ${index + 1}` },
      ),
    ));
    itemIds.push(...created.map(({ id }) => id));
    expect(new Set(created.map(({ code }) => code)).size).toBe(created.length);
    expect(created.every(({ code }) => /^ITM-[0-9]{6,}$/u.test(code))).toBe(true);
  });

  it("allows one optimistic update and blocks disabling a unit used by an active item", async () => {
    const unit = await createUnit("kg", "كيلوجرام");
    const item = await createItem(unit.id, "مادة موزونة");
    const updates = await Promise.all([
      agent.patch(`/api/v1/inventory-items/${item.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "التحديث الأول" }),
      agent.patch(`/api/v1/inventory-items/${item.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ version: 0, nameAr: "التحديث الثاني" }),
    ]);
    expect(updates.map(({ status }) => status).sort()).toEqual([200, 409]);
    await agent.post(`/api/v1/units-of-measure/${unit.id}/deactivate`)
      .set("X-CSRF-Token", csrf)
      .send({ version: 0, reason: "اختبار وحدة مستخدمة" })
      .expect(422)
      .expect(({ body }) => expect(body.reason).toBe("UNIT_IN_USE"));
    const current = await agent.get(`/api/v1/inventory-items/${item.id}`).expect(200);
    await agent.post(`/api/v1/inventory-items/${item.id}/deactivate`)
      .set("X-CSRF-Token", csrf)
      .send({ version: current.body.version, reason: "إيقاف صنف الاختبار" })
      .expect(200);
    const deactivatedUnit = await agent.post(`/api/v1/units-of-measure/${unit.id}/deactivate`)
      .set("X-CSRF-Token", csrf)
      .send({ version: 0, reason: "لم تعد الوحدة مستخدمة" })
      .expect(200);
    expect(deactivatedUnit.body).toMatchObject({ isActive: false, version: 1 });
  });

  it("serializes item creation against unit deactivation", async () => {
    const unit = await createUnit("ltr", "لتر");
    const service = new InventoryCatalogService(prisma!);
    const results = await Promise.allSettled([
      service.createItem(
        { userId, companyId },
        { unitOfMeasureId: BigInt(unit.id), nameAr: "صنف سباق الوحدة" },
      ),
      service.deactivateUnitOfMeasure(
        { userId, companyId },
        BigInt(unit.id),
        { version: 0, reason: "اختبار قفل الوحدة" },
      ),
    ]);
    const created = results[0];
    if (created.status === "fulfilled") itemIds.push(created.value.id);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const activeItemOnInactiveUnit = await prisma!.inventoryItem.count({
      where: {
        companyId,
        unitOfMeasureId: BigInt(unit.id),
        isActive: true,
        unitOfMeasure: { isActive: false },
      },
    });
    expect(activeItemOnInactiveUnit).toBe(0);
    const rejection = results.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({ reason: expect.any(InventoryCatalogError) });
  });

  it("does not expose foreign catalog data or accept a foreign unit", async () => {
    const base = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    const foreign = await prisma!.company.create({
      data: {
        organizationId: base.organizationId,
        baseCurrencyId: base.baseCurrencyId,
        name: "شركة كتالوج أجنبية",
        timezone: "Asia/Riyadh",
      },
    });
    foreignCompanyId = foreign.id;
    const service = new InventoryCatalogService(prisma!);
    const foreignUnit = await service.createUnitOfMeasure(
      { userId, companyId: foreign.id },
      { code: "EA", nameAr: "حبة أجنبية", decimalPlaces: 0 },
    );
    const foreignItem = await service.createItem(
      { userId, companyId: foreign.id },
      { unitOfMeasureId: foreignUnit.id, nameAr: "صنف الشركة الأخرى" },
    );
    expect(foreignItem.code).toBe("ITM-000001");
    await agent.get(`/api/v1/units-of-measure/${foreignUnit.id}`).expect(404);
    await agent.get(`/api/v1/inventory-items/${foreignItem.id}`).expect(404);
    await agent.post("/api/v1/inventory-items")
      .set("X-CSRF-Token", csrf)
      .send({ unitOfMeasureId: foreignUnit.id.toString(), nameAr: "محاولة عابرة" })
      .expect(422)
      .expect(({ body }) => expect(body.reason).toBe("UNIT_INACTIVE"));
    const list = await agent.get("/api/v1/inventory-items?page=1&pageSize=100").expect(200);
    expect(list.body.data.some(({ id }: { id: string }) => id === foreignItem.id.toString())).toBe(false);
  });
});
