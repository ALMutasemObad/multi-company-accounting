import { encodeBarcode } from "../inventory/barcode-codec.js";
import type {
  InventoryBarcodeLabelQueryPort,
  PrintableInventoryBarcode,
} from "../inventory/inventory-barcode-label-query-port.js";
import type { ActorContext } from "../platform/actor-context.js";
import {
  INVENTORY_BARCODE_LABEL_PROFILE,
  type BarcodeLabelRendererPort,
} from "./barcode-label-ports.js";
import {
  ZEBRA_LABEL_PERMISSION,
  type ZebraLabelAuthorizationPort,
  type ZebraLabelPrepareInput,
  type ZebraLabelPreparedSnapshot,
} from "./zebra-label-ports.js";
import {
  inspectZebraLabelRaster,
  placeZebraLabelRaster,
  validateZebraLabelSpecification,
  ZEBRA_LABEL_LIMITS,
  ZebraLabelPreparationError,
} from "./zebra-label-policy.js";

/**
 * Printing-owned preparation only: no persistence, transport, SDK or device I/O.
 * The future HTTP boundary must use the existing generated contract discipline;
 * the eventual direct-print adapter must reauthorize before its explicit send.
 */
export class ZebraLabelPreparationService {
  constructor(
    private readonly authorization: ZebraLabelAuthorizationPort,
    private readonly inventory: InventoryBarcodeLabelQueryPort,
    private readonly renderer: BarcodeLabelRendererPort,
  ) {}

  /**
   * Recheck a previously prepared internal snapshot immediately before the
   * separate explicit-send operation. This method cannot send or retry labels.
   * Composition must await it and still check its live scope before transport.
   */
  async authorizeSubmission(
    context: Readonly<ActorContext>,
    snapshot: ZebraLabelPreparedSnapshot,
  ): Promise<void> {
    if (
      context == null
      || typeof context.companyId !== "bigint"
      || snapshot == null
      || snapshot.raster == null
      || snapshot.mediaDots == null
      || snapshot.placement == null
    ) {
      throw new ZebraLabelPreparationError("INVALID_INPUT");
    }
    if (snapshot.companyId !== context.companyId.toString()) {
      throw new ZebraLabelPreparationError("NOT_AUTHORIZED");
    }
    const actor = Object.freeze({ userId: context.userId, companyId: context.companyId });
    const inventoryItemId = this.snapshotIdentifier(snapshot.inventoryItemId);
    const barcodeId = this.snapshotIdentifier(snapshot.barcodeId);
    const specification = validateZebraLabelSpecification(snapshot.media, snapshot.quantity);
    const png = snapshot.raster.png;
    inspectZebraLabelRaster(png, specification.quantity);
    // Snapshot every field and own bounded bytes before the asynchronous source
    // refresh. A mutable host object must not switch the preview during a check.
    const expected = Object.freeze({
      companyId: snapshot.companyId,
      inventoryItemId: snapshot.inventoryItemId,
      barcodeId: snapshot.barcodeId,
      profile: snapshot.profile,
      mediaDots: Object.freeze({ ...snapshot.mediaDots }),
      raster: Object.freeze({
        png: Buffer.from(png),
        widthDots: snapshot.raster.widthDots,
        heightDots: snapshot.raster.heightDots,
      }),
      placement: Object.freeze({ ...snapshot.placement }),
    });
    const current = await this.prepare(actor, {
      inventoryItemId,
      barcodeId,
      media: specification.media,
      quantity: specification.quantity,
    });
    if (
      current.companyId !== expected.companyId
      || current.inventoryItemId !== expected.inventoryItemId
      || current.barcodeId !== expected.barcodeId
      || current.profile !== expected.profile
      || current.mediaDots.widthDots !== expected.mediaDots.widthDots
      || current.mediaDots.heightDots !== expected.mediaDots.heightDots
      || current.raster.widthDots !== expected.raster.widthDots
      || current.raster.heightDots !== expected.raster.heightDots
      || current.placement.xDots !== expected.placement.xDots
      || current.placement.yDots !== expected.placement.yDots
      || current.placement.widthDots !== expected.placement.widthDots
      || current.placement.heightDots !== expected.placement.heightDots
      || current.placement.rotation !== expected.placement.rotation
      || !current.raster.png.equals(expected.raster.png)
    ) {
      throw new ZebraLabelPreparationError("STALE_PREVIEW");
    }
  }

