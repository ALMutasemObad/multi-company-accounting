import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
  InventoryBarcodeLabelQueryPort,
  PrintableInventoryBarcode,
} from "../src/inventory/inventory-barcode-label-query-port.js";
import type { BarcodeLabelRendererPort } from "../src/printing/barcode-label-ports.js";
import { BwipJsBarcodeLabelRenderer } from "../src/printing/bwip-js-barcode-label-renderer.js";
import {
  ZEBRA_LABEL_PERMISSION,
  type ZebraLabelAuthorizationPort,
  type ZebraLabelMedia,
  type ZebraLabelPreparedSnapshot,
} from "../src/printing/zebra-label-ports.js";
import {
  ZEBRA_LABEL_LIMITS,
  ZebraLabelPreparationError,
  type ZebraLabelPreparationErrorReason,
} from "../src/printing/zebra-label-policy.js";
import { ZebraLabelPreparationService } from "../src/printing/zebra-label-preparation-service.js";

const context = { companyId: 5n, userId: 7n };
const source: PrintableInventoryBarcode = {
  inventoryItemId: 11n,
  barcodeId: 31n,
  symbology: "EAN_13",
  value: "0012345678905",
};
const realRenderer = new BwipJsBarcodeLabelRenderer();
let nativePng: Buffer;
let nativeWidth: number;
let nativeHeight: number;

beforeAll(async () => {
  nativePng = await realRenderer.render({ symbology: source.symbology, value: source.value });
  nativeWidth = nativePng.readUInt32BE(16);
  nativeHeight = nativePng.readUInt32BE(20);
});

function mediaForDots(
  widthDots: number,
  heightDots: number,
  orientation: ZebraLabelMedia["orientation"] = "normal",
): ZebraLabelMedia {
  return {
    widthMm: (widthDots + 0.25) * 25.4 / 203,
    heightMm: (heightDots + 0.25) * 25.4 / 203,
    dpi: 203,
    orientation,
  };
}

function input(media = mediaForDots(nativeWidth + 20, nativeHeight + 20), quantity = 1) {
  return { inventoryItemId: 11n, barcodeId: 31n, media, quantity };
}

function fixture() {
  const authorize = vi.fn<ZebraLabelAuthorizationPort["authorize"]>()
    .mockImplementation(async (actor) => ({ ...actor }));
  const findPrintableBarcode = vi.fn<InventoryBarcodeLabelQueryPort["findPrintableBarcode"]>()
    .mockResolvedValue({ ...source });
  const render = vi.fn<BarcodeLabelRendererPort["render"]>()
    .mockImplementation((barcode) => realRenderer.render(barcode));
  const service = new ZebraLabelPreparationService(
    { authorize },
    { findPrintableBarcode },
    { render },
  );
  return { service, authorize, findPrintableBarcode, render };
}

