import { describe, expect, it } from "vitest";
import type { InventoryBarcodeSymbology } from "../src/inventory/barcode-codec.js";
import {
  BarcodeLabelRenderingError,
  BwipJsBarcodeLabelRenderer,
} from "../src/printing/bwip-js-barcode-label-renderer.js";

const PNG_SIGNATURE = "89504e470d0a1a0a";

describe("fixed inventory barcode label renderer", () => {
  it.each([
    ["EAN_13", "4006381333931"],
    ["EAN_8", "96385074"],
    ["UPC_A", "036000291452"],
    ["CODE_128", "SKU-000123"],
    ["QR", "ITEM-QR-000123"],
  ] satisfies Array<[InventoryBarcodeSymbology, string]>) (
    "renders %s as a bounded PNG",
    async (symbology, value) => {
      const png = await new BwipJsBarcodeLabelRenderer().render({ symbology, value });
      expect(png.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
      expect(png.byteLength).toBeLessThan(2 * 1024 * 1024);
    },
  );

  it("fails with a safe error for an unsupported runtime mapping", async () => {
    await expect(new BwipJsBarcodeLabelRenderer().render({
      symbology: "GS1_128" as InventoryBarcodeSymbology,
      value: "SAFE-TEST-VALUE",
    })).rejects.toBeInstanceOf(BarcodeLabelRenderingError);
  });
});
