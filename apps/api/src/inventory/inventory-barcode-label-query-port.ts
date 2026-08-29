import type { InventoryBarcodeSymbology } from "./barcode-codec.js";

export type PrintableInventoryBarcode = {
  inventoryItemId: bigint;
  barcodeId: bigint;
  symbology: InventoryBarcodeSymbology;
  value: string;
};

/** Inventory-owned read contract consumed by Printing & Document Output. */
export interface InventoryBarcodeLabelQueryPort {
  findPrintableBarcode(
    companyId: bigint,
    inventoryItemId: bigint,
    barcodeId: bigint,
  ): Promise<PrintableInventoryBarcode | null>;
}
