import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createBarcodeLabelService } from "../src/composition/create-barcode-label-service.js";
import { createDatabase } from "../src/database.js";
import { InventoryBarcodeService } from "../src/inventory/inventory-barcode-service.js";
import { InventoryCatalogService } from "../src/inventory/inventory-catalog-service.js";
import { testAuthOptions } from "./helpers/test-auth-options.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("barcode label input, render, resolve, and tenant isolation", () => {
  let companyId: bigint;
  let foreignCompanyId: bigint;
  let userId: bigint;
  let unitId: bigint;
  let foreignUnitId: bigint;
  let agent: ReturnType<typeof request.agent>;
  let csrf = "";
  const itemIds: bigint[] = [];
  const foreignItemIds: bigint[] = [];
  const barcodeIds: bigint[] = [];

  const context = () => ({ companyId, userId });
  const foreignContext = () => ({ companyId: foreignCompanyId, userId });
  const catalog = () => new InventoryCatalogService(prisma!);
  const barcodes = () => new InventoryBarcodeService(prisma!);

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" },
    });
    userId = user.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({
      where: { userId, isActive: true },
    })).companyId;
    const base = await prisma!.company.findUniqueOrThrow({ where: { id: companyId } });
    const foreign = await prisma!.company.create({
      data: {
        organizationId: base.organizationId,
        baseCurrencyId: base.baseCurrencyId,
        name: `منشأة ملصق باركود ${Date.now()}`,
        timezone: "Asia/Riyadh",
      },
    });
    foreignCompanyId = foreign.id;

    const suffix = Date.now().toString(36).slice(-8).toUpperCase();
    unitId = (await catalog().createUnitOfMeasure(context(), {
      code: `L${suffix}`.slice(0, 20),
      nameAr: "وحدة ملصق باركود",
      decimalPlaces: 0,
    })).id;
    foreignUnitId = (await catalog().createUnitOfMeasure(foreignContext(), {
      code: "EA",
      nameAr: "حبة أجنبية",
      decimalPlaces: 0,
    })).id;

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
      DATABASE_URL: process.env.DATABASE_URL!,
    }, {
      auth,
      inventoryBarcodes: barcodes(),
      barcodeLabels: createBarcodeLabelService(prisma!),
    });
    agent = request.agent(app);
    csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken;
    csrf = (await agent.post("/api/v1/auth/login")
      .set("X-CSRF-Token", csrf)
      .send({
        email: "admin@mcap.local",
        password: process.env.SEED_ADMIN_PASSWORD ?? "",
      })
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
        companyId,
        OR: [
          { entityType: "INVENTORY_ITEM_BARCODE", entityId: { in: barcodeIds.map(String) } },
          { entityType: "INVENTORY_ITEM", entityId: { in: itemIds.map(String) } },
          { entityType: "UNIT_OF_MEASURE", entityId: unitId.toString() },
        ],
      },
    });
    await prisma.inventoryItemBarcode.deleteMany({
      where: { companyId, inventoryItemId: { in: itemIds } },
    });
    await prisma.inventoryItem.deleteMany({ where: { companyId, id: { in: itemIds } } });
    await prisma.unitOfMeasure.deleteMany({ where: { companyId, id: unitId } });

    await prisma.auditLog.deleteMany({ where: { companyId: foreignCompanyId } });
    await prisma.inventoryItemBarcode.deleteMany({ where: { companyId: foreignCompanyId } });
    await prisma.inventoryItem.deleteMany({ where: { companyId: foreignCompanyId } });
    await prisma.unitOfMeasure.deleteMany({ where: { companyId: foreignCompanyId } });
    await prisma.masterDataCodeSequence.deleteMany({ where: { companyId: foreignCompanyId } });
    await prisma.company.delete({ where: { id: foreignCompanyId } });
    await prisma.$disconnect();
  });

  async function createItem(nameAr: string, foreign = false) {
    const created = await catalog().createItem(
      foreign ? foreignContext() : context(),
      { unitOfMeasureId: foreign ? foreignUnitId : unitId, nameAr },
    );
    (foreign ? foreignItemIds : itemIds).push(created.id);
    return created;
  }

  it("traces exact input through PNG rendering and company-scoped resolution", async () => {
    const rawValue = `LABEL-ROUNDTRIP-${Date.now()}`;
    const item = await createItem("صنف دورة الملصق");
    const foreignItem = await createItem("صنف ملصق أجنبي", true);
    const created = await agent
      .post(`/api/v1/inventory-items/${item.id}/barcodes`)
      .set("X-CSRF-Token", csrf)
      .send({ symbology: "CODE_128", value: rawValue, isPrimary: true })
      .expect(201);
    const barcodeId = BigInt(created.body.id);
    barcodeIds.push(barcodeId);
    const foreignBarcode = await barcodes().createBarcode(foreignContext(), foreignItem.id, {
      symbology: "CODE_128",
      value: rawValue,
      isPrimary: true,
    });

    const label = await agent
      .get(`/api/v1/inventory-items/${item.id}/barcodes/${barcodeId}/label.png`)
      .expect(200);
    expect(label.headers["content-type"]).toMatch(/^image\/png/u);
    expect(label.headers["cache-control"]).toBe("no-store");
    expect(label.body.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(JSON.stringify(label.headers)).not.toContain(rawValue);

    const resolved = await agent.post("/api/v1/inventory-barcodes/resolve")
      .set("X-CSRF-Token", csrf)
      .send({ value: rawValue })
      .expect(200);
    expect(resolved.body.inventoryItem.id).toBe(item.id.toString());
    expect(resolved.body.barcode.id).toBe(barcodeId.toString());

    await agent
      .get(`/api/v1/inventory-items/${foreignItem.id}/barcodes/${foreignBarcode.id}/label.png`)
      .expect(404);

    const audit = await prisma!.auditLog.findFirstOrThrow({
      where: {
        companyId,
        entityType: "INVENTORY_ITEM_BARCODE",
        entityId: barcodeId.toString(),
        action: "INVENTORY_BARCODE_LABEL_DOWNLOADED",
      },
      orderBy: { id: "desc" },
    });
    expect(audit.details).toMatchObject({
      inventoryItemId: item.id.toString(),
      symbology: "CODE_128",
      profile: "INVENTORY_203_DPI_V1",
    });
    expect(JSON.stringify(audit, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    )).not.toContain(rawValue);
  });

  it("does not print an inactive barcode or an inactive item", async () => {
    const barcodeItem = await createItem("صنف باركود معطل");
    const inactiveBarcode = await barcodes().createBarcode(context(), barcodeItem.id, {
      symbology: "EAN_8",
      value: "96385074",
    });
    barcodeIds.push(inactiveBarcode.id);
    await barcodes().deactivateBarcode(context(), barcodeItem.id, inactiveBarcode.id, {
      version: inactiveBarcode.version,
      reason: "تحقق رفض طباعة المعطل",
    });
    await agent
      .get(`/api/v1/inventory-items/${barcodeItem.id}/barcodes/${inactiveBarcode.id}/label.png`)
      .expect(404);

    const item = await createItem("صنف معطل للطباعة");
    const barcode = await barcodes().createBarcode(context(), item.id, {
      symbology: "UPC_A",
      value: "036000291452",
    });
    barcodeIds.push(barcode.id);
    await catalog().deactivateItem(context(), item.id, {
      version: item.version,
      reason: "تحقق رفض طباعة الصنف المعطل",
    });
    await agent
      .get(`/api/v1/inventory-items/${item.id}/barcodes/${barcode.id}/label.png`)
      .expect(404);
  });

  it("grants the dedicated permission to system administrators", async () => {
    const permission = await prisma!.permission.findUniqueOrThrow({
      where: { code: "inventory_barcodes.print" },
    });
    const administrator = await prisma!.role.findFirstOrThrow({
      where: { companyId, code: "ADMINISTRATOR", isSystemRole: true },
    });
    expect(await prisma!.rolePermission.count({
      where: { roleId: administrator.id, permissionId: permission.id },
    })).toBe(1);
  });
});
