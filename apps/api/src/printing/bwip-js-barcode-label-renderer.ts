import { toBuffer } from "@bwip-js/node";
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
  async render(input: BarcodeLabelRenderInput): Promise<Buffer> {
    const bcid = barcodeWriterTypes[input.symbology];
    if (!bcid) throw new BarcodeLabelRenderingError();

    try {
      const isLinear = input.symbology !== "QR";
      const png = await toBuffer({
        bcid,
        text: input.value,
        scale: isLinear ? 3 : 4,
        ...(isLinear
          ? {
              height: 16,
              includetext: true,
              textxalign: "center" as const,
              textsize: 9,
              paddingwidth: 36,
              paddingheight: 8,
              textcolor: "000000",
            }
          : {
              paddingwidth: 16,
              paddingheight: 16,
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
