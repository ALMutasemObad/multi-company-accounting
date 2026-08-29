import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  InventoryBarcodeService,
} from "../src/inventory/inventory-barcode-service.js";

function resolutionRecord(id: bigint, normalizedValue = "04006381333931") {
  return {
    id,
    symbology: "EAN_13" as const,
    normalizedValue,
    isPrimary: true,
    isActive: true,
    inventoryItem: {
      id: 11n,
      code: "ITM-000011",
      nameAr: "صنف",
      nameEn: "Item",
      description: null,
      isActive: true,
      unitOfMeasure: {
        id: 21n,
        code: "EA",
        nameAr: "حبة",
        decimalPlaces: 0,
      },
    },
  };
}

function createHarness() {
  const inventoryItemBarcode = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  };
  const tx = {
    inventoryItem: { findFirst: vi.fn() },
    inventoryItemBarcode,
    auditLog: { create: vi.fn().mockResolvedValue(undefined) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 11n }]),
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return {
    tx,
    prisma,
    service: new InventoryBarcodeService(prisma as unknown as PrismaClient),
  };
}

const context = { userId: 7n, companyId: 5n };

describe("InventoryBarcodeService query and concurrency guards", () => {
  it("paginates and counts in the database", async () => {
    const { service, tx } = createHarness();
    tx.inventoryItem.findFirst.mockResolvedValue({ id: 11n });
    tx.inventoryItemBarcode.findMany.mockResolvedValue([]);
    tx.inventoryItemBarcode.count.mockResolvedValue(37);

    await expect(service.listBarcodes(context, 11n, {
      page: 3,
      pageSize: 10,
      active: true,
    })).resolves.toEqual({ data: [], total: 37 });

    expect(tx.inventoryItemBarcode.findMany).toHaveBeenCalledWith({
      where: { companyId: 5n, inventoryItemId: 11n, isActive: true },
      orderBy: { id: "asc" },
      skip: 20,
      take: 10,
    });
    expect(tx.inventoryItemBarcode.count).toHaveBeenCalledWith({
      where: { companyId: 5n, inventoryItemId: 11n, isActive: true },
    });
  });

  it("rejects an unbounded internal page before querying", async () => {
    const { service, tx } = createHarness();
    await expect(service.listBarcodes(context, 11n, { page: 1, pageSize: 101 }))
      .rejects.toMatchObject({ reason: "INVALID_PAGINATION" });
    expect(tx.inventoryItem.findFirst).not.toHaveBeenCalled();
    expect(tx.inventoryItemBarcode.findMany).not.toHaveBeenCalled();
  });

  it("resolves a maximum-size duplicate batch with one bounded database query", async () => {
    const { service, tx } = createHarness();
    tx.inventoryItemBarcode.findMany.mockResolvedValue([resolutionRecord(31n)]);
    const entries = Array.from({ length: InventoryBarcodeService.MAX_BATCH_SIZE }, (_, index) => ({
      value: "4006381333931",
      clientReference: `line-${index + 1}`,
    }));

    const result = await service.resolveBarcodeBatch(context, entries);

    expect(result).toHaveLength(InventoryBarcodeService.MAX_BATCH_SIZE);
    expect(result.every(({ status }) => status === "RESOLVED")).toBe(true);
    expect(tx.inventoryItemBarcode.findMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryItemBarcode.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        companyId: 5n,
        normalizedValue: { in: ["04006381333931"] },
      },
    }));
    expect(tx.inventoryItemBarcode.findFirst).not.toHaveBeenCalled();
  });

  it("does not query once per invalid batch entry", async () => {
    const { service, tx } = createHarness();
    const result = await service.resolveBarcodeBatch(context, Array.from({ length: 50 }, () => ({
      symbology: "EAN_13" as const,
      value: "4006381333932",
    })));
    expect(result.every((entry) =>
      entry.status === "UNRESOLVED" && entry.reason === "INVALID_BARCODE_CHECK_DIGIT",
    )).toBe(true);
    expect(tx.inventoryItemBarcode.findMany).not.toHaveBeenCalled();
  });

  it("locks the tenant item before creating and keeps raw identity out of audit", async () => {
    const { service, tx } = createHarness();
    tx.inventoryItem.findFirst.mockResolvedValue({ isActive: true });
    tx.inventoryItemBarcode.findFirst.mockResolvedValue(null);
    tx.inventoryItemBarcode.create.mockResolvedValue({
      id: 31n,
      companyId: 5n,
      inventoryItemId: 11n,
      symbology: "EAN_13",
      value: "4006381333931",
      normalizedValue: "04006381333931",
      isPrimary: true,
      primaryInventoryItemId: 11n,
      isActive: true,
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.createBarcode(context, 11n, {
      symbology: "EAN_13",
      value: "4006381333931",
      isPrimary: true,
    });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.inventoryItemBarcode.create.mock.invocationCallOrder[0]!,
    );
    const auditPayloads = tx.auditLog.create.mock.calls.map(([call]) => call);
    const serializedAudit = JSON.stringify(
      auditPayloads,
      (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value,
    );
    expect(serializedAudit).not.toContain("4006381333931");
    expect(serializedAudit).not.toContain("04006381333931");
    expect(serializedAudit).not.toContain("normalizedValue");
    expect(serializedAudit).not.toContain('"value"');
  });

  it("uses company, item, active state and version in a barcode update", async () => {
    const { service, tx } = createHarness();
    tx.inventoryItem.findFirst.mockResolvedValue({ isActive: true });
    tx.inventoryItemBarcode.findFirst.mockResolvedValue({
      id: 31n,
      companyId: 5n,
      inventoryItemId: 11n,
      symbology: "CODE_128",
      value: "SKU-01",
      normalizedValue: "SKU-01",
      isPrimary: false,
      primaryInventoryItemId: null,
      isActive: true,
      version: 4,
    });
    tx.inventoryItemBarcode.updateMany.mockResolvedValue({ count: 1 });
    tx.inventoryItemBarcode.findFirstOrThrow.mockResolvedValue({
      id: 31n,
      inventoryItemId: 11n,
      symbology: "CODE_128",
      value: "SKU-02",
      normalizedValue: "SKU-02",
      isPrimary: false,
      isActive: true,
      version: 5,
    });

    await service.updateBarcode(context, 11n, 31n, { version: 4, value: "SKU-02" });

    expect(tx.inventoryItemBarcode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 31n,
        companyId: 5n,
        inventoryItemId: 11n,
        isActive: true,
        version: 4,
      },
    }));
  });

  it("locks primary candidates by ascending id before the atomic switch", async () => {
    const { service, tx } = createHarness();
    tx.inventoryItem.findFirst.mockResolvedValue({ isActive: true });
    const target = {
      id: 9n,
      companyId: 5n,
      inventoryItemId: 11n,
      symbology: "CODE_128" as const,
      value: "PRIMARY-NEW",
      normalizedValue: "PRIMARY-NEW",
      isPrimary: false,
      primaryInventoryItemId: null,
      isActive: true,
      version: 2,
    };
    tx.inventoryItemBarcode.findFirst
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce({ id: 2n })
      .mockResolvedValueOnce(target);
    tx.inventoryItemBarcode.updateMany.mockResolvedValue({ count: 1 });
    tx.inventoryItemBarcode.findFirstOrThrow.mockResolvedValue({
      ...target,
      isPrimary: true,
      primaryInventoryItemId: 11n,
      version: 3,
    });

    await service.setPrimaryBarcode(context, 11n, 9n, { version: 2 });

    const rowLock = tx.$queryRaw.mock.calls[1]?.[0] as { values?: unknown[] };
    expect(rowLock.values).toEqual([5n, 11n, 2n, 9n]);
    expect(tx.inventoryItemBarcode.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: 2n, companyId: 5n, inventoryItemId: 11n, isPrimary: true }),
      data: expect.objectContaining({ isPrimary: false, primaryInventoryItemId: null }),
    }));
    expect(tx.inventoryItemBarcode.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: 9n, companyId: 5n, inventoryItemId: 11n, version: 2 }),
      data: expect.objectContaining({ isPrimary: true, primaryInventoryItemId: 11n }),
    }));
  });

  it("deactivates with a conditional version and clears the primary marker", async () => {
    const { service, tx } = createHarness();
    tx.inventoryItem.findFirst.mockResolvedValue({ isActive: true });
    tx.inventoryItemBarcode.findFirst.mockResolvedValue({
      id: 31n,
      companyId: 5n,
      inventoryItemId: 11n,
      symbology: "CODE_128",
      value: "SKU-DEACTIVATE",
      normalizedValue: "SKU-DEACTIVATE",
      isPrimary: true,
      primaryInventoryItemId: 11n,
      isActive: true,
      version: 6,
    });
    tx.inventoryItemBarcode.updateMany.mockResolvedValue({ count: 1 });
    tx.inventoryItemBarcode.findFirstOrThrow.mockResolvedValue({
      id: 31n,
      inventoryItemId: 11n,
      symbology: "CODE_128",
      value: "SKU-DEACTIVATE",
      isPrimary: false,
      isActive: false,
      version: 7,
    });

    await service.deactivateBarcode(context, 11n, 31n, {
      version: 6,
      reason: "retired item identifier",
    });

    expect(tx.inventoryItemBarcode.updateMany).toHaveBeenCalledWith({
      where: {
        id: 31n,
        companyId: 5n,
        inventoryItemId: 11n,
        isActive: true,
        version: 6,
      },
      data: {
        isActive: false,
        isPrimary: false,
        primaryInventoryItemId: null,
        version: { increment: 1 },
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "INVENTORY_ITEM_BARCODE_DEACTIVATED",
        details: expect.objectContaining({ wasPrimary: true, fromVersion: 6, toVersion: 7 }),
      }),
    }));
  });

  it("resolves only by the actor company and omits stored identity values", async () => {
    const { service, tx } = createHarness();
    tx.inventoryItemBarcode.findFirst.mockResolvedValue(resolutionRecord(31n));

    const result = await service.resolveBarcode(context, { value: "4006381333931" });

    expect(tx.inventoryItemBarcode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: 5n, normalizedValue: "04006381333931" },
    }));
    expect(result).toMatchObject({
      barcode: { id: "31", symbology: "EAN_13" },
      inventoryItem: { id: "11", code: "ITM-000011" },
    });
    expect(result).not.toHaveProperty("value");
    expect(result).not.toHaveProperty("normalizedValue");
    expect(JSON.stringify(result)).not.toContain("4006381333931");
    expect(JSON.stringify(result)).not.toContain("04006381333931");
  });

  it.each([
    [{ isActive: false, inventoryItem: { isActive: true } }, "BARCODE_INACTIVE"],
    [{ isActive: true, inventoryItem: { isActive: false } }, "INVENTORY_ITEM_INACTIVE"],
  ] as const)("distinguishes tenant-local inactive resolution state", async (state, reason) => {
    const { service, tx } = createHarness();
    const value = resolutionRecord(31n);
    tx.inventoryItemBarcode.findFirst.mockResolvedValue({
      ...value,
      isActive: state.isActive,
      inventoryItem: { ...value.inventoryItem, isActive: state.inventoryItem.isActive },
    });
    await expect(service.resolveBarcode(context, { value: "4006381333931" }))
      .rejects.toMatchObject({ reason });
  });
});
