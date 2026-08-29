import { verify } from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { PrismaAuthStore } from "../src/auth/prisma-auth-store.js";
import { createDatabase } from "../src/database.js";
import { InventoryBarcodeService } from "../src/inventory/inventory-barcode-service.js";
import { InventoryCatalogService } from "../src/inventory/inventory-catalog-service.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("inventory barcode identity, concurrency and tenant isolation", () => {
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
  const foreignBarcodeIds: bigint[] = [];

  const context = () => ({ companyId, userId });
  const foreignContext = () => ({ companyId: foreignCompanyId, userId });
  const barcodes = () => new InventoryBarcodeService(prisma!);
  const catalog = () => new InventoryCatalogService(prisma!);

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
        name: `شركة باركود ${Date.now()}`,
        timezone: "Asia/Riyadh",
      },
    });
    foreignCompanyId = foreign.id;
    const suffix = Date.now().toString(36).slice(-8).toUpperCase();
    unitId = (await catalog().createUnitOfMeasure(context(), {
      code: `B${suffix}`.slice(0, 20),
      nameAr: "وحدة اختبار باركود",
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
      { preAuthTtlMinutes: 10, sessionTtlHours: 12 },
    );
    const app = createApp({
      NODE_ENV: "test",
      PORT: 3000,
      WEB_ORIGIN: "http://localhost:5173",
      SESSION_COOKIE_SECURE: false,
      PRE_AUTH_TTL_MINUTES: 10,
      SESSION_TTL_HOURS: 12,
      DATABASE_URL: process.env.DATABASE_URL!,
    }, { auth, inventoryBarcodes: barcodes() });
    agent = request.agent(app);
    csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body.csrfToken;
    csrf = (await agent.post("/api/v1/auth/login")
      .set("X-CSRF-Token", csrf)
      .send({ email: "admin@mcap.local", password: process.env.SEED_ADMIN_PASSWORD ?? "" })
      .expect(200)).body.csrfToken;
    await agent.get("/api/v1/auth/companies").expect(200);
    await agent.put("/api/v1/auth/context")
      .set("X-CSRF-Token", csrf)
      .send({ companyId: companyId.toString() })
      .expect(204);
  });

  afterAll(async () => {
    if (!prisma) return;
    if (barcodeIds.length) {
      await prisma.auditLog.deleteMany({
        where: {
          companyId,
          entityType: "INVENTORY_ITEM_BARCODE",
          entityId: { in: barcodeIds.map(String) },
        },
      });
    }
    await prisma.inventoryItemBarcode.deleteMany({
      where: { companyId, inventoryItemId: { in: itemIds } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        companyId,
        OR: [
          { entityType: "INVENTORY_ITEM", entityId: { in: itemIds.map(String) } },
          { entityType: "UNIT_OF_MEASURE", entityId: unitId.toString() },
        ],
      },
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

  async function createBarcode(
    inventoryItemId: bigint,
    input: Parameters<InventoryBarcodeService["createBarcode"]>[2],
    foreign = false,
  ) {
    const created = await barcodes().createBarcode(
      foreign ? foreignContext() : context(),
      inventoryItemId,
      input,
    );
    (foreign ? foreignBarcodeIds : barcodeIds).push(created.id);
    return created;
  }

  it("serves the B1 HTTP contract with administrator permissions and exact strings", async () => {
    const item = await createItem("صنف عقد HTTP للباركود");
    const created = await agent.post(`/api/v1/inventory-items/${item.id}/barcodes`)
      .set("X-CSRF-Token", csrf)
      .send({ symbology: "EAN_13", value: "0012345678905", isPrimary: true })
      .expect(201);
    barcodeIds.push(BigInt(created.body.id));
    expect(created.body).toMatchObject({
      inventoryItemId: item.id.toString(),
      symbology: "EAN_13",
      value: "0012345678905",
      isPrimary: true,
      version: 0,
    });
    const list = await agent
      .get(`/api/v1/inventory-items/${item.id}/barcodes?page=1&pageSize=10`)
      .expect(200);
    expect(list.body).toMatchObject({
      data: [{ id: created.body.id, value: "0012345678905" }],
      meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
    const resolved = await agent.post("/api/v1/inventory-barcodes/resolve")
      .set("X-CSRF-Token", csrf)
      .send({ value: "0012345678905" })
      .expect(200);
    expect(resolved.body.inventoryItem.id).toBe(item.id.toString());
    expect(JSON.stringify(resolved.body)).not.toContain("0012345678905");
    expect(resolved.body).not.toHaveProperty("normalizedValue");
  });

  it("keeps the same barcode tenant-scoped and never resolves across companies", async () => {
    const item = await createItem("صنف محلي للباركود");
    const foreignItem = await createItem("صنف أجنبي للباركود", true);
    const local = await createBarcode(item.id, {
      symbology: "UPC_A",
      value: "036000291452",
      isPrimary: true,
    });
    const foreign = await createBarcode(foreignItem.id, {
      symbology: "EAN_13",
      value: "0036000291452",
      isPrimary: true,
    }, true);

    expect((await barcodes().resolveBarcode(context(), { value: "036000291452" }))
      .inventoryItem.id).toBe(item.id.toString());
    expect((await barcodes().resolveBarcode(foreignContext(), { value: "036000291452" }))
      .inventoryItem.id).toBe(foreignItem.id.toString());

    const foreignOnly = await createBarcode(foreignItem.id, {
      symbology: "CODE_128",
      value: `FOREIGN-${foreign.id}`,
    }, true);
    await expect(barcodes().resolveBarcode(context(), { value: foreignOnly.value }))
      .rejects.toMatchObject({ reason: "BARCODE_NOT_FOUND" });

    const listed = await barcodes().listBarcodes(context(), item.id, { page: 1, pageSize: 10 });
    expect(listed.data[0]).toMatchObject({ id: local.id, value: "036000291452" });
    await expect(createBarcode(item.id, {
      symbology: "EAN_13",
      value: "0036000291452",
    })).rejects.toMatchObject({
      reason: "BARCODE_ALREADY_EXISTS",
    });
  });

  it("allows exactly one concurrent create for a tenant identity", async () => {
    const item = await createItem("صنف تزامن الباركود");
    const attempts = await Promise.allSettled([
      barcodes().createBarcode(context(), item.id, { symbology: "CODE_128", value: "SKU-CONCURRENT-01" }),
      barcodes().createBarcode(context(), item.id, { symbology: "CODE_128", value: "SKU-CONCURRENT-01" }),
    ]);
    const fulfilled = attempts.filter((result) => result.status === "fulfilled");
    const rejected = attempts.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (fulfilled[0]?.status === "fulfilled") barcodeIds.push(fulfilled[0].value.id);
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({ reason: "BARCODE_ALREADY_EXISTS" }),
    });
  });

  it("serializes primary selection and applies optimistic version", async () => {
    const item = await createItem("صنف أساسي متزامن");
    const first = await createBarcode(item.id, {
      symbology: "CODE_128",
      value: "PRIMARY-OLD",
      isPrimary: true,
    });
    const second = await createBarcode(item.id, {
      symbology: "CODE_128",
      value: "PRIMARY-NEW",
    });
    const attempts = await Promise.allSettled([
      barcodes().setPrimaryBarcode(context(), item.id, second.id, { version: second.version }),
      barcodes().setPrimaryBarcode(context(), item.id, second.id, { version: second.version }),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = attempts.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      reason: expect.objectContaining({ reason: "VERSION_CONFLICT" }),
    });
    const persisted = await prisma!.inventoryItemBarcode.findMany({
      where: { companyId, inventoryItemId: item.id },
      orderBy: { id: "asc" },
    });
    expect(persisted.filter(({ isPrimary }) => isPrimary)).toHaveLength(1);
    expect(persisted.find(({ id }) => id === first.id)).toMatchObject({
      isPrimary: false,
      primaryInventoryItemId: null,
      version: 1,
    });
    expect(persisted.find(({ id }) => id === second.id)).toMatchObject({
      isPrimary: true,
      primaryInventoryItemId: item.id,
      version: 1,
    });
  });

  it("atomically deactivates all identifiers when their item is deactivated", async () => {
    const item = await createItem("صنف تعطيل ذري");
    const first = await createBarcode(item.id, {
      symbology: "EAN_8",
      value: "96385074",
      isPrimary: true,
    });
    const second = await createBarcode(item.id, {
      symbology: "QR",
      value: "ITEM-DEACTIVATION-QR",
    });
    const deactivated = await catalog().deactivateItem(context(), item.id, {
      version: item.version,
      reason: "إيقاف صنف الاختبار",
    });
    expect(deactivated).toMatchObject({ isActive: false, version: 1 });
    const persisted = await prisma!.inventoryItemBarcode.findMany({
      where: { id: { in: [first.id, second.id] }, companyId },
      orderBy: { id: "asc" },
    });
    expect(persisted).toHaveLength(2);
    expect(persisted.every((value) =>
      !value.isActive
      && !value.isPrimary
      && value.primaryInventoryItemId === null
      && value.version === 1,
    )).toBe(true);
    await expect(barcodes().resolveBarcode(context(), { value: first.value }))
      .rejects.toMatchObject({ reason: "BARCODE_INACTIVE" });
    const itemAudit = await prisma!.auditLog.findFirstOrThrow({
      where: { companyId, entityType: "INVENTORY_ITEM", entityId: item.id.toString(), action: "INVENTORY_ITEM_DEACTIVATED" },
      orderBy: { id: "desc" },
    });
    expect(itemAudit.details).toMatchObject({ deactivatedBarcodeCount: 2 });
  });

  it("enforces migration constraints and never records raw identifiers in barcode audit", async () => {
    const permissions = await prisma!.permission.findMany({
      where: { code: { in: [
        "inventory_barcodes.view",
        "inventory_barcodes.manage",
        "inventory_barcodes.resolve",
      ] } },
      select: { code: true },
    });
    expect(permissions).toHaveLength(3);
    const administrator = await prisma!.role.findFirstOrThrow({
      where: { companyId, code: "ADMINISTRATOR", isSystemRole: true },
      select: { id: true },
    });
    expect(await prisma!.rolePermission.count({
      where: {
        roleId: administrator.id,
        permission: { code: { in: permissions.map(({ code }) => code) } },
      },
    })).toBe(3);

    const columns = await prisma!.$queryRaw<Array<{ columnName: string; collationName: string }>>`
      SELECT COLUMN_NAME AS columnName, COLLATION_NAME AS collationName
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_item_barcodes'
        AND COLUMN_NAME IN ('value', 'normalized_value')
      ORDER BY COLUMN_NAME
    `;
    expect(columns).toHaveLength(2);
    expect(columns.every(({ collationName }) => collationName === "utf8mb4_bin")).toBe(true);
    const indexes = await prisma!.$queryRaw<Array<{ indexName: string }>>`
      SELECT DISTINCT INDEX_NAME AS indexName
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_item_barcodes'
        AND INDEX_NAME IN (
          'inventory_barcodes_company_normalized_key',
          'inventory_barcodes_company_primary_item_key',
          'inventory_barcodes_company_item_id_idx',
          'inventory_barcodes_company_item_active_id_idx'
        )
    `;
    expect(new Set(indexes.map(({ indexName }) => indexName))).toEqual(new Set([
      "inventory_barcodes_company_normalized_key",
      "inventory_barcodes_company_primary_item_key",
      "inventory_barcodes_company_item_id_idx",
      "inventory_barcodes_company_item_active_id_idx",
    ]));
    const paginationIndexColumns = await prisma!.$queryRaw<Array<{
      indexName: string;
      columnName: string;
    }>>`
      SELECT INDEX_NAME AS indexName, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_item_barcodes'
        AND INDEX_NAME IN (
          'inventory_barcodes_company_item_id_idx',
          'inventory_barcodes_company_item_active_id_idx'
        )
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `;
    expect(paginationIndexColumns
      .filter(({ indexName }) => indexName === "inventory_barcodes_company_item_id_idx")
      .map(({ columnName }) => columnName)).toEqual([
      "company_id",
      "inventory_item_id",
      "id",
    ]);
    expect(paginationIndexColumns
      .filter(({ indexName }) => indexName === "inventory_barcodes_company_item_active_id_idx")
      .map(({ columnName }) => columnName)).toEqual([
      "company_id",
      "inventory_item_id",
      "is_active",
      "id",
    ]);

    const item = await createItem("صنف قيود قاعدة البيانات");
    const foreignItem = await createItem("صنف مفتاح مركب أجنبي", true);
    await expect(prisma!.inventoryItemBarcode.create({
      data: {
        companyId,
        inventoryItemId: foreignItem.id,
        symbology: "CODE_128",
        value: "CROSS-COMPANY-FK",
        normalizedValue: "CROSS-COMPANY-FK",
      },
    })).rejects.toBeDefined();
    expect(await prisma!.inventoryItemBarcode.count({
      where: { companyId, normalizedValue: "CROSS-COMPANY-FK" },
    })).toBe(0);
    await expect(prisma!.inventoryItemBarcode.create({
      data: {
        companyId,
        inventoryItemId: item.id,
        symbology: "CODE_128",
        value: "INVALID-PRIMARY-STATE",
        normalizedValue: "INVALID-PRIMARY-STATE",
        isPrimary: true,
        primaryInventoryItemId: null,
      },
    })).rejects.toBeDefined();
    expect(await prisma!.inventoryItemBarcode.count({
      where: { companyId, normalizedValue: "INVALID-PRIMARY-STATE" },
    })).toBe(0);
    await expect(prisma!.inventoryItemBarcode.create({
      data: {
        companyId,
        inventoryItemId: item.id,
        symbology: "CODE_128",
        value: "INVALID-NONPRIMARY-MARKER",
        normalizedValue: "INVALID-NONPRIMARY-MARKER",
        isPrimary: false,
        primaryInventoryItemId: item.id,
      },
    })).rejects.toBeDefined();
    expect(await prisma!.inventoryItemBarcode.count({
      where: { companyId, normalizedValue: "INVALID-NONPRIMARY-MARKER" },
    })).toBe(0);

    const nullabilityChecks = await prisma!.$queryRaw<Array<{ constraintName: string }>>`
      SELECT CONSTRAINT_NAME AS constraintName
      FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_item_barcodes'
        AND CONSTRAINT_TYPE = 'CHECK'
        AND CONSTRAINT_NAME = 'inventory_item_barcodes_primary_marker_nullability_chk'
    `;
    expect(nullabilityChecks.map(({ constraintName }) => constraintName)).toEqual([
      "inventory_item_barcodes_primary_marker_nullability_chk",
    ]);

    const logs = await prisma!.auditLog.findMany({
      where: {
        companyId,
        entityType: "INVENTORY_ITEM_BARCODE",
        entityId: { in: barcodeIds.map(String) },
      },
      select: { details: true },
    });
    const serialized = JSON.stringify(logs);
    for (const raw of [
      "0012345678905",
      "00012345678905",
      "036000291452",
      "04006381333931",
      "SKU-CONCURRENT-01",
      "PRIMARY-OLD",
      "PRIMARY-NEW",
      "96385074",
      "ITEM-DEACTIVATION-QR",
    ]) {
      expect(serialized).not.toContain(raw);
    }
    expect(serialized).not.toContain("normalizedValue");
  });
});
