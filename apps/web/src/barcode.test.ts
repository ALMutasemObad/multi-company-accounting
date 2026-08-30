import { describe, expect, it } from "vitest";
import {
  applyResolvedBarcodeToLines,
  appendBarcodeScanToQueue,
  canApplyQueuedBarcodeScan,
  canManageInventoryItemBarcodes,
  canManageInventoryBarcodes,
  canPrintInventoryBarcode,
  canUseInventoryBarcodeScanner,
  canUsePosBarcodeScanner,
  canViewInventoryBarcodes,
  incrementQuantityText,
  inventoryBarcodeLabelFilename,
  type PosBarcodeLine,
} from "./barcode";

type TestLine = PosBarcodeLine & { unitPrice: string };
const blank = (): TestLine => ({
  inventoryItemId: "",
  inventoryItemLabel: "",
  description: "",
  quantity: "1.000000",
  unitPrice: "0.0000",
});

describe("barcode quantity updates", () => {
  it("increments quantities without floating-point conversion and preserves scale", () => {
    expect(incrementQuantityText("1.000000")).toBe("2.000000");
    expect(incrementQuantityText("0001.250000")).toBe("2.250000");
    expect(incrementQuantityText("7")).toBe("8");
  });

  it("rejects transient, excessive, and overflowing quantities", () => {
    expect(incrementQuantityText("1.")).toBeNull();
    expect(incrementQuantityText("1.0000000")).toBeNull();
    expect(incrementQuantityText("9999999999999.000000")).toBeNull();
  });

  it("increments an existing item before considering an empty line", () => {
    const result = applyResolvedBarcodeToLines(
      [
        { ...blank(), inventoryItemId: "7", inventoryItemLabel: "OLD", quantity: "2.500000" },
        blank(),
      ],
      { id: "7", label: "SKU-7 — Item", description: "Item" },
      blank,
    );
    expect(result.status).toBe("incremented");
    expect(result.lines[0]).toMatchObject({ quantity: "3.500000", inventoryItemLabel: "OLD" });
    expect(result.lines[1].inventoryItemId).toBe("");
  });

  it("fills the first empty line and appends only when no empty line exists", () => {
    const item = { id: "9", label: "SKU-9 — Item", description: "Item" };
    const filled = applyResolvedBarcodeToLines([blank(), blank()], item, blank);
    expect(filled.status).toBe("filled");
    expect(filled.lines).toHaveLength(2);
    expect(filled.lines[0]).toMatchObject({ inventoryItemId: "9", quantity: "1.000000" });

    const appended = applyResolvedBarcodeToLines([
      { ...blank(), inventoryItemId: "7" },
    ], item, blank);
    expect(appended.status).toBe("appended");
    expect(appended.lines).toHaveLength(2);
    expect(appended.lines[1].inventoryItemId).toBe("9");

    const limited = applyResolvedBarcodeToLines([
      { ...blank(), inventoryItemId: "7" },
    ], item, blank, 1);
    expect(limited.status).toBe("line-limit");
    expect(limited.lines).toHaveLength(1);
  });
});

describe("barcode scan and permission guards", () => {
  it("queues repeated scans as distinct FIFO entries and preserves textual values", () => {
    const first = appendBarcodeScanToQueue([], " 0012345678905 ", 7, 2);
    expect(first.status).toBe("enqueued");
    if (first.status !== "enqueued") throw new Error("expected first scan to be queued");
    const second = appendBarcodeScanToQueue(first.queue, "0012345678905", 7, 2);
    expect(second.status).toBe("enqueued");
    if (second.status !== "enqueued") throw new Error("expected repeated scan to be queued");
    expect(second.queue).toEqual([
      { value: "0012345678905", epoch: 7 },
      { value: "0012345678905", epoch: 7 },
    ]);
    expect(appendBarcodeScanToQueue(second.queue, "NEXT", 7, 2).status).toBe("full");
    expect(appendBarcodeScanToQueue([], "   ", 7, 2).status).toBe("empty");
  });

  it("rejects stale scan results after an epoch change or checkout start", () => {
    const entry = { value: "0012345678905", epoch: 7 };
    expect(canApplyQueuedBarcodeScan(entry, 7, false)).toBe(true);
    expect(canApplyQueuedBarcodeScan(entry, 8, false)).toBe(false);
    expect(canApplyQueuedBarcodeScan(entry, 7, true)).toBe(false);
  });

  it("requires the exact barcode permissions and checkout for POS scanning", () => {
    const viewOnly = new Set(["inventory_barcodes.view"]);
    const manager = new Set(["inventory_barcodes.manage"]);
    expect(canViewInventoryBarcodes(viewOnly)).toBe(true);
    expect(canManageInventoryBarcodes(viewOnly)).toBe(false);
    expect(canManageInventoryItemBarcodes(manager, true)).toBe(true);
    expect(canManageInventoryItemBarcodes(manager, false)).toBe(false);
    expect(canUsePosBarcodeScanner(new Set(["inventory_barcodes.resolve"]))).toBe(false);
    expect(canUsePosBarcodeScanner(new Set(["pos.checkout", "inventory_barcodes.resolve"]))).toBe(true);
  });

  it("combines barcode resolution with each invoice operation permission", () => {
    const createSalesInvoice = { permission: "sales_invoices.create" } as const;
    expect(canUseInventoryBarcodeScanner(
      new Set(["sales_invoices.create", "inventory_barcodes.resolve"]),
      createSalesInvoice,
    )).toBe(true);
    expect(canUseInventoryBarcodeScanner(
      new Set(["sales_invoices.create"]),
      createSalesInvoice,
    )).toBe(false);
    expect(canUseInventoryBarcodeScanner(
      new Set(["inventory_barcodes.resolve"]),
      createSalesInvoice,
    )).toBe(false);
  });

  it("allows label download only with print permission and active records", () => {
    const printer = new Set(["inventory_barcodes.print"]);
    expect(canPrintInventoryBarcode(printer, true, true)).toBe(true);
    expect(canPrintInventoryBarcode(printer, false, true)).toBe(false);
    expect(canPrintInventoryBarcode(printer, true, false)).toBe(false);
    expect(canPrintInventoryBarcode(new Set(), true, true)).toBe(false);
  });

  it("builds a PNG fallback filename from safe numeric identifiers only", () => {
    expect(inventoryBarcodeLabelFilename("12", "34")).toBe("inventory-barcode-12-34.png");
    expect(inventoryBarcodeLabelFilename("../12", "34/label")).toBe("inventory-barcode-unknown-unknown.png");
  });
});
