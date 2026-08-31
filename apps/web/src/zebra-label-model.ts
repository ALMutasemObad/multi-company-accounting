import type { ZebraLabelArtifact, ZebraLabelMedia, ZebraLabelRequest, ZebraLabelSource } from "./zebra-label-ports";

// Provisional resource safeguards, not printer capabilities or production SLOs.
export const ZEBRA_LABEL_LIMITS = Object.freeze({
  quantity: 100, pngBytes: 2 * 1024 * 1024, batchBytes: 16 * 1024 * 1024,
  mediaMm: 300, pixels: 4_000_000, batchPixels: 16_000_000,
  previewTtlMs: 120_000, operationTimeoutMs: 10_000,
});

export type ZebraLabelDraft = {
  model: string; connection: "" | "usb" | "network"; printerId: string;
  widthMm: string; heightMm: string; dpi: string;
  orientation: "" | ZebraLabelMedia["orientation"]; quantity: string;
};

export const emptyZebraLabelDraft = (): ZebraLabelDraft => ({
  model: "", connection: "", printerId: "", widthMm: "", heightMm: "", dpi: "", orientation: "", quantity: "",
});

export function zebraLabelSourceKey(source: ZebraLabelSource) {
  return JSON.stringify([source.companyId, source.inventoryItemId, source.barcodeId]);
}

export function zebraLabelRequest(source: ZebraLabelSource, draft: ZebraLabelDraft): ZebraLabelRequest | null {
  if (!Object.values(source).every((id) => /^[1-9][0-9]*$/u.test(id))
    || !draft.model.trim() || draft.model.length > 100
    || !["usb", "network"].includes(draft.connection)
    || !["normal", "rotate90"].includes(draft.orientation)) return null;
  // Numeric form fields only. Barcode data never enters this parser.
  if (![draft.widthMm, draft.heightMm].every((v) => /^\d+(?:\.\d{1,3})?$/u.test(v))
    || !/^\d+$/u.test(draft.dpi) || !/^\d+$/u.test(draft.quantity)) return null;
  const widthMm = Number(draft.widthMm), heightMm = Number(draft.heightMm);
  const dpi = Number(draft.dpi), quantity = Number(draft.quantity);
  if (![widthMm, heightMm].every((v) => Number.isFinite(v) && v > 0 && v <= ZEBRA_LABEL_LIMITS.mediaMm)
    || !Number.isSafeInteger(dpi) || dpi < 1 || dpi > 1200
    || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > ZEBRA_LABEL_LIMITS.quantity) return null;
  const pixels = Math.floor(widthMm * dpi / 25.4) * Math.floor(heightMm * dpi / 25.4);
  if (pixels < 1 || pixels > ZEBRA_LABEL_LIMITS.pixels || pixels * quantity > ZEBRA_LABEL_LIMITS.batchPixels) return null;
  return { source: { ...source }, media: { widthMm, heightMm, dpi, orientation: draft.orientation as ZebraLabelMedia["orientation"] }, quantity };
}

/** Validate owner output defensively before preview/submission. No re-encoding. */
export function validateZebraLabelArtifact(artifact: ZebraLabelArtifact, request: ZebraLabelRequest) {
  if (zebraLabelSourceKey(artifact.source) !== zebraLabelSourceKey(request.source)
    || artifact.media.widthMm !== request.media.widthMm || artifact.media.heightMm !== request.media.heightMm
    || artifact.media.dpi !== request.media.dpi || artifact.media.orientation !== request.media.orientation
    || artifact.quantity !== request.quantity || artifact.rendererProfile !== "INVENTORY_203_DPI_V1"
    || request.media.dpi !== 203) throw new Error("ZEBRA_ARTIFACT_MISMATCH");
  const png = artifact.png;
  if (!(png instanceof Uint8Array) || png.length < 33 || png.length > ZEBRA_LABEL_LIMITS.pngBytes
    || png.length * artifact.quantity > ZEBRA_LABEL_LIMITS.batchBytes
    || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => png[i] === byte)
    || ![73, 72, 68, 82].every((byte, i) => png[i + 12] === byte)) throw new Error("ZEBRA_ARTIFACT_INVALID");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  const mediaWidth = Math.floor(request.media.widthMm * request.media.dpi / 25.4);
  const mediaHeight = Math.floor(request.media.heightMm * request.media.dpi / 25.4);
  const rotated = request.media.orientation === "rotate90";
  const placedWidth = rotated ? height : width, placedHeight = rotated ? width : height;
  if (!width || !height || width * height > ZEBRA_LABEL_LIMITS.pixels
    || mediaWidth * mediaHeight > ZEBRA_LABEL_LIMITS.pixels
    || mediaWidth * mediaHeight * request.quantity > ZEBRA_LABEL_LIMITS.batchPixels
    || width !== artifact.raster.widthDots || height !== artifact.raster.heightDots
    || mediaWidth !== artifact.mediaDots.widthDots || mediaHeight !== artifact.mediaDots.heightDots
    || placedWidth > mediaWidth || placedHeight > mediaHeight
    || artifact.placement.widthDots !== placedWidth || artifact.placement.heightDots !== placedHeight
    || artifact.placement.xDots !== Math.floor((mediaWidth - placedWidth) / 2)
    || artifact.placement.yDots !== Math.floor((mediaHeight - placedHeight) / 2)
    || artifact.placement.rotation !== (rotated ? 90 : 0)) throw new Error("ZEBRA_ARTIFACT_INVALID");
}

export function copyZebraLabelArtifact(a: ZebraLabelArtifact): ZebraLabelArtifact {
  return { ...a, source: { ...a.source }, media: { ...a.media }, png: a.png.slice(), raster: { ...a.raster }, mediaDots: { ...a.mediaDots }, placement: { ...a.placement } };
}