function failure(reason: ZebraLabelPreparationErrorReason) {
  return new ZebraLabelPreparationError(reason);
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred promise is not initialized"); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("Zebra registered-label preparation", () => {
  it("authorizes on both sides of preparation, preserves leading zeros and all native pixels", async () => {
    const { service, authorize, findPrintableBarcode, render } = fixture();
    const result = await service.prepare(context, input(undefined, 2));

    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenNthCalledWith(1, context, ZEBRA_LABEL_PERMISSION);
    expect(authorize).toHaveBeenNthCalledWith(2, context, ZEBRA_LABEL_PERMISSION);
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(findPrintableBarcode.mock.invocationCallOrder[0]!);
    expect(authorize.mock.invocationCallOrder[1]).toBeGreaterThan(render.mock.invocationCallOrder[0]!);
    expect(findPrintableBarcode).toHaveBeenCalledWith(5n, 11n, 31n);
    expect(render).toHaveBeenCalledWith({ symbology: "EAN_13", value: "0012345678905" });
    expect(result).toMatchObject({
      companyId: "5",
      inventoryItemId: "11",
      barcodeId: "31",
      quantity: 2,
      profile: "INVENTORY_203_DPI_V1",
      mediaDots: { widthDots: nativeWidth + 20, heightDots: nativeHeight + 20 },
      raster: { widthDots: nativeWidth, heightDots: nativeHeight },
      placement: { xDots: 10, yDots: 10, widthDots: nativeWidth, heightDots: nativeHeight, rotation: 0 },
    });
    expect(result.raster.png).toEqual(nativePng);
    expect(Object.hasOwn(result, "value")).toBe(false);
    expect(Object.hasOwn(result, "normalizedValue")).toBe(false);
  });

  it("owns immutable metadata and defensive PNG copies, including a renderer-retained buffer", async () => {
    const { service, render } = fixture();
    const renderedBytes = Buffer.from(nativePng);
    render.mockResolvedValueOnce(renderedBytes);
    const result = await service.prepare(context, input());
    renderedBytes.fill(0);
    result.raster.png.fill(255);

    expect(result.raster.png).toEqual(nativePng);
    expect(result.raster.png).not.toBe(result.raster.png);
    for (const part of [result, result.media, result.mediaDots, result.raster, result.placement]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
  });

  it("places a 90-degree rotation without resizing the native quiet zones or HRI", async () => {
    const { service } = fixture();
    const media = mediaForDots(nativeHeight + 31, nativeWidth + 41, "rotate90");
    const result = await service.prepare(context, input(media));

    expect(result.raster.png).toEqual(nativePng);
    expect(result.placement).toEqual({
      xDots: 15,
      yDots: 20,
      widthDots: nativeHeight,
      heightDots: nativeWidth,
      rotation: 90,
    });
  });

  it("fits exactly at native dots and rejects even a one-dot crop", async () => {
    const { service } = fixture();
    const exact = await service.prepare(context, input(mediaForDots(nativeWidth, nativeHeight)));
    expect(exact.placement.xDots).toBe(0);
    expect(exact.placement.yDots).toBe(0);
    await expect(service.prepare(context, input(mediaForDots(nativeWidth - 1, nativeHeight))))
      .rejects.toEqual(failure("LABEL_DOES_NOT_FIT"));
  });

  it("requires the rotated raster to fit the explicit media dimensions", async () => {
    const { service } = fixture();
    await expect(service.prepare(context, input(mediaForDots(nativeHeight, nativeWidth - 1, "rotate90"))))
      .rejects.toEqual(failure("LABEL_DOES_NOT_FIT"));
  });

  it.each([1, 100])("accepts explicit bounded quantity %i without duplicating raster data", async (quantity) => {
    const { service, render } = fixture();
    const result = await service.prepare(context, input(mediaForDots(nativeWidth, nativeHeight), quantity));
    expect(result.quantity).toBe(quantity);
    expect(result.raster.png).toEqual(nativePng);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects unbounded or non-integer quantity %s before rendering", async (quantity) => {
      const { service, render, findPrintableBarcode } = fixture();
      await expect(service.prepare(context, input(undefined, quantity))).rejects.toEqual(failure("INVALID_QUANTITY"));
      expect(findPrintableBarcode).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 0, 200, 300, 600, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not default or silently convert unsupported DPI %s", async (dpi) => {
      const { service, render } = fixture();
      const media = { ...input().media, dpi } as ZebraLabelMedia;
      await expect(service.prepare(context, input(media))).rejects.toEqual(failure("UNSUPPORTED_DPI"));
      expect(render).not.toHaveBeenCalled();
    },
  );

  it.each([
    { widthMm: 0 }, { heightMm: -1 }, { widthMm: 301 }, { heightMm: 301 },
    { widthMm: Number.NaN }, { heightMm: Number.POSITIVE_INFINITY },
    { widthMm: 0.01 }, { orientation: "landscape" }, { orientation: undefined },
  ])("rejects invalid explicit media %j", async (change) => {
    const { service, render } = fixture();
    const media = { ...input().media, ...change } as ZebraLabelMedia;
    await expect(service.prepare(context, input(media))).rejects.toEqual(failure("INVALID_MEDIA"));
    expect(render).not.toHaveBeenCalled();
  });

  it("caps media pixels and aggregate pixels before invoking the renderer", async () => {
    const { service, render } = fixture();
    await expect(service.prepare(context, input(mediaForDots(2100, 2100))))
      .rejects.toEqual(failure("INVALID_MEDIA"));
    await expect(service.prepare(context, input(mediaForDots(1000, 1000), 17)))
      .rejects.toEqual(failure("BATCH_TOO_LARGE"));
    expect(render).not.toHaveBeenCalled();
  });

  it.each([0n, -1n])("rejects invalid item identity %s before Inventory access", async (inventoryItemId) => {
    const { service, findPrintableBarcode } = fixture();
    await expect(service.prepare(context, { ...input(), inventoryItemId })).rejects.toEqual(failure("INVALID_INPUT"));
    expect(findPrintableBarcode).not.toHaveBeenCalled();
  });

  it("blocks denied authorization before any barcode lookup and hides provider details", async () => {
    const { service, authorize, findPrintableBarcode, render } = fixture();
    authorize.mockRejectedValueOnce(new Error(`secret ${source.value}`));
    await expect(service.prepare(context, input())).rejects.toEqual(failure("NOT_AUTHORIZED"));
    expect(findPrintableBarcode).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it.each([{ userId: 99n, companyId: 5n }, { userId: 7n, companyId: 99n }])(
    "requires an authoritative matching actor %o before Inventory access", async (actor) => {
      const { service, authorize, findPrintableBarcode } = fixture();
      authorize.mockResolvedValueOnce(actor);
      await expect(service.prepare(context, input())).rejects.toEqual(failure("NOT_AUTHORIZED"));
      expect(findPrintableBarcode).not.toHaveBeenCalled();
    },
  );

  it("returns the same not-found reason for missing, inactive and foreign-company barcodes", async () => {
    const { service, findPrintableBarcode, render } = fixture();
    findPrintableBarcode.mockImplementation(async (companyId) => companyId === 5n ? { ...source } : null);
    await expect(service.prepare({ userId: 7n, companyId: 9n }, input()))
      .rejects.toEqual(failure("NOT_FOUND"));
    expect(findPrintableBarcode).toHaveBeenCalledWith(9n, 11n, 31n);
    findPrintableBarcode.mockResolvedValueOnce(null);
    await expect(service.prepare(context, input())).rejects.toEqual(failure("NOT_FOUND"));
    expect(render).not.toHaveBeenCalled();
  });

  it.each([{ barcodeId: 999n }, { inventoryItemId: 999n }])(
    "rejects an owner-port result for mismatched IDs %o", async (change) => {
      const { service, findPrintableBarcode, render } = fixture();
      findPrintableBarcode.mockResolvedValueOnce({ ...source, ...change });
      await expect(service.prepare(context, input())).rejects.toEqual(failure("NOT_FOUND"));
      expect(render).not.toHaveBeenCalled();
    },
  );

  it("hides source-port failures and does not retry a failed lookup", async () => {
    const { service, findPrintableBarcode, render } = fixture();
    findPrintableBarcode.mockRejectedValueOnce(new Error(`database detail ${source.value}`));
    await expect(service.prepare(context, input())).rejects.toEqual(failure("SOURCE_UNAVAILABLE"));
    expect(findPrintableBarcode).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });

  it("rejects QR before rendering even when registered", async () => {
    const { service, findPrintableBarcode, render } = fixture();
    findPrintableBarcode.mockResolvedValueOnce({ ...source, symbology: "QR", value: "REGISTERED-QR" });
    await expect(service.prepare(context, input())).rejects.toEqual(failure("UNSUPPORTED_SYMBOLOGY"));
    expect(render).not.toHaveBeenCalled();
  });

  it.each(["0012345678906", " 0012345678905", "0012345678905\u001d"]) (
    "uses the existing codec to reject invalid stored data without echoing it: %s", async (value) => {
      const { service, findPrintableBarcode, render } = fixture();
      findPrintableBarcode.mockResolvedValueOnce({ ...source, value });
      await expect(service.prepare(context, input())).rejects.toEqual(failure("INVALID_BARCODE"));
      expect(render).not.toHaveBeenCalled();
    },
  );

  it("sanitizes renderer exceptions and never retries a failed render", async () => {
    const { service, render } = fixture();
    render.mockRejectedValueOnce(new Error(`renderer source ${source.value}`));
    await expect(service.prepare(context, input())).rejects.toEqual(failure("RENDER_FAILED"));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("caps CODE_128 presentation work before the renderer, without redefining Inventory's codec", async () => {
    const { service, findPrintableBarcode, render } = fixture();
    findPrintableBarcode.mockResolvedValueOnce({ ...source, symbology: "CODE_128", value: "A".repeat(255) });
    await expect(service.prepare(context, input())).rejects.toEqual(failure("BARCODE_TOO_LARGE"));
    expect(render).not.toHaveBeenCalled();
  });

  it.each(["signature", "ihdr", "truncated", "zero-width", "format", "iend"] as const)(
    "rejects malformed PNG container metadata: %s", async (kind) => {
      const { service, render } = fixture();
      let png = Buffer.from(nativePng);
      if (kind === "signature") png[0] = 0;
      if (kind === "ihdr") png.writeUInt32BE(12, 8);
      if (kind === "truncated") png = png.subarray(0, 20);
      if (kind === "zero-width") png.writeUInt32BE(0, 16);
      if (kind === "format") png[25] = 5;
      if (kind === "iend") png[png.byteLength - 1] = 0;
      render.mockResolvedValueOnce(png);
      await expect(service.prepare(context, input())).rejects.toEqual(failure("INVALID_RASTER"));
    },
  );

  it("checks raster dimensions before allocating or returning an oversized image", async () => {
    const { service, render } = fixture();
    const png = Buffer.from(nativePng);
    png.writeUInt32BE(0xffffffff, 16);
    png.writeUInt32BE(0xffffffff, 20);
    render.mockResolvedValueOnce(png);
    await expect(service.prepare(context, input())).rejects.toEqual(failure("RASTER_TOO_LARGE"));
  });

  it("caps single-image and aggregate compressed bytes without allocating copies", async () => {
    const { service, render } = fixture();
    render.mockResolvedValueOnce(Buffer.alloc(ZEBRA_LABEL_LIMITS.maxPngBytes + 1));
    await expect(service.prepare(context, input())).rejects.toEqual(failure("RASTER_TOO_LARGE"));
    render.mockResolvedValueOnce(Buffer.alloc(ZEBRA_LABEL_LIMITS.maxPngBytes));
    await expect(service.prepare(context, input(undefined, 9))).rejects.toEqual(failure("BATCH_TOO_LARGE"));
  });

  it("does not release a preview after a permission is revoked while rendering", async () => {
    const { service, authorize } = fixture();
    authorize.mockResolvedValueOnce(context).mockRejectedValueOnce(new Error("revoked"));
    await expect(service.prepare(context, input())).rejects.toEqual(failure("NOT_AUTHORIZED"));
  });

  it.each(["deactivate", "change-value", "change-symbology"] as const)(
    "rechecks Inventory after deferred rendering before releasing a preview: %s", async (change) => {
      const { service, render, findPrintableBarcode } = fixture();
      const started = deferred<void>();
      const rendering = deferred<Buffer>();
      render.mockImplementationOnce(() => {
        started.resolve(undefined);
        return rendering.promise;
      });
      const preparation = service.prepare(context, input());
      await started.promise;
      findPrintableBarcode.mockResolvedValueOnce(change === "deactivate" ? null : {
        ...source,
        ...(change === "change-value" ? { value: "4006381333931" } : { symbology: "CODE_128" as const }),
      });
      rendering.resolve(nativePng);

      await expect(preparation).rejects.toEqual(failure(change === "deactivate" ? "NOT_FOUND" : "STALE_PREVIEW"));
      expect(findPrintableBarcode).toHaveBeenCalledTimes(2);
      expect(findPrintableBarcode).toHaveBeenNthCalledWith(2, 5n, 11n, 31n);
    },
  );

  it.each([{ userId: 8n, companyId: 5n }, { userId: 7n, companyId: 9n }])(
    "rejects a scope switch after rendering: %o", async (actor) => {
      const { service, authorize } = fixture();
      authorize.mockResolvedValueOnce(context).mockResolvedValueOnce(actor);
      await expect(service.prepare(context, input())).rejects.toEqual(failure("AUTHORIZATION_SCOPE_CHANGED"));
    },
  );

  it("captures mutable request values before awaiting authorization", async () => {
    const { service, authorize, findPrintableBarcode } = fixture();
    const actor = { ...context };
    const request = input();
    const originalWidth = request.media.widthMm;
    authorize.mockImplementationOnce(async () => {
      actor.companyId = 99n;
      request.inventoryItemId = 99n;
      request.barcodeId = 99n;
      request.quantity = 99;
      request.media = { ...request.media, widthMm: 1 };
      return context;
    });
    const result = await service.prepare(actor, request);
    expect(findPrintableBarcode).toHaveBeenCalledWith(5n, 11n, 31n);
    expect(result.companyId).toBe("5");
    expect(result.quantity).toBe(1);
    expect(result.media.widthMm).toBe(originalWidth);
  });
});

describe("Zebra submission authorization without transport", () => {
  it("refreshes access and the Inventory source and accepts exactly unchanged bytes", async () => {
    const { service, authorize, findPrintableBarcode, render } = fixture();
    const preview = await service.prepare(context, input());
    await expect(service.authorizeSubmission(context, preview)).resolves.toBeUndefined();
    expect(authorize).toHaveBeenCalledTimes(4);
    expect(findPrintableBarcode).toHaveBeenCalledTimes(4);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("rejects another company's preview before reading its barcode", async () => {
    const { service, findPrintableBarcode } = fixture();
    const preview = await service.prepare(context, input());
    findPrintableBarcode.mockClear();
    await expect(service.authorizeSubmission({ ...context, companyId: 9n }, preview))
      .rejects.toEqual(failure("NOT_AUTHORIZED"));
    expect(findPrintableBarcode).not.toHaveBeenCalled();
  });

  it("rejects a now-inactive barcode and a changed registered value", async () => {
    const { service, findPrintableBarcode } = fixture();
    const preview = await service.prepare(context, input());
    findPrintableBarcode.mockResolvedValueOnce(null);
    await expect(service.authorizeSubmission(context, preview)).rejects.toEqual(failure("NOT_FOUND"));
    findPrintableBarcode.mockResolvedValueOnce({ ...source, value: "4006381333931" });
    await expect(service.authorizeSubmission(context, preview)).rejects.toEqual(failure("STALE_PREVIEW"));
  });

  it("rejects revoked permission before re-reading the source", async () => {
    const { service, authorize, findPrintableBarcode } = fixture();
    const preview = await service.prepare(context, input());
    findPrintableBarcode.mockClear();
    authorize.mockRejectedValueOnce(new Error("permission revoked"));
    await expect(service.authorizeSubmission(context, preview)).rejects.toEqual(failure("NOT_AUTHORIZED"));
    expect(findPrintableBarcode).not.toHaveBeenCalled();
  });

  it("does not authorize submission if Inventory changes during its deferred refresh render", async () => {
    const { service, render, findPrintableBarcode } = fixture();
    const preview = await service.prepare(context, input());
    const started = deferred<void>();
    const rendering = deferred<Buffer>();
    render.mockImplementationOnce(() => {
      started.resolve(undefined);
      return rendering.promise;
    });
    const authorization = service.authorizeSubmission(context, preview);
    await started.promise;
    findPrintableBarcode.mockResolvedValueOnce({ ...source, value: "4006381333931" });
    rendering.resolve(nativePng);

    await expect(authorization).rejects.toEqual(failure("STALE_PREVIEW"));
  });

  it("rejects altered raster metadata or placement instead of authorizing a different preview", async () => {
    const { service } = fixture();
    const preview = await service.prepare(context, input());
    const altered: ZebraLabelPreparedSnapshot = {
      ...preview,
      placement: { ...preview.placement, xDots: preview.placement.xDots + 1 },
    };
    await expect(service.authorizeSubmission(context, altered)).rejects.toEqual(failure("STALE_PREVIEW"));
  });

  it("rejects a corrupt preview payload before copying or refreshing it", async () => {
    const { service, findPrintableBarcode } = fixture();
    const preview = await service.prepare(context, input());
    findPrintableBarcode.mockClear();
    await expect(service.authorizeSubmission(context, {
      ...preview,
      raster: { ...preview.raster, png: Buffer.alloc(ZEBRA_LABEL_LIMITS.maxPngBytes + 1) },
    })).rejects.toEqual(failure("RASTER_TOO_LARGE"));
    expect(findPrintableBarcode).not.toHaveBeenCalled();
  });
});
