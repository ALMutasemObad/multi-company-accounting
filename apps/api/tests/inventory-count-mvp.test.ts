import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  InventoryCountError,
  InventoryCountService,
} from "../src/inventory/inventory-count/inventory-count-service.js";

const context = { companyId: 7n, userId: 11n };

const buildService = (tx: Record<string, unknown>) => {
  const service = Object.create(InventoryCountService.prototype) as InventoryCountService;
  Object.assign(service, {
    prisma: {},
    transactions: { execute: async (_options: unknown, work: (value: unknown) => unknown) => work(tx) },
    idempotency: { execute: async (_options: unknown, work: (value: unknown) => unknown) => work(tx) },
  });
  return service;
};

describe("inventory count MVP", () => {
  it("creates a company-scoped 300-title snapshot with cutoff and location snapshots", async () => {
    const balances = Array.from({ length: 300 }, (_, index) => ({
      inventoryItemId: BigInt(index + 1),
      onHand: new Prisma.Decimal(1000),
      inventoryValueBase: new Prisma.Decimal(15000),
      averageUnitCostBase: new Prisma.Decimal(15),
      isValuationInitialized: true,
      inventoryItem: {
        code: `BOOK-${String(index + 1).padStart(3, "0")}`,
        nameAr: `عنوان ${index + 1}`,
        unitOfMeasure: { code: "COPY" },
      },
    }));
    const create = vi.fn(async ({ data }: { data: { lines: { create: unknown[] } } }) => {
      expect(data.lines.create).toHaveLength(300);
      expect(data.lines.create[0]).toMatchObject({ shelfSnapshot: "A-01", locationSnapshot: "قاعة الكتب" });
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
      },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: "ليان" }) },
    };
    const service = buildService(tx);
    const result = await service.bulkEnterCounts(context, 20n, [
      { lineId: 1n, expectedVersion: 2, countedQuantity: "1002", varianceReason: "نسختان زائدتان" },
      { lineId: 2n, expectedVersion: 3, countedQuantity: "1000" },
      { lineId: 999n, expectedVersion: 0, countedQuantity: "1000" },
    ]);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ data: {
      countedById: 11n, countedByNameSnapshot: "ليان", version: { increment: 1 },
    } });
    expect(result.conflicts).toEqual([
      { lineId: "2", expectedVersion: 3, actualVersion: 4 },
      { lineId: "999", expectedVersion: 0, actualVersion: null },
    ]);
    expect(result.summary).toEqual({ total: 300, counted: 299, remaining: 1, surplus: 1, shortage: 0, conflicts: 2 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate bulk rows and non-zero variance without a reason", async () => {
    const service = buildService({});
    await expect(service.bulkEnterCounts(context, 1n, [
      { lineId: 2n, expectedVersion: 0, countedQuantity: "1" },
      { lineId: 2n, expectedVersion: 0, countedQuantity: "1" },
    ])).rejects.toMatchObject({ reason: "DUPLICATE_LINE" });

    const varianceService = buildService({
      $queryRaw: vi.fn(),
      stockCountSession: { findFirst: vi.fn().mockResolvedValue({ id: 1n, status: "DRAFT" }) },
      stockCountLine: {
        findMany: vi.fn().mockResolvedValue([{ id: 2n, version: 0, bookQuantity: new Prisma.Decimal(10) }]),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ displayName: "ليان" }) },
    });
    await expect(varianceService.bulkEnterCounts(context, 1n, [
      { lineId: 2n, expectedVersion: 0, countedQuantity: "9" },
    ])).rejects.toEqual(new InventoryCountError("INVALID_VARIANCE_REASON"));
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
});
