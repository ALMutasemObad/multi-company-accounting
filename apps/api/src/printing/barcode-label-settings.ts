import type { InventoryBarcodeSymbology } from "../inventory/barcode-codec.js";
import type { ActorContext } from "../platform/actor-context.js";

export type BarcodeLabelSize = "50x25" | "75x50";
export type BarcodeLabelSettings = {
  labelSize: BarcodeLabelSize;
  defaultSymbology: InventoryBarcodeSymbology;
  showItemName: boolean;
  showPublicationYear: boolean;
  showIssueNumber: boolean;
  showBarcodeText: boolean;
};

export const defaultBarcodeLabelSettings: BarcodeLabelSettings = {
  labelSize: "50x25",
  defaultSymbology: "CODE_128",
  showItemName: false,
  showPublicationYear: false,
  showIssueNumber: false,
  showBarcodeText: true,
};

export interface BarcodeLabelSettingsPort {
  get(companyId: bigint): Promise<BarcodeLabelSettings>;
  save(context: ActorContext, value: BarcodeLabelSettings): Promise<BarcodeLabelSettings>;
}