  async prepare(
    context: Readonly<ActorContext>,
    input: ZebraLabelPrepareInput,
  ): Promise<ZebraLabelPreparedSnapshot> {
    if (
      context == null
      || typeof context.userId !== "bigint" || context.userId <= 0n
      || typeof context.companyId !== "bigint" || context.companyId <= 0n
      || input == null
      || typeof input.inventoryItemId !== "bigint" || input.inventoryItemId <= 0n
      || typeof input.barcodeId !== "bigint" || input.barcodeId <= 0n
    ) {
      throw new ZebraLabelPreparationError("INVALID_INPUT");
    }
    // Capture primitives before the first await, so a mutable caller cannot
    // change the company, item, media or quantity partway through preparation.
    const actor = Object.freeze({ userId: context.userId, companyId: context.companyId });
    const inventoryItemId = input.inventoryItemId;
    const barcodeId = input.barcodeId;
    const specification = validateZebraLabelSpecification(input.media, input.quantity);
    await this.assertAuthorized(actor, false);

    const barcode = await this.readBarcode(actor, inventoryItemId, barcodeId);
    if (barcode.symbology === "QR") {
      throw new ZebraLabelPreparationError("UNSUPPORTED_SYMBOLOGY");
    }

    let encoded: ReturnType<typeof encodeBarcode>;
    try {
      encoded = encodeBarcode(barcode.symbology, barcode.value);
    } catch {
      throw new ZebraLabelPreparationError("INVALID_BARCODE");
    }
    // A stricter presentation resource ceiling than Inventory's 255-character
    // catalog limit bounds the existing fixed renderer's work before it starts.
    // This is a string-length limit, not a second barcode parser or encoder.
    if (
      encoded.symbology === "CODE_128"
      && encoded.value.length > ZEBRA_LABEL_LIMITS.maxCode128Characters
    ) {
      throw new ZebraLabelPreparationError("BARCODE_TOO_LARGE");
    }

    let png: Buffer;
    try {
      png = await this.renderer.render({
        symbology: encoded.symbology,
        // Never use normalizedValue here: GTIN padding is lookup equivalence,
        // not permission to alter the registered printed barcode or its HRI.
        value: encoded.value,
      });
    } catch {
      throw new ZebraLabelPreparationError("RENDER_FAILED");
    }
    const rasterDots = inspectZebraLabelRaster(png, specification.quantity);
    const placement = placeZebraLabelRaster(
      rasterDots,
      specification.mediaDots,
      specification.media.orientation,
    );
    // Own bytes before awaiting reauthorization; a renderer-held mutable Buffer
    // must not change the validated artifact while live access is rechecked.
    const nativePng = Buffer.from(png);
    const currentBarcode = await this.readBarcode(actor, inventoryItemId, barcodeId);
    if (
      currentBarcode.symbology !== encoded.symbology
      || currentBarcode.value !== encoded.value
    ) {
      throw new ZebraLabelPreparationError("STALE_PREVIEW");
    }
    await this.assertAuthorized(actor, true);

    return Object.freeze({
      companyId: actor.companyId.toString(),
      inventoryItemId: inventoryItemId.toString(),
      barcodeId: barcodeId.toString(),
      profile: INVENTORY_BARCODE_LABEL_PROFILE,
      media: specification.media,
      quantity: specification.quantity,
      mediaDots: specification.mediaDots,
      raster: Object.freeze({
        get png() { return Buffer.from(nativePng); },
        widthDots: rasterDots.widthDots,
        heightDots: rasterDots.heightDots,
      }),
      placement,
    });
  }

  private async assertAuthorized(actor: Readonly<ActorContext>, afterRendering: boolean) {
    let authorized: Readonly<ActorContext>;
    try {
      authorized = await this.authorization.authorize(actor, ZEBRA_LABEL_PERMISSION);
    } catch {
      // Do not surface provider errors that can contain identity/barcode data.
      throw new ZebraLabelPreparationError("NOT_AUTHORIZED");
    }
    if (
      authorized == null
      || authorized.userId !== actor.userId
      || authorized.companyId !== actor.companyId
    ) {
      throw new ZebraLabelPreparationError(
        afterRendering ? "AUTHORIZATION_SCOPE_CHANGED" : "NOT_AUTHORIZED",
      );
    }
  }

  private async readBarcode(
    actor: Readonly<ActorContext>,
    inventoryItemId: bigint,
    barcodeId: bigint,
  ): Promise<PrintableInventoryBarcode> {
    let barcode: PrintableInventoryBarcode | null;
    try {
      barcode = await this.inventory.findPrintableBarcode(actor.companyId, inventoryItemId, barcodeId);
    } catch {
      throw new ZebraLabelPreparationError("SOURCE_UNAVAILABLE");
    }
    if (
      barcode == null
      || barcode.inventoryItemId !== inventoryItemId
      || barcode.barcodeId !== barcodeId
    ) {
      // Missing, inactive and foreign IDs are indistinguishable. Inventory's
      // owner port remains responsible for company-filtered source retrieval.
      throw new ZebraLabelPreparationError("NOT_FOUND");
    }
    return barcode;
  }

  private snapshotIdentifier(value: string): bigint {
    if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value)) {
      throw new ZebraLabelPreparationError("INVALID_INPUT");
    }
    return BigInt(value);
  }
}
