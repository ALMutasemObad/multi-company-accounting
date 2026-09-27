import type { InventoryBarcodeSymbology } from "../inventory/barcode-codec.js";
import type { ActorContext } from "../platform/actor-context.js";

export const INVENTORY_BARCODE_LABEL_PROFILE = "INVENTORY_203_DPI_V1" as const;
export const INVENTORY_COMPACT_BARCODE_LABEL_PROFILE = "INVENTORY_203_DPI_CONFIGURED_V1" as const;

export type BarcodeLabelRenderInput = {
  symbology: InventoryBarcodeSymbology;
  value: string;
  profile?: "compact-50x25" | "compact-75x50";
  showText?: boolean;
};

export interface BarcodeLabelRendererPort {
  render(input: BarcodeLabelRenderInput): Promise<Buffer>;
  renderSvg(input: BarcodeLabelRenderInput): string;
}

export type BarcodeLabelAuditMetadata = {
  inventoryItemId: bigint;
  barcodeId: bigint;
  symbology: InventoryBarcodeSymbology;
  profile: typeof INVENTORY_BARCODE_LABEL_PROFILE | typeof INVENTORY_COMPACT_BARCODE_LABEL_PROFILE;
};

export interface BarcodeLabelAuditPort {
  recordDownload(
    context: ActorContext,
    metadata: BarcodeLabelAuditMetadata,
  ): Promise<void>;
}
