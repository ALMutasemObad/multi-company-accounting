import type { InventoryBarcodeSymbology } from "../inventory/barcode-codec.js";
import type { ActorContext } from "../platform/actor-context.js";

export const INVENTORY_BARCODE_LABEL_PROFILE = "INVENTORY_203_DPI_V1" as const;

export type BarcodeLabelRenderInput = {
  symbology: InventoryBarcodeSymbology;
  value: string;
};

export interface BarcodeLabelRendererPort {
  render(input: BarcodeLabelRenderInput): Promise<Buffer>;
}

export type BarcodeLabelAuditMetadata = {
  inventoryItemId: bigint;
  barcodeId: bigint;
  symbology: InventoryBarcodeSymbology;
  profile: typeof INVENTORY_BARCODE_LABEL_PROFILE;
};

export interface BarcodeLabelAuditPort {
  recordDownload(
    context: ActorContext,
    metadata: BarcodeLabelAuditMetadata,
  ): Promise<void>;
}
