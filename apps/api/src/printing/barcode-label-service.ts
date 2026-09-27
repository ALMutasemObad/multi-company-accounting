import type { InventoryBarcodeLabelQueryPort } from "../inventory/inventory-barcode-label-query-port.js";
import type { ActorContext } from "../platform/actor-context.js";
import {
  INVENTORY_BARCODE_LABEL_PROFILE,
  INVENTORY_COMPACT_BARCODE_LABEL_PROFILE,
  type BarcodeLabelAuditPort,
  type BarcodeLabelRendererPort,
} from "./barcode-label-ports.js";
import { CompactLabelTooWideError, renderCompactBarcodeLabelPdf } from "./compact-barcode-label-pdf.js";
import type { BarcodeLabelSettings, BarcodeLabelSettingsPort } from "./barcode-label-settings.js";

export type BarcodeLabelErrorReason = "NOT_FOUND" | "RENDER_FAILED" | "LABEL_TOO_WIDE";

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
    private readonly settings: BarcodeLabelSettingsPort,
  ) {}

  getSettings(context: ActorContext) {
    return this.settings.get(context.companyId);
  }

  saveSettings(context: ActorContext, value: BarcodeLabelSettings) {
    return this.settings.save(context, value);
  }

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

  async downloadCompactPdf(context: ActorContext, inventoryItemId: bigint, barcodeId: bigint) {
    const barcode = await this.inventory.findPrintableBarcode(context.companyId, inventoryItemId, barcodeId);
    if (barcode === null) throw new BarcodeLabelError("NOT_FOUND");
    const settings = await this.settings.get(context.companyId);
    let buffer: Buffer;
    try {
      const png = await this.renderer.render({
        symbology: barcode.symbology,
        value: barcode.value,
        profile: "compact-50x25",
        showText: settings.showBarcodeText,
      });
      buffer = await renderCompactBarcodeLabelPdf({
        png,
        value: barcode.value,
        itemName: barcode.itemName,
        issueNumber: barcode.issueNumber,
        publicationYear: barcode.publicationYear,
        settings,
      });
    } catch (error) {
      if (error instanceof CompactLabelTooWideError) throw new BarcodeLabelError("LABEL_TOO_WIDE");
      throw new BarcodeLabelError("RENDER_FAILED");
    }
    await this.audit.recordDownload(context, {
      inventoryItemId: barcode.inventoryItemId,
      barcodeId: barcode.barcodeId,
      symbology: barcode.symbology,
      profile: INVENTORY_COMPACT_BARCODE_LABEL_PROFILE,
    });
    return {
      buffer,
      filename: `inventory-item-${barcode.inventoryItemId}-barcode-${barcode.barcodeId}-${settings.labelSize}.pdf`,
    };
  }
}
