import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import type { AuthService } from "../src/auth/auth-service.js";
import {
  InventoryCountError,
  InventoryCountService,
} from "../src/inventory/inventory-count/inventory-count-service.js";
import { createInventoryMovementRouter } from "../src/inventory/inventory-movement-router.js";
import type { InventoryMovementService } from "../src/inventory/inventory-movement-service.js";

const context = { companyId: 7n, userId: 11n };

const buildService = (tx: Record<string, unknown>) => {
  const transactionalClient = { $queryRaw: vi.fn().mockResolvedValue([{ id: 1n }]), ...tx };
  const service = Object.create(InventoryCountService.prototype) as InventoryCountService;
  Object.assign(service, {
    prisma: {},
    transactions: { execute: async (_options: unknown, work: (value: unknown) => unknown) => work(transactionalClient) },
    idempotency: { execute: async (_options: unknown, work: (value: unknown) => unknown) => work(transactionalClient) },
  });
  return service;
};

const routerFixture = () => {
  const authorize = vi.fn().mockResolvedValue(context);
  const inventoryCount = {
    listSessions: vi.fn().mockResolvedValue({ data: [{ id: "90", status: "DRAFT" }], total: 1 }),
    createSession: vi.fn().mockResolvedValue({ id: "90", status: "DRAFT" }),
    getSession: vi.fn().mockResolvedValue({ id: "90", status: "DRAFT", summary: { total: 300, counted: 0, remaining: 300 } }),
    listLines: vi.fn().mockResolvedValue({ data: [{ id: "1", code: "BOOK-001" }], summary: { total: 300, counted: 10, remaining: 290, surplus: 1, shortage: 2, conflicts: 0 } }),
    lookupItems: vi.fn().mockResolvedValue({ data: [{ id: "10", nameAr: "كتاب", issueNumber: "الأول" }], total: 1, page: 1 }),
    listEntries: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1 }),
    exportEntries: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    dailyActivity: vi.fn().mockResolvedValue({ day: "2026-09-28", countedCopies: "0", countedTitles: 0 }),
    reverseEntry: vi.fn().mockResolvedValue({ line: { countedQuantity: "0" } }),
    bulkEnterCounts: vi.fn().mockResolvedValue({ conflicts: [], summary: { total: 300, counted: 11, remaining: 289, surplus: 1, shortage: 2, conflicts: 0 } }),
    submit: vi.fn().mockResolvedValue({ id: "90", status: "SUBMITTED", version: 1 }),
    approve: vi.fn().mockResolvedValue({ id: "90", status: "APPROVED", version: 2 }),
  };
  const app = express();
  app.use(express.json());
  app.use(createInventoryMovementRouter(
    { authorize } as unknown as AuthService,
    { inventoryCount } as unknown as InventoryMovementService,
  ));
  app.use(((error, _request, response, _next) => {
    response.status(500).json({ code: "TEST_ERROR", error: String(error) });
  }) satisfies ErrorRequestHandler);
  return { app, authorize, inventoryCount };
};

