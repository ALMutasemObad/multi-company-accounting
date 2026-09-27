import { toBuffer, toSVG } from "@bwip-js/node";
import type { InventoryBarcodeSymbology } from "../inventory/barcode-codec.js";
import type {
  BarcodeLabelRendererPort,
  BarcodeLabelRenderInput,
} from "./barcode-label-ports.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_LABEL_BYTES = 2 * 1024 * 1024;

const barcodeWriterTypes: Record<InventoryBarcodeSymbology, string> = {
  EAN_13: "ean13",
  EAN_8: "ean8",
  UPC_A: "upca",
  CODE_128: "code128",
  QR: "qrcode",
};

export class BarcodeLabelRenderingError extends Error {
  constructor() {
    super("BARCODE_LABEL_RENDER_FAILED");
  }
}

/**
 * Fixed 203-DPI B2 profile. Callers cannot supply dimensions, colors, copies,
 * encoder flags, or arbitrary barcode types.
 */
export class BwipJsBarcodeLabelRenderer implements BarcodeLabelRendererPort {
  renderSvg(input: BarcodeLabelRenderInput): string {
    const bcid = barcodeWriterTypes[input.symbology];
    if (!bcid) throw new BarcodeLabelRenderingError();
    const maxWidth = input.profile === "compact-75x50" ? 568 : 368;
    try {
      let smallestSvg = "";
      for (const scale of [4, 3, 2]) {
        const isLinear = input.symbology !== "QR";
        const svg = toSVG({
          bcid,
          text: input.value,
          scale,
          ...(isLinear
            ? {
                height: 9,
                includetext: input.showText ?? true,
                textxalign: "center" as const,
                ...(input.symbology === "CODE_128" ? { textyoffset: -4 } : {}),
                textsize: input.profile === "compact-75x50" ? 10 : 9,
                paddingwidth: 12,
                paddingheight: 3,
              }
            : { paddingwidth: 8, paddingheight: 8 }),
          backgroundcolor: "FFFFFF",
          barcolor: "000000",
        });
        const width = Number(svg.match(/^<svg viewBox="0 0 ([\d.]+) /u)?.[1]);
        if (!Number.isFinite(width) || svg.length > MAX_LABEL_BYTES) throw new BarcodeLabelRenderingError();
        if (width <= maxWidth) return svg;
        smallestSvg = svg;
      }
      // Let the PDF layout report LABEL_TOO_WIDE with its normal 422 response.
      return smallestSvg;
    } catch {
      throw new BarcodeLabelRenderingError();
    }
  }

  async render(input: BarcodeLabelRenderInput): Promise<Buffer> {
    const bcid = barcodeWriterTypes[input.symbology];
    if (!bcid) throw new BarcodeLabelRenderingError();

    try {
      const isLinear = input.symbology !== "QR";
      const compact = input.profile === "compact-50x25";
      const png = await toBuffer({
        bcid,
        text: input.value,
        scale: compact ? 2 : isLinear ? 3 : 4,
        ...(isLinear
          ? {
              height: compact ? 9 : 16,
              includetext: input.showText ?? true,
              textxalign: "center" as const,
              textsize: compact ? 8 : 9,
              paddingwidth: compact ? 12 : 36,
              paddingheight: compact ? 3 : 8,
              textcolor: "000000",
            }
          : {
              paddingwidth: compact ? 8 : 16,
              paddingheight: compact ? 8 : 16,
            }),
        backgroundcolor: "FFFFFF",
        barcolor: "000000",
      });
      if (
        png.byteLength > MAX_LABEL_BYTES
        || !png.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
      ) {
        throw new BarcodeLabelRenderingError();
      }
      return png;
    } catch {
      throw new BarcodeLabelRenderingError();
    }
  }
}
