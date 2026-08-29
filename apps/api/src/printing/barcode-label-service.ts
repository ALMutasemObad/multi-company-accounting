import type { InventoryBarcodeLabelQueryPort } from "../inventory/inventory-barcode-label-query-port.js";
import type { ActorContext } from "../platform/actor-context.js";
import {
  INVENTORY_BARCODE_LABEL_PROFILE,
  type BarcodeLabelAuditPort,
  type BarcodeLabelRendererPort,
} from "./barcode-label-ports.js";

export type BarcodeLabelErrorReason = "NOT_FOUND" | "RENDER_FAILED";

export class BarcodeLabelError extends Error {
  constructor(public readonly reason: BarcodeLabelErrorReason) {
    super(reason);
  }
}

export class BarcodeLabelService {
  constructor(
    private readonly inventory: InventoryBarcodeLabelQueryPort,
    private readonly renderer: BarcodeLabelRendererPort,
    private readonly audit: BarcodeLabelAuditPort,
  ) {}

  async download(
    context: ActorContext,
    inventoryItemId: bigint,
    barcodeId: bigint,
  ) {
    const barcode = await this.inventory.findPrintableBarcode(
      context.companyId,
      inventoryItemId,
      barcodeId,
    );
    if (barcode === null) throw new BarcodeLabelError("NOT_FOUND");

    let buffer: Buffer;
    try {
      buffer = await this.renderer.render({
        symbology: barcode.symbology,
        value: barcode.value,
      });
    } catch {
      throw new BarcodeLabelError("RENDER_FAILED");
    }

    await this.audit.recordDownload(context, {
      inventoryItemId: barcode.inventoryItemId,
      barcodeId: barcode.barcodeId,
      symbology: barcode.symbology,
      profile: INVENTORY_BARCODE_LABEL_PROFILE,
    });

    return {
      buffer,
      filename: `inventory-item-${barcode.inventoryItemId}-barcode-${barcode.barcodeId}.png`,
    };
  }
}