describe("inventory count MVP", () => {
  it("filters count history across the session and exports matching notes with management permission", async () => {
    const { app, authorize, inventoryCount } = routerFixture();
    inventoryCount.exportEntries.mockResolvedValue({ data: [{
      code: "BOOK-001", title: "عنوان عربي", publicationIdentifier: "9786038291986", barcode: null,
      quantity: "2", locationReference: null, note: "=HYPERLINK(\"https://example.invalid\")",
      counterName: "أحمد", createdAt: "2026-09-30T09:00:00.000Z", reversedAt: null, reversalReason: null,
    }], total: 1 });
    const listed = await request(app).get("/inventory-count-sessions/20/entries?search=%D9%85%D9%84%D8%A7%D8%AD%D8%B8%D8%A9&page=2&pageSize=50").set("Cookie", "sid=fixture");
    expect(listed.status).toBe(200);
    expect(inventoryCount.listEntries).toHaveBeenCalledWith(context, 20n, { search: "ملاحظة", page: 2, pageSize: 50 });
    const exported = await request(app).get("/inventory-count-sessions/20/entries.xlsx?search=%D9%85%D9%84%D8%A7%D8%AD%D8%B8%D8%A9").set("Cookie", "sid=fixture");
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(inventoryCount.exportEntries).toHaveBeenCalledWith(context, 20n, { search: "ملاحظة" });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_counts.manage", requireCsrf: false }));
  });

  it("filters the entire count-entry query by title, publication identifier or note before pagination", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ id: 20n }) },
      stockCountEntry: { findMany, count },
      $transaction: async (queries: unknown[]) => Promise.all(queries),
    };
    const service = Object.create(InventoryCountService.prototype) as InventoryCountService;
    Object.assign(service, { prisma });
    await service.listEntries(context, 20n, { search: " 978603 ", page: 2, pageSize: 50 });
    const query = findMany.mock.calls[0]?.[0];
    expect(query.where).toMatchObject({ companyId: 7n, sessionId: 20n, OR: [
      { line: { itemTitleSnapshot: { contains: "978603" } } },
      { line: { inventoryItem: { publicationIdentifier: { contains: "978603" } } } },
      { line: { inventoryItem: { barcodes: { some: { isActive: true, value: { contains: "978603" } } } } } },
      { note: { contains: "978603" } },
    ] });
    expect(query).toMatchObject({ skip: 50, take: 50 });
    expect(count).toHaveBeenCalledWith({ where: query.where });
  });

  it("exports every filtered count-history entry without a screen-page limit", async () => {
    const service = Object.create(InventoryCountService.prototype) as InventoryCountService;
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({
      line: { itemCodeSnapshot: `BOOK-${index}`, itemTitleSnapshot: "عنوان عربي", inventoryItem: { publicationIdentifier: "9786038291986", barcodes: [] } },
      quantity: new Prisma.Decimal(1), locationReference: null, note: "ملاحظة", counterNameSnapshot: "أحمد",
      createdAt: new Date("2026-09-30T09:00:00Z"), reversedAt: null, reversalReason: null,
    })));
    Object.assign(service, { prisma: {
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ id: 20n }) },
      stockCountEntry: { findMany },
    } });
    const result = await service.exportEntries(context, 20n, { search: "ملاحظة" });
    expect(result.data).toHaveLength(101);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: 7n, sessionId: 20n }), orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty("take");
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty("skip");
  });

  it("requires management permission and CSRF for a reversible audit entry", async () => {
    const { app, authorize, inventoryCount } = routerFixture();
    const response = await request(app).post("/inventory-count-sessions/20/entries/8/reverse").set("Cookie", "sid=fixture").send({ reason: "خطأ إدخال" });
    expect(response.status).toBe(200);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_counts.manage", requireCsrf: true }));
    expect(inventoryCount.reverseEntry).toHaveBeenCalledWith(context, 20n, 8n, "خطأ إدخال");
  });
  it("creates a company-scoped 300-title snapshot with cutoff and location snapshots", async () => {
    const items = Array.from({ length: 300 }, (_, index) => ({
      id: BigInt(index + 1),
      code: `BOOK-${String(index + 1).padStart(3, "0")}`,
      nameAr: `عنوان ${index + 1}`,
      unitOfMeasure: { code: "COPY" },
    }));
    const balances = items.map((item) => ({
      inventoryItemId: item.id,
      onHand: new Prisma.Decimal(1000),
      inventoryValueBase: new Prisma.Decimal(15000),
      averageUnitCostBase: new Prisma.Decimal(15),
      isValuationInitialized: true,
    }));
    const create = vi.fn(async ({ data }: { data: { lines: { create: unknown[] } } }) => {
      expect(data.lines.create).toHaveLength(300);
      expect(data.lines.create[0]).toMatchObject({ shelfSnapshot: "A-01", locationSnapshot: "قاعة الكتب" });
      expect(data.lines.create[0]).not.toHaveProperty("companyId");
      return {
        id: 90n, warehouseId: 3n, countDate: new Date("2026-09-24"), snapshotAt: new Date("2026-09-21T10:00:00Z"),
        status: "DRAFT", version: 0, lastReceiptMovementId: 50n, lastReceiptMovementNumber: "IMV-50",
        lastIssueMovementId: 49n, lastIssueMovementNumber: "IMV-49", submittedAt: null, approvedAt: null, approvedByName: null,
      };
    });
    const movementFindFirst = vi.fn()
      .mockResolvedValueOnce({ id: 50n, movementNumber: "IMV-50" })
      .mockResolvedValueOnce({ id: 49n, movementNumber: "IMV-49" });
    const service = buildService({
      warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 3n, isActive: true, address: "المكتبة العامة" }) },
      inventoryItem: { findMany: vi.fn().mockResolvedValue(items) },
      inventoryBalance: { findMany: vi.fn().mockResolvedValue(balances) },
      inventoryMovement: { findFirst: movementFindFirst },
      stockCountSession: { create },
    });

    const result = await service.createSession(context, {
      warehouseId: 3n,
      countDate: new Date("2026-09-24"),
      committee: [{ name: "سارة", role: "رئيس اللجنة" }],
      locations: [{ inventoryItemId: 1n, location: "قاعة الكتب", shelf: "A-01" }],
    }, "library-count-2026-09-24");

    expect(result).toMatchObject({ id: "90", status: "DRAFT", cutoff: { receipt: { id: "50" }, issue: { id: "49" } } });
    expect(movementFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: 7n, movementType: "RECEIPT" }),
    }));
  });

  it("includes active catalog items with a zero book snapshot when no balance exists yet", async () => {
    const create = vi.fn(async ({ data }: { data: { lines: { create: Array<Record<string, unknown>> } } }) => {
      expect(data.lines.create).toHaveLength(1);
      expect(data.lines.create[0]).toMatchObject({
        inventoryItemId: 1n,
        itemCodeSnapshot: "BOOK-001",
        bookQuantity: new Prisma.Decimal(0),
        bookUnitCostBase: new Prisma.Decimal(0),
        bookValueBase: new Prisma.Decimal(0),
        isValuationInitialized: false,
      });
      return {
        id: 91n, warehouseId: 3n, countDate: new Date("2026-09-24"), snapshotAt: new Date("2026-09-21T10:00:00Z"),
        status: "DRAFT", version: 0, lastReceiptMovementId: null, lastReceiptMovementNumber: null,
        lastIssueMovementId: null, lastIssueMovementNumber: null, submittedAt: null, approvedAt: null, approvedByName: null,
      };
    });
    const service = buildService({
      warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 3n, isActive: true, address: "المكتبة العامة" }) },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([{ id: 1n, code: "BOOK-001", nameAr: "كتاب تجريبي", unitOfMeasure: { code: "COPY" } }]) },
      inventoryBalance: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryMovement: { findFirst: vi.fn().mockResolvedValue(null) },
      stockCountSession: { create },
    });

    await expect(service.createSession(context, {
      warehouseId: 3n,
      countDate: new Date("2026-09-24"),
      committee: [{ name: "موظف الاختبار", role: "عضو لجنة الجرد" }],
    }, "zero-balance-count")).resolves.toMatchObject({ id: "91", status: "DRAFT" });
  });

  it("bulk updates valid rows, reports stale/foreign conflicts, and records the employee snapshot", async () => {
    const writes: unknown[] = [];
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ id: 20n, status: "DRAFT" }) },
      stockCountLine: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1n, version: 2, bookQuantity: new Prisma.Decimal(1000) },
          { id: 2n, version: 4, bookQuantity: new Prisma.Decimal(1000) },
        ]),
        updateMany: vi.fn(async (input: unknown) => { writes.push(input); return { count: 1 }; }),
        count: vi.fn()
          .mockResolvedValueOnce(300)
          .mockResolvedValueOnce(299)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { countedQuantity: new Prisma.Decimal(1002) } }),
      },
      stockCountEntry: { create: vi.fn().mockResolvedValue({ id: 1n }) },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: "ليان" }) },
    };
    const service = buildService(tx);
    const result = await service.bulkEnterCounts(context, 20n, [
      { lineId: 1n, expectedVersion: 2, countedQuantity: "1002" },
      { lineId: 2n, expectedVersion: 3, countedQuantity: "1000" },
      { lineId: 999n, expectedVersion: 0, countedQuantity: "1000" },
    ]);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ data: {
      countedById: 11n, countedByNameSnapshot: "ليان", varianceReason: null, version: { increment: 1 },
    } });
    expect(result.conflicts).toEqual([
      { lineId: "2", expectedVersion: 3, actualVersion: 4 },
      { lineId: "999", expectedVersion: 0, actualVersion: null },
    ]);
    expect(result.summary).toEqual({ total: 300, counted: 299, remaining: 1, surplus: 1, shortage: 0, conflicts: 2, countedCopies: "1002" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate rows and requires an explanation only for overriding a recorded count", async () => {
    const service = buildService({});
    await expect(service.bulkEnterCounts(context, 1n, [
      { lineId: 2n, expectedVersion: 0, countedQuantity: "1" },
      { lineId: 2n, expectedVersion: 0, countedQuantity: "1" },
    ])).rejects.toMatchObject({ reason: "DUPLICATE_LINE" });

    const varianceService = buildService({
      $queryRaw: vi.fn(),
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ id: 1n, status: "DRAFT" }) },
      stockCountLine: {
        findMany: vi.fn().mockResolvedValue([{ id: 2n, version: 0, bookQuantity: new Prisma.Decimal(10), countedQuantity: new Prisma.Decimal(10), _count: { entries: 1 } }]),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: "ليان" }) },
    });
    await expect(varianceService.bulkEnterCounts(context, 1n, [
      { lineId: 2n, expectedVersion: 0, countedQuantity: "9" },
    ])).rejects.toEqual(new InventoryCountError("INVALID_VARIANCE_REASON"));
  });

  it("accepts a negative count correction but never makes the title total negative", async () => {
    const create = vi.fn().mockResolvedValue({ id: 8n });
    const update = vi.fn().mockResolvedValue({ id: 4n });
    const line = { id: 4n, inventoryItemId: 5n, itemCodeSnapshot: "BK-5", itemTitleSnapshot: "كتاب", countedQuantity: new Prisma.Decimal(10), bookQuantity: new Prisma.Decimal(20), version: 1 };
    const service = buildService({
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ status: "DRAFT" }) },
      stockCountEntry: { findFirst: vi.fn().mockResolvedValue(null), create },
      stockCountLine: { findFirst: vi.fn().mockResolvedValue(line), findFirstOrThrow: vi.fn().mockResolvedValue(line), update },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: "سارة" }) },
    });
    await service.addEntry(context, 20n, { inventoryItemId: 5n, quantity: "-5", note: "تصحيح عد", entryKey: "negative-entry-001" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: new Prisma.Decimal(-5), note: "تصحيح عد" }) }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ countedQuantity: new Prisma.Decimal(5) }) }));
    await expect(service.addEntry(context, 20n, { inventoryItemId: 5n, quantity: "-11", entryKey: "negative-entry-002" })).rejects.toMatchObject({ reason: "INVALID_COUNT" });
  });

  it("reverses only the latest active entry and keeps an audit trail", async () => {
    const markReversed = vi.fn().mockResolvedValue({ id: 8n });
    const updateLine = vi.fn().mockResolvedValue({ id: 4n });
    const line = { id: 4n, inventoryItemId: 5n, itemCodeSnapshot: "BK-5", itemTitleSnapshot: "كتاب", countedQuantity: new Prisma.Decimal(15), bookQuantity: new Prisma.Decimal(20), version: 2 };
    const service = buildService({
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ status: "DRAFT" }) },
      stockCountEntry: {
        findFirst: vi.fn().mockResolvedValueOnce({ id: 8n, lineId: 4n, quantity: new Prisma.Decimal(-5), reversedAt: null, entryKind: "BATCH" }).mockResolvedValueOnce({ id: 8n }),
        count: vi.fn().mockResolvedValue(1), update: markReversed,
      },
      stockCountLine: { findFirstOrThrow: vi.fn().mockResolvedValue(line), update: updateLine, findFirst: vi.fn().mockResolvedValue(line) },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: "المشرف" }) },
    });
    await service.reverseEntry(context, 20n, 8n, "تصحيح خطأ إدخال");
    expect(markReversed).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reversedById: 11n, reversalReason: "تصحيح خطأ إدخال" }) }));
    expect(updateLine).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ countedQuantity: new Prisma.Decimal(20) }) }));
  });

  it("selects counted rows for the record and uncounted rows for the separate export", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const database = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(database)),
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ id: 7n, countDate: new Date("2026-09-28"), status: "DRAFT", warehouse: { code: "WH", nameAr: "المكتبة" }, committeeMembers: [], lastReceiptMovementNumber: null, lastIssueMovementNumber: null, approvedByName: null, approvedAt: null, settlementDate: null, settledAt: null }) },
      stockCountLine: {
        findMany,
        count: vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(2).mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(4).mockResolvedValueOnce(2).mockResolvedValueOnce(0).mockResolvedValueOnce(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { countedQuantity: new Prisma.Decimal(1035) } }),
      },
    };
    const service = new InventoryCountService(database as unknown as PrismaClient);
    const record = await service.report(context, 7n);
    const uncounted = await service.report(context, 7n, "uncounted");
    expect(record.session.summary).toMatchObject({ total: 4, counted: 2, remaining: 2, countedCopies: "1035" });
    expect(uncounted.session.summary).toMatchObject({ total: 4, counted: 2, remaining: 2 });
    expect(findMany.mock.calls[0]?.[0]?.where.countedQuantity).toEqual({ not: null });
    expect(findMany.mock.calls[1]?.[0]?.where.countedQuantity).toBeNull();
  });

  it("counts today's active copies and distinct titles using the caller's local day", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { lineId: 1n, quantity: new Prisma.Decimal(250) },
      { lineId: 1n, quantity: new Prisma.Decimal(-5) },
      { lineId: 2n, quantity: new Prisma.Decimal(50) },
    ]);
    const service = new InventoryCountService({
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ id: 7n }) },
      stockCountEntry: { findMany },
    } as unknown as PrismaClient);
    await expect(service.dailyActivity(context, 7n, "2026-09-28", 180)).resolves.toEqual({ day: "2026-09-28", countedCopies: "295", countedTitles: 2 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      companyId: 7n, sessionId: 7n, reversedAt: null,
      createdAt: { gte: new Date("2026-09-27T21:00:00.000Z"), lt: new Date("2026-09-28T21:00:00.000Z") },
    }) }));
  });

  it("requires all lines before submit and committee/name before approval", async () => {
    const submitTx = {
      $queryRaw: vi.fn(),
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ status: "DRAFT", version: 0 }) },
      stockCountLine: { count: vi.fn().mockResolvedValue(1) },
    };
    await expect(buildService(submitTx).submit(context, 1n, 0)).rejects.toMatchObject({ reason: "INCOMPLETE_COUNT" });
    await expect(buildService({}).approve(context, 1n, 0, "  ")).rejects.toMatchObject({ reason: "INVALID_COMMITTEE" });
  });

  it("persists tenant keys, line CAS, state constraints and rollback in the migration", () => {
    const root = resolve(import.meta.dirname, "..");
    const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
    const migration = readFileSync(resolve(root, "prisma/migrations/20260921_inventory_count_mvp/migration.sql"), "utf8");
    const rollback = readFileSync(resolve(root, "prisma/migrations/20260921_inventory_count_mvp/rollback.sql"), "utf8");
    expect(schema).toContain("enum StockCountSessionStatus");
    expect(schema).toContain("countedByNameSnapshot");
    expect(schema).toMatch(/model StockCountLine[\s\S]+version\s+Int\s+@default\(0\)/);
    expect(migration).toContain("FOREIGN KEY (`session_id`, `company_id`)");
    expect(migration).toContain("stock_count_lines_count_shape_chk");
    expect(migration).toContain("stock_count_sessions_state_chk");
    expect(rollback).toContain("DROP TABLE IF EXISTS `stock_count_sessions`");
  });

  it("exposes reload-safe session and line reads with the view permission", async () => {
    const { app, authorize, inventoryCount } = routerFixture();
    const sessions = await request(app)
      .get("/inventory-count-sessions?page=1&pageSize=25&status=DRAFT&warehouseId=3")
      .set("Cookie", "sid=session-token");
    const lines = await request(app)
      .get("/inventory-count-sessions/90/lines?page=1&pageSize=500&search=BOOK")
      .set("Cookie", "sid=session-token");

    expect(sessions.status).toBe(200);
    expect(sessions.body.meta).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    expect(lines.status).toBe(200);
    expect(lines.body.summary).toMatchObject({ total: 300, counted: 10, remaining: 290 });
    expect(inventoryCount.listSessions).toHaveBeenCalledWith(context, { page: 1, pageSize: 25, status: "DRAFT", warehouseId: 3n });
    expect(inventoryCount.listLines).toHaveBeenCalledWith(context, 90n, { page: 1, pageSize: 500, search: "BOOK" });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_movements.view", requireCsrf: false }));
  });

  it("looks up books with the counter permission, without requiring catalog management", async () => {
    const { app, authorize, inventoryCount } = routerFixture();
    const response = await request(app)
      .get("/inventory-count-sessions/90/lookup?query=9786038291986&page=1")
      .set("Cookie", "sid=session-token");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, data: [{ id: "10" }] });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_counts.enter", requireCsrf: false }));
    expect(inventoryCount.lookupItems).toHaveBeenCalledWith(context, 90n, "9786038291986", 1);
  });

  it("requires create permission, CSRF and idempotency for a session snapshot", async () => {
    const { app, authorize, inventoryCount } = routerFixture();
    const response = await request(app)
      .post("/inventory-count-sessions")
      .set("Cookie", "sid=session-token")
      .set("X-CSRF-Token", "csrf-token")
      .set("Idempotency-Key", "library-2026-09-24")
      .send({
        warehouseId: "3",
        countDate: "2026-09-24",
        committee: [{ name: "سارة", role: "رئيس اللجنة" }],
        locations: [{ inventoryItemId: "1", location: "قاعة الكتب", shelf: "A-01" }],
      });

    expect(response.status).toBe(201);
    expect(authorize).toHaveBeenCalledWith({ sid: "session-token", csrfToken: "csrf-token", permission: "inventory_counts.manage", requireCsrf: true });
    expect(inventoryCount.createSession).toHaveBeenCalledWith(context, expect.objectContaining({ warehouseId: 3n }), "library-2026-09-24");
  });

  it("validates and forwards bulk counts and state transitions with CSRF", async () => {
    const { app, authorize, inventoryCount } = routerFixture();
    const bulk = await request(app)
      .post("/inventory-count-sessions/90/counts")
      .set("X-CSRF-Token", "csrf-token")
      .send({ rows: [{ lineId: "1", expectedVersion: 2, countedQuantity: "1002", varianceReason: "نسختان زائدتان" }] });
    const submit = await request(app)
      .post("/inventory-count-sessions/90/submit")
      .set("X-CSRF-Token", "csrf-token")
      .send({ expectedVersion: 0 });
    const approve = await request(app)
      .post("/inventory-count-sessions/90/approve")
      .set("X-CSRF-Token", "csrf-token")
      .send({ expectedVersion: 1, approverName: "مدير المكتبة" });

    expect([bulk.status, submit.status, approve.status]).toEqual([200, 200, 200]);
    expect(inventoryCount.bulkEnterCounts).toHaveBeenCalledWith(context, 90n, [{ lineId: 1n, expectedVersion: 2, countedQuantity: "1002", varianceReason: "نسختان زائدتان" }]);
    expect(inventoryCount.submit).toHaveBeenCalledWith(context, 90n, 0);
    expect(inventoryCount.approve).toHaveBeenCalledWith(context, 90n, 1, "مدير المكتبة");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "inventory_counts.manage", requireCsrf: true }));
  });
});
