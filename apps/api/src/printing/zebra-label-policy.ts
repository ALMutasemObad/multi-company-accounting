import type {
  ZebraLabelDots,
  ZebraLabelMedia,
  ZebraLabelPlacement,
} from "./zebra-label-ports.js";

/** Initial resource ceilings, not claims about an unidentified printer/model. */
export const ZEBRA_LABEL_LIMITS = Object.freeze({
  maxQuantity: 100,
  maxMediaMm: 300,
  maxPngBytes: 2 * 1024 * 1024,
  maxBatchBytes: 16 * 1024 * 1024,
  maxMediaPixels: 4_000_000,
  maxRasterPixels: 4_000_000,
  maxBatchPixels: 16_000_000,
  maxCode128Characters: 128,
});

export type ZebraLabelPreparationErrorReason =
  | "INVALID_INPUT"
  | "INVALID_MEDIA"
  | "UNSUPPORTED_DPI"
  | "INVALID_QUANTITY"
  | "NOT_AUTHORIZED"
  | "AUTHORIZATION_SCOPE_CHANGED"
  | "NOT_FOUND"
  | "SOURCE_UNAVAILABLE"
  | "UNSUPPORTED_SYMBOLOGY"
  | "INVALID_BARCODE"
  | "BARCODE_TOO_LARGE"
  | "RENDER_FAILED"
  | "INVALID_RASTER"
  | "RASTER_TOO_LARGE"
  | "BATCH_TOO_LARGE"
  | "LABEL_DOES_NOT_FIT"
  | "STALE_PREVIEW";

export class ZebraLabelPreparationError extends Error {
  constructor(public readonly reason: ZebraLabelPreparationErrorReason) {
    super(reason);
    this.name = "ZebraLabelPreparationError";
  }
}

export function validateZebraLabelSpecification(
  media: ZebraLabelMedia,
  quantity: number,
): Readonly<{ media: ZebraLabelMedia; quantity: number; mediaDots: ZebraLabelDots }> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > ZEBRA_LABEL_LIMITS.maxQuantity) {
    throw new ZebraLabelPreparationError("INVALID_QUANTITY");
  }
  if (
    media == null
    || !Number.isFinite(media.widthMm)
    || !Number.isFinite(media.heightMm)
    || media.widthMm <= 0
    || media.heightMm <= 0
    || media.widthMm > ZEBRA_LABEL_LIMITS.maxMediaMm
    || media.heightMm > ZEBRA_LABEL_LIMITS.maxMediaMm
    || (media.orientation !== "normal" && media.orientation !== "rotate90")
  ) {
    throw new ZebraLabelPreparationError("INVALID_MEDIA");
  }
  // The existing renderer owns a fixed profile. A supplied DPI is never guessed
  // or replaced, and accepting another DPI would silently rescale its modules.
  if (media.dpi !== 203) throw new ZebraLabelPreparationError("UNSUPPORTED_DPI");

  const widthDots = Math.floor(media.widthMm * media.dpi / 25.4);
  const heightDots = Math.floor(media.heightMm * media.dpi / 25.4);
  const pixels = widthDots * heightDots;
  if (widthDots < 1 || heightDots < 1 || pixels > ZEBRA_LABEL_LIMITS.maxMediaPixels) {
    throw new ZebraLabelPreparationError("INVALID_MEDIA");
  }
  if (pixels * quantity > ZEBRA_LABEL_LIMITS.maxBatchPixels) {
    throw new ZebraLabelPreparationError("BATCH_TOO_LARGE");
  }
  return Object.freeze({
    media: Object.freeze({
      widthMm: media.widthMm,
      heightMm: media.heightMm,
      dpi: media.dpi,
      orientation: media.orientation,
    }),
    quantity,
    mediaDots: Object.freeze({ widthDots, heightDots }),
  });
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IEND = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

/**
 * Inspect bounded PNG container metadata only, without decoding/allocating its
 * pixels. Barcode validation remains exclusively with Inventory's codec; pixel
 * content remains the responsibility of the existing trusted renderer adapter.
 */
export function inspectZebraLabelRaster(png: Buffer, quantity: number): ZebraLabelDots {
  if (!Buffer.isBuffer(png)) throw new ZebraLabelPreparationError("INVALID_RASTER");
  if (png.byteLength > ZEBRA_LABEL_LIMITS.maxPngBytes) {
    throw new ZebraLabelPreparationError("RASTER_TOO_LARGE");
  }
  if (png.byteLength * quantity > ZEBRA_LABEL_LIMITS.maxBatchBytes) {
    throw new ZebraLabelPreparationError("BATCH_TOO_LARGE");
  }
  if (
    png.byteLength < 45
    || !png.subarray(0, 8).equals(PNG_SIGNATURE)
    || png.readUInt32BE(8) !== 13
    || png.toString("ascii", 12, 16) !== "IHDR"
    || png[26] !== 0
    || png[27] !== 0
    || (png[28] !== 0 && png[28] !== 1)
    || !png.subarray(-12).equals(PNG_IEND)
  ) {
    throw new ZebraLabelPreparationError("INVALID_RASTER");
  }

  const validDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  const bitDepth = png[24];
  const colorType = png[25];
  if (
    bitDepth === undefined
    || colorType === undefined
    || !validDepths[colorType]?.includes(bitDepth)
  ) {
    throw new ZebraLabelPreparationError("INVALID_RASTER");
  }
  const widthDots = png.readUInt32BE(16);
  const heightDots = png.readUInt32BE(20);
  if (widthDots === 0 || heightDots === 0) {
    throw new ZebraLabelPreparationError("INVALID_RASTER");
  }
  if (widthDots * heightDots > ZEBRA_LABEL_LIMITS.maxRasterPixels) {
    throw new ZebraLabelPreparationError("RASTER_TOO_LARGE");
  }
  if (widthDots * heightDots * quantity > ZEBRA_LABEL_LIMITS.maxBatchPixels) {
    throw new ZebraLabelPreparationError("BATCH_TOO_LARGE");
  }
  return Object.freeze({ widthDots, heightDots });
}

export function placeZebraLabelRaster(
  raster: ZebraLabelDots,
  media: ZebraLabelDots,
  orientation: ZebraLabelMedia["orientation"],
): ZebraLabelPlacement {
  const rotation = orientation === "rotate90" ? 90 : 0;
  const widthDots = rotation === 90 ? raster.heightDots : raster.widthDots;
  const heightDots = rotation === 90 ? raster.widthDots : raster.heightDots;
  if (widthDots > media.widthDots || heightDots > media.heightDots) {
    throw new ZebraLabelPreparationError("LABEL_DOES_NOT_FIT");
  }
  // The entire native PNG (quiet zones and HRI included) must fit. These integer
  // offsets describe placement; no crop, interpolation or resize is performed.
  return Object.freeze({
    xDots: Math.floor((media.widthDots - widthDots) / 2),
    yDots: Math.floor((media.heightDots - heightDots) / 2),
    widthDots,
    heightDots,
    rotation,
  });
}
