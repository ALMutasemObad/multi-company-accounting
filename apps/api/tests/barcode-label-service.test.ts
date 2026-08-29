import { describe, expect, it, vi } from "vitest";
import type { InventoryBarcodeLabelQueryPort } from "../src/inventory/inventory-barcode-label-query-port.js";
import {
  BarcodeLabelError,
  BarcodeLabelService,
} from "../src/printing/barcode-label-service.js";
import {
  INVENTORY_BARCODE_LABEL_PROFILE,
  type BarcodeLabelAuditPort,
  type BarcodeLabelRendererPort,
} from "../src/printing/barcode-label-ports.js";

const context = { companyId: 5n, userId: 7n };
const rawValue = "0012345678905";
const source = {
  inventoryItemId: 11n,
  barcodeId: 31n,
  symbology: "EAN_13" as const,
  value: rawValue,
};

function fixture() {
  const findPrintableBarcode = vi.fn().mockResolvedValue(source);
  const render = vi.fn().mockResolvedValue(Buffer.from("png"));
  const recordDownload = vi.fn().mockResolvedValue(undefined);
  const service = new BarcodeLabelService(
    { findPrintableBarcode } satisfies InventoryBarcodeLabelQueryPort,
    { render } satisfies BarcodeLabelRendererPort,
    { recordDownload } satisfies BarcodeLabelAuditPort,
  );
  return { service, findPrintableBarcode, render, recordDownload };
}

describe("barcode label orchestration", () => {
  it("queries Inventory in the authenticated tenant and audits only safe metadata", async () => {
    const { service, findPrintableBarcode, render, recordDownload } = fixture();
    const result = await service.download(context, 11n, 31n);

    expect(findPrintableBarcode).toHaveBeenCalledWith(5n, 11n, 31n);
    expect(render).toHaveBeenCalledWith({ symbology: "EAN_13", value: rawValue });
    expect(result).toEqual({
      buffer: Buffer.from("png"),
      filename: "inventory-item-11-barcode-31.png",
    });
    expect(recordDownload).toHaveBeenCalledWith(context, {
      inventoryItemId: 11n,
      barcodeId: 31n,
      symbology: "EAN_13",
      profile: INVENTORY_BARCODE_LABEL_PROFILE,
    });
    expect(JSON.stringify(recordDownload.mock.calls, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    )).not.toContain(rawValue);
    expect(result.filename).not.toContain(rawValue);
  });

  it("does not render or audit an inactive, missing, or foreign identifier", async () => {
    const { service, findPrintableBarcode, render, recordDownload } = fixture();
    findPrintableBarcode.mockResolvedValueOnce(null);

    await expect(service.download(context, 11n, 99n)).rejects.toEqual(
      new BarcodeLabelError("NOT_FOUND"),
    );
    expect(render).not.toHaveBeenCalled();
    expect(recordDownload).not.toHaveBeenCalled();
  });

  it("does not create a download audit when rendering fails", async () => {
    const { service, render, recordDownload } = fixture();
    render.mockRejectedValueOnce(new Error("adapter failure with internal details"));

    await expect(service.download(context, 11n, 31n)).rejects.toEqual(
      new BarcodeLabelError("RENDER_FAILED"),
    );
    expect(recordDownload).not.toHaveBeenCalled();
  });
});
