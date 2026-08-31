import type { ActorContext } from "../platform/actor-context.js";
import type { INVENTORY_BARCODE_LABEL_PROFILE } from "./barcode-label-ports.js";

export const ZEBRA_LABEL_PERMISSION = "inventory_barcodes.print" as const;

export type ZebraLabelMedia = Readonly<{
  widthMm: number;
  heightMm: number;
  dpi: number;
  orientation: "normal" | "rotate90";
}>;

export type ZebraLabelPrepareInput = Readonly<{
  inventoryItemId: bigint;
  barcodeId: bigint;
  media: ZebraLabelMedia;
  quantity: number;
}>;

/**
 * Composition must recheck the live session, permission and tenant scope and
 * return its authoritative actor. The request's companyId is not authorization.
 * The service calls this before reading Inventory and again before returning.
 */
export interface ZebraLabelAuthorizationPort {
  authorize(
    context: Readonly<ActorContext>,
    permission: typeof ZEBRA_LABEL_PERMISSION,
  ): Promise<Readonly<ActorContext>>;
}

export type ZebraLabelDots = Readonly<{
  widthDots: number;
  heightDots: number;
}>;

export type ZebraLabelPlacement = Readonly<{
  xDots: number;
  yDots: number;
  widthDots: number;
  heightDots: number;
  rotation: 0 | 90;
}>;

/** Internal application snapshot; this is not a new HTTP/OpenAPI contract. */
export type ZebraLabelPreparedSnapshot = Readonly<{
  companyId: string;
  inventoryItemId: string;
  barcodeId: string;
  profile: typeof INVENTORY_BARCODE_LABEL_PROFILE;
  media: ZebraLabelMedia;
  quantity: number;
  mediaDots: ZebraLabelDots;
  raster: Readonly<{
    /** A defensive copy on every access; callers cannot alter the snapshot. */
    png: Buffer;
    widthDots: number;
    heightDots: number;
  }>;
  placement: ZebraLabelPlacement;
}>;
