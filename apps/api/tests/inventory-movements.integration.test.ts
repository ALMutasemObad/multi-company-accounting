import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { InventoryCatalogService } from "../src/inventory/inventory-catalog-service.js";
import { InventoryMovementError, InventoryMovementService } from "../src/inventory/inventory-movement-service.js";
import { InventoryError, InventoryService } from "../src/inventory/inventory-service.js";

const enabled = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = enabled ? createDatabase(process.env.DATABASE_URL!) : null;

describe.runIf(enabled)("Inventory quantity ledger, locking and isolation", () => {
  let companyId: bigint;
  let userId: bigint;
  let warehouseA: { id: bigint; version: number };
  let warehouseB: { id: bigint; version: number };
  let unitId: bigint;
  let item: { id: bigint; version: number };
  let fiscalYearId: bigint;
  const movementIds: bigint[] = [];
  const inventory = () => new InventoryService(prisma!);
  const catalog = () => new InventoryCatalogService(prisma!);
  const movements = () => new InventoryMovementService(prisma!);
  const context = () => ({ companyId, userId });

  async function removeFiscalYear(id: bigint) {
    const staleMovementIds = (await prisma!.inventoryMovement.findMany({
      where: { companyId, accountingDocument: { fiscalPeriod: { fiscalYearId: id } } },
      select: { id: true },
    })).map(({ id: movementId }) => movementId);
    if (staleMovementIds.length) {
      await prisma!.inventoryMovementLine.deleteMany({ where: { companyId, movementId: { in: staleMovementIds } } });
      await prisma!.inventoryMovement.updateMany({ where: { companyId, id: { in: staleMovementIds } }, data: { reversalOfMovementId: null } });
      await prisma!.inventoryMovement.deleteMany({ where: { companyId, id: { in: staleMovementIds } } });
    }
    const documentIds = (await prisma!.accountingDocument.findMany({
      where: { companyId, fiscalPeriod: { fiscalYearId: id } },
      select: { id: true },
    })).map(({ id: documentId }) => documentId);
    if (documentIds.length) {
      await prisma!.journalLine.deleteMany({ where: { companyId, journalEntry: { accountingDocumentId: { in: documentIds } } } });
      await prisma!.journalEntry.updateMany({ where: { companyId, accountingDocumentId: { in: documentIds } }, data: { reversalOfJournalEntryId: null } });
      await prisma!.journalEntry.deleteMany({ where: { companyId, accountingDocumentId: { in: documentIds } } });
      await prisma!.accountingDocument.updateMany({
        where: { companyId, id: { in: documentIds }, status: "REVERSED" },
        data: { status: "POSTED", reversedByDocumentId: null },
      });
      await prisma!.accountingDocument.deleteMany({ where: { companyId, id: { in: documentIds } } });
    }
    await prisma!.documentSequence.deleteMany({ where: { companyId, fiscalYearId: id } });
    await prisma!.fiscalPeriod.deleteMany({ where: { companyId, fiscalYearId: id } });
    await prisma!.fiscalYear.deleteMany({ where: { companyId, id } });
  }

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({ where: { emailNormalized: "admin@mcap.local" } });
    userId = user.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({ where: { userId, isActive: true } })).companyId;
    const abandonedYear = await prisma!.fiscalYear.findFirst({ where: { companyId, name: "IT-INVENTORY-2046" } });
    if (abandonedYear) await removeFiscalYear(abandonedYear.id);
    const fiscalYear = await prisma!.fiscalYear.create({
      data: {
        companyId,
        name: "IT-INVENTORY-2046",
        startDate: new Date("2046-01-01T00:00:00.000Z"),
        endDate: new Date("2046-12-31T00:00:00.000Z"),
        periods: { create: { periodNumber: 1, name: "فترة حركات المخزون الاختبارية", startDate: new Date("2046-01-01T00:00:00.000Z"), endDate: new Date("2046-12-31T00:00:00.000Z") } },
      },
    });
    fiscalYearId = fiscalYear.id;
    warehouseA = await inventory().createWarehouse(context(), { nameAr: "مستودع حركة أ" });
    warehouseB = await inventory().createWarehouse(context(), { nameAr: "مستودع حركة ب" });
    const unit = await catalog().createUnitOfMeasure(context(), { code: `T${Date.now().toString().slice(-8)}`, nameAr: "وحدة حركة", decimalPlaces: 3 });
    unitId = unit.id;
    item = await catalog().createItem(context(), { unitOfMeasureId: unit.id, nameAr: "صنف حركة اختباري" });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.idempotencyRecord.deleteMany({ where: { companyId, userId, operation: { in: ["CREATE_INVENTORY_MOVEMENT", "REVERSE_INVENTORY_MOVEMENT"] } } });
    await prisma.auditLog.deleteMany({
      where: {
        companyId,
        OR: [
          { entityType: "INVENTORY_MOVEMENT", entityId: { in: movementIds.map(String) } },
          { entityType: "INVENTORY_ITEM", entityId: item?.id.toString() },
          { entityType: "UNIT_OF_MEASURE", entityId: unitId?.toString() },
          { entityType: "WAREHOUSE", entityId: { in: [warehouseA?.id, warehouseB?.id].filter(Boolean).map(String) } },
        ],
      },
    });
    if (movementIds.length) {
      const accountingDocumentIds = (await prisma.inventoryMovement.findMany({
        where: { id: { in: movementIds }, accountingDocumentId: { not: null } },
        select: { accountingDocumentId: true },
      })).flatMap(({ accountingDocumentId }) => accountingDocumentId === null ? [] : [accountingDocumentId]);
      await prisma.inventoryMovementLine.deleteMany({ where: { movementId: { in: movementIds } } });
      await prisma.inventoryMovement.updateMany({ where: { id: { in: movementIds } }, data: { reversalOfMovementId: null } });
      await prisma.inventoryMovement.deleteMany({ where: { id: { in: movementIds } } });
      if (accountingDocumentIds.length) {
        await prisma.journalLine.deleteMany({ where: { journalEntry: { accountingDocumentId: { in: accountingDocumentIds } } } });
        await prisma.journalEntry.updateMany({ where: { accountingDocumentId: { in: accountingDocumentIds } }, data: { reversalOfJournalEntryId: null } });
        await prisma.journalEntry.deleteMany({ where: { accountingDocumentId: { in: accountingDocumentIds } } });
        await prisma.accountingDocument.updateMany({
          where: { id: { in: accountingDocumentIds }, status: "REVERSED" },
          data: { status: "POSTED", reversedByDocumentId: null },
        });
        await prisma.accountingDocument.deleteMany({ where: { id: { in: accountingDocumentIds } } });
      }
    }
    await prisma.inventoryBalance.deleteMany({ where: { companyId, inventoryItemId: item?.id } });
    if (item?.id) await prisma.inventoryItem.delete({ where: { id: item.id } });
    if (unitId) await prisma.unitOfMeasure.delete({ where: { id: unitId } });
    if (warehouseA?.id || warehouseB?.id) {
      await prisma.warehouse.deleteMany({ where: { id: { in: [warehouseA?.id, warehouseB?.id].filter((value): value is bigint => value !== undefined) } } });
    }
    if (fiscalYearId) await removeFiscalYear(fiscalYearId);
    await prisma.$disconnect();
  });

  async function create(
    key: string,
    input: Parameters<InventoryMovementService["createMovement"]>[1],
  ) {
    const result = await movements().createMovement(context(), input, key);
    const id = BigInt(result.id);
    if (!movementIds.includes(id)) movementIds.push(id);
    return result;
  }

  it("posts receipts exactly once and rejects idempotency-key reuse with another request", async () => {
    const input = {
      movementType: "RECEIPT" as const,
      movementDate: "2046-08-24",
      description: "استلام اختباري",
      lines: [{ inventoryItemId: item.id, toWarehouseId: warehouseA.id, quantity: "10.500", unitCostBase: "4.25000000" }],
    };
    const first = await create("inventory-receipt-test-0001", input);
    const replay = await create("inventory-receipt-test-0001", input);
    expect(replay).toEqual(first);
    await expect(create("inventory-receipt-test-0001", { ...input, description: "طلب مختلف" }))
      .rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });
    const balance = await prisma!.inventoryBalance.findUniqueOrThrow({
      where: { companyId_warehouseId_inventoryItemId: { companyId, warehouseId: warehouseA.id, inventoryItemId: item.id } },
    });
    expect(balance.onHand.toFixed(6)).toBe("10.500000");
    expect(balance.movementCount).toBe(1);
    expect(await prisma!.inventoryMovement.count({ where: { companyId, id: BigInt(first.id) } })).toBe(1);
    expect(first).toMatchObject({
      status: "POSTED",
      version: 0,
      accounting: {
        status: "POSTED",
        offsetAccount: { code: "4210" },
      },
    });
    const accounted = await prisma!.inventoryMovement.findUniqueOrThrow({
      where: { id: BigInt(first.id) },
      include: { accountingDocument: { include: { journalEntries: { include: { lines: true } } } } },
    });
    expect(accounted.accountingDocument).toMatchObject({ documentType: "INVENTORY_ADJUSTMENT", status: "POSTED" });
    expect(accounted.accountingDocument!.journalEntries[0]!.lines.map((line) => ({
      debit: line.baseDebitAmount.toFixed(4),
      credit: line.baseCreditAmount.toFixed(4),
    }))).toEqual([
      { debit: "44.6250", credit: "0.0000" },
      { debit: "0.0000", credit: "44.6250" },
    ]);
  });

  it("applies issues and transfers atomically while preventing negative stock", async () => {
    await create("inventory-issue-test-0001", {
      movementType: "ISSUE",
      movementDate: "2046-08-24",
      description: "صرف اختباري",
      lines: [{ inventoryItemId: item.id, fromWarehouseId: warehouseA.id, quantity: "4.500" }],
    });
    await expect(create("inventory-issue-test-0002", {
      movementType: "ISSUE",
      movementDate: "2046-08-24",
      description: "صرف أكبر من الرصيد",
      lines: [{ inventoryItemId: item.id, fromWarehouseId: warehouseA.id, quantity: "7.000" }],
    })).rejects.toMatchObject({ reason: "INSUFFICIENT_STOCK" });
    await create("inventory-transfer-test-0001", {
      movementType: "TRANSFER",
      movementDate: "2046-08-24",
      description: "تحويل اختباري",
      lines: [{ inventoryItemId: item.id, fromWarehouseId: warehouseA.id, toWarehouseId: warehouseB.id, quantity: "2.000" }],
    });
    const balances = await prisma!.inventoryBalance.findMany({ where: { companyId, inventoryItemId: item.id } });
    expect(Object.fromEntries(balances.map((value) => [value.warehouseId.toString(), value.onHand.toFixed(6)])))
      .toEqual({ [warehouseA.id.toString()]: "4.000000", [warehouseB.id.toString()]: "2.000000" });
    expect(await prisma!.inventoryMovement.count({ where: { companyId, description: "صرف أكبر من الرصيد" } })).toBe(0);
  });

  it("enforces unit precision, opening-balance history and company-scoped reads", async () => {
    await expect(create("inventory-precision-test-0001", {
      movementType: "RECEIPT",
      movementDate: "2046-08-24",
      description: "دقة غير صالحة",
      lines: [{ inventoryItemId: item.id, toWarehouseId: warehouseA.id, quantity: "1.0001", unitCostBase: "4.25000000" }],
    })).rejects.toMatchObject({ reason: "INVALID_QUANTITY_PRECISION" });
    await expect(create("inventory-opening-test-0001", {
      movementType: "OPENING_BALANCE",
      movementDate: "2046-08-24",
      description: "رصيد افتتاحي متأخر",
      lines: [{ inventoryItemId: item.id, toWarehouseId: warehouseB.id, quantity: "1", unitCostBase: "4.25000000" }],
    })).rejects.toMatchObject({ reason: "OPENING_BALANCE_EXISTS" });
    const foreign = await movements().listBalances({ companyId: companyId + 9_999_999n, userId }, { page: 1, pageSize: 100 });
    expect(foreign).toMatchObject({ data: [], total: 0 });
  });

  it("serializes concurrent issues so no interleaving can create negative stock", async () => {
    const results = await Promise.allSettled([
      create("inventory-concurrent-issue-0001", {
        movementType: "ISSUE", movementDate: "2046-08-24", description: "صرف متزامن أ",
        lines: [{ inventoryItemId: item.id, fromWarehouseId: warehouseA.id, quantity: "3" }],
      }),
      create("inventory-concurrent-issue-0002", {
        movementType: "ISSUE", movementDate: "2046-08-24", description: "صرف متزامن ب",
        lines: [{ inventoryItemId: item.id, fromWarehouseId: warehouseA.id, quantity: "3" }],
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(InventoryMovementError) });
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ reason: "INSUFFICIENT_STOCK" });
    const balance = await prisma!.inventoryBalance.findUniqueOrThrow({
      where: { companyId_warehouseId_inventoryItemId: { companyId, warehouseId: warehouseA.id, inventoryItemId: item.id } },
    });
    expect(balance.onHand.toFixed(6)).toBe("1.000000");
  });

  it("blocks deactivation of warehouses and items that still carry stock", async () => {
    await expect(inventory().deactivateWarehouse(context(), warehouseB.id, { version: warehouseB.version, reason: "اختبار منع التعطيل" }))
      .rejects.toMatchObject({ reason: "WAREHOUSE_HAS_STOCK" } satisfies Partial<InventoryError>);
    await expect(catalog().deactivateItem(context(), item.id, { version: item.version, reason: "اختبار منع التعطيل" }))
      .rejects.toMatchObject({ reason: "ITEM_HAS_STOCK" });
  });

  it("reverses a manual movement, its historical value and its journal atomically", async () => {
    const original = await prisma!.inventoryMovement.findFirstOrThrow({
      where: { companyId, description: "صرف اختباري" },
      include: { accountingDocument: true, lines: true },
    });
    const result = await movements().reverseMovement(context(), original.id, {
      version: original.version,
      reversalDate: "2046-08-24",
      reason: "تصحيح حركة الاختبار",
    }, "inventory-reversal-test-0001");
    movementIds.push(BigInt(result.reversal.id));
    expect(result).toMatchObject({
      original: { status: "REVERSED", reversedBy: { id: result.reversal.id } },
      reversal: {
        status: "POSTED",
        reversalOf: { id: original.id.toString() },
        accounting: { status: "POSTED" },
      },
    });
    const reloaded = await prisma!.inventoryMovement.findUniqueOrThrow({
      where: { id: original.id },
      include: { accountingDocument: true },
    });
    const reversal = await prisma!.inventoryMovement.findUniqueOrThrow({
      where: { id: BigInt(result.reversal.id) },
      include: { accountingDocument: { include: { journalEntries: { include: { lines: true } } } }, lines: true },
    });
    expect(reloaded).toMatchObject({ status: "REVERSED", version: 1 });
    expect(reloaded.accountingDocument).toMatchObject({ status: "REVERSED" });
    expect(reversal.lines[0]!.totalCostBase.toFixed(4)).toBe(original.lines[0]!.totalCostBase.toFixed(4));
    expect(reversal.accountingDocument!.journalEntries[0]!.lines.map((line) => ({
      debit: line.baseDebitAmount.toFixed(4),
      credit: line.baseCreditAmount.toFixed(4),
    }))).toEqual([
      { debit: "0.0000", credit: "19.1250" },
      { debit: "19.1250", credit: "0.0000" },
    ]);
    const balance = await prisma!.inventoryBalance.findUniqueOrThrow({
      where: { companyId_warehouseId_inventoryItemId: { companyId, warehouseId: warehouseA.id, inventoryItemId: item.id } },
    });
    expect(balance.onHand.toFixed(6)).toBe("5.500000");
  });
});
