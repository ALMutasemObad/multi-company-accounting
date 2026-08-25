import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  InventoryMovementService,
  invoiceStockMovementType,
} from "../src/inventory/inventory-movement-service.js";

describe("Inventory movement service invariants", () => {
  const service = new InventoryMovementService({} as PrismaClient);
  const context = { companyId: 7n, userId: 3n };

  it("rejects invalid routing and duplicate items before opening a transaction", async () => {
    await expect(service.createMovement(context, {
      movementType: "RECEIPT",
      movementDate: "2026-08-24",
      description: "مسار خاطئ",
      lines: [{ inventoryItemId: 11n, fromWarehouseId: 9n, quantity: "1" }],
    }, "invalid-route-key")).rejects.toMatchObject({ reason: "INVALID_MOVEMENT_ROUTE" });

    await expect(service.createMovement(context, {
      movementType: "TRANSFER",
      movementDate: "2026-08-24",
      description: "تكرار الصنف",
      lines: [
        { inventoryItemId: 11n, fromWarehouseId: 9n, toWarehouseId: 10n, quantity: "1" },
        { inventoryItemId: 11n, fromWarehouseId: 9n, toWarehouseId: 10n, quantity: "2" },
      ],
    }, "duplicate-item-key")).rejects.toMatchObject({ reason: "DUPLICATE_INVENTORY_ITEM" });
  });

  it("rejects non-positive and over-precise quantities before persistence", async () => {
    for (const quantity of ["0", "-1", "1.0000001", "10000000000000"]) {
      await expect(service.createMovement(context, {
        movementType: "ISSUE",
        movementDate: "2026-08-24",
        description: "كمية غير صالحة",
        lines: [{ inventoryItemId: 11n, fromWarehouseId: 9n, quantity }],
      }, `invalid-quantity-${quantity}`)).rejects.toMatchObject({ reason: "INVALID_QUANTITY" });
    }
  });

  it("serializes quantity balances without losing decimal precision", () => {
    expect(InventoryMovementService.balanceJson({
      id: 1n,
      warehouse: { id: 2n, code: "WH-000002", nameAr: "الرئيسي", nameEn: null },
      inventoryItem: {
        id: 3n,
        code: "ITM-000003",
        nameAr: "قلم",
        nameEn: "Pen",
        unitOfMeasure: { id: 4n, code: "EA", nameAr: "حبة", nameEn: null, decimalPlaces: 3 },
      },
      onHand: new Prisma.Decimal("9007199254740.123456"),
      version: 2,
      movementCount: 7,
      updatedAt: new Date("2026-08-24T10:00:00.000Z"),
    })).toMatchObject({
      id: "1",
      onHand: "9007199254740.123456",
      warehouse: { id: "2" },
      inventoryItem: { id: "3", unitOfMeasure: { decimalPlaces: 3 } },
    });
    expect(InventoryMovementService.movementJson({
      id: 5n,
      movementNumber: "IMV-00000005",
      movementType: "ISSUE",
      movementDate: new Date("2026-08-25T00:00:00.000Z"),
      description: "حركة فاتورة",
      externalReference: "SI-2026-0005",
      sourceType: "SALES_INVOICE",
      sourceId: 15n,
      sourceEvent: "POST",
      sourceDocumentNumberSnapshot: "SI-2026-0005",
      createdAt: new Date("2026-08-25T10:00:00.000Z"),
      createdBy: { displayName: "مدير النظام" },
      _count: { lines: 1 },
    })).toMatchObject({
      source: { type: "SALES_INVOICE", id: "15", event: "POST", documentNumber: "SI-2026-0005" },
      lineCount: 1,
    });
  });

  it("maps invoice posting and reversal to the opposite stock direction", () => {
    expect(invoiceStockMovementType("SALES_INVOICE", "POST")).toBe("ISSUE");
    expect(invoiceStockMovementType("SALES_INVOICE", "REVERSE")).toBe("RECEIPT");
    expect(invoiceStockMovementType("SALES_CREDIT_NOTE", "POST")).toBe("RECEIPT");
    expect(invoiceStockMovementType("SALES_CREDIT_NOTE", "REVERSE")).toBe("ISSUE");
    expect(invoiceStockMovementType("PURCHASE_INVOICE", "POST")).toBe("RECEIPT");
    expect(invoiceStockMovementType("PURCHASE_INVOICE", "REVERSE")).toBe("ISSUE");
    expect(invoiceStockMovementType("PURCHASE_DEBIT_NOTE", "POST")).toBe("ISSUE");
    expect(invoiceStockMovementType("PURCHASE_DEBIT_NOTE", "REVERSE")).toBe("RECEIPT");
  });

  it("replays the same invoice source but rejects a mismatched duplicate source", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 91n,
      movementNumber: "IMV-00000091",
      movementType: "ISSUE",
      movementDate: new Date("2026-08-25T00:00:00.000Z"),
      sourceDocumentNumberSnapshot: "SI-2026-0001",
      lines: [{
        inventoryItemId: 11n,
        fromWarehouseId: 9n,
        toWarehouseId: null,
        quantity: new Prisma.Decimal("3.000000"),
      }],
    });
    const tx = { inventoryMovement: { findUnique } } as unknown as Prisma.TransactionClient;
    const input = {
      companyId: 7n,
      actorUserId: 3n,
      invoiceId: 41n,
      documentType: "SALES_INVOICE" as const,
      sourceEvent: "POST" as const,
      documentNumber: "SI-2026-0001",
      movementDate: "2026-08-25",
      warehouseId: 9n,
      lines: [
        { inventoryItemId: 11n, quantity: "1.000000" },
        { inventoryItemId: 11n, quantity: "2.000000" },
      ],
    };

    await expect(service.applyInvoiceStockMovement(tx, input)).resolves.toEqual({
      movementId: "91",
      movementNumber: "IMV-00000091",
    });
    await expect(service.applyInvoiceStockMovement(tx, {
      ...input,
      lines: [{ inventoryItemId: 11n, quantity: "4.000000" }],
    })).rejects.toMatchObject({ reason: "SOURCE_MISMATCH" });
  });
});
