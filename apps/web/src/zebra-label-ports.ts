/** In-process UI hooks, not a public HTTP contract. Production composition must use
 * generated, authorized APIs; no SDK, device address or printer command crosses here. */
export type ZebraLabelSource = Readonly<{
  companyId: string;
  inventoryItemId: string;
  barcodeId: string;
}>;

export type ZebraLabelMedia = Readonly<{
  widthMm: number;
  heightMm: number;
  dpi: number;
  orientation: "normal" | "rotate90";
}>;

export type ZebraLabelRequest = Readonly<{
  source: ZebraLabelSource;
  media: ZebraLabelMedia;
  quantity: number;
}>;

export type ZebraLabelArtifact = ZebraLabelRequest & Readonly<{
  rendererProfile: "INVENTORY_203_DPI_V1";
  png: Uint8Array;
  raster: Readonly<{ widthDots: number; heightDots: number }>;
  mediaDots: Readonly<{ widthDots: number; heightDots: number }>;
  placement: Readonly<{
    xDots: number; yDots: number; widthDots: number; heightDots: number; rotation: 0 | 90;
  }>;
}>;

export interface ZebraLabelPreparationPort {
  prepare(request: ZebraLabelRequest, signal: AbortSignal): Promise<ZebraLabelArtifact>;
  /** Recheck server session/company/print permission AND current registered barcode
   * against this artifact before submission. Reject changed/inactive source. */
  authorizeSubmission(artifact: ZebraLabelArtifact, signal: AbortSignal): Promise<void>;
}

/** Supplied only after an operator has reviewed the exact device and bridge.
 * No field is inferred from model names or populated by network discovery. */
export type ZebraLabelPrinter = Readonly<{
  id: string;
  label: string;
  companyId: string;
  model: string;
  connection: "usb" | "network";
  dpi: number;
  maxWidthMm: number;
  maxHeightMm: number;
  supportEvidence: string;
  approved: boolean;
}>;

export interface ZebraLabelDirectPrintPort {
  readonly available: boolean;
  /** One bounded submission; adapter MUST NOT retry, discover, configure or accept
   * arbitrary ZPL. Keep source pixels/HRI/quiet zones, apply placement at 1:1 dots.
   * Validate FINAL encoded bytes against bridge limits before any device I/O. */
  submit(job: Readonly<{ printer: ZebraLabelPrinter; artifact: ZebraLabelArtifact }>,
    signal: AbortSignal): Promise<{ status: "sent" | "queued" }>;
}

export const unavailableZebraLabelDirectPrint: ZebraLabelDirectPrintPort = Object.freeze({
  available: false,
  async submit() { throw new Error("ZEBRA_ADAPTER_UNAVAILABLE"); },
});

export const unavailableZebraLabelPreparation: ZebraLabelPreparationPort = Object.freeze({
  async prepare() { throw new Error("ZEBRA_PREPARATION_UNAVAILABLE"); },
  async authorizeSubmission() { throw new Error("ZEBRA_PREPARATION_UNAVAILABLE"); },
});
